import { derivePlayerStats } from './gear.js';

const MATCH_TICKS = 60 * 60;

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildPvpSnapshotContent(state) {
  if (!state?.player?.baseStats || !state?.equipment) throw new TypeError('A valid saved game state is required.');
  const stats = derivePlayerStats(state);
  const effects = Object.entries(state.equipment).flatMap(([, item]) =>
    item?.effects?.map(({ id, value }) => ({ id, value })) ?? []);
  return {
    character: {
      level: state.player.level,
      baseStats: { ...state.player.baseStats },
    },
    equipment: structuredClone(state.equipment),
    combat: {
      maxHp: stats.maxHp,
      currentHp: state.player.currentHp,
      attack: stats.attack,
      defense: stats.defense,
      critChance: stats.critChance,
      critMultiplier: stats.critMultiplier,
      moveSpeed: stats.moveSpeed,
      effects,
    },
  };
}

function validMatchTicket(ticket) {
  return Boolean(ticket && typeof ticket.matchId === 'string' && ticket.matchId &&
    Number.isInteger(ticket.seed) && ticket.seed >= 1 && ticket.seed <= 0xffffffff &&
    ticket.simulatorVersion === 1 && ticket.timeLimitMs === 60_000 &&
    typeof ticket.issuedAtUtc === 'string' && Number.isFinite(Date.parse(ticket.issuedAtUtc)) &&
    Number.isFinite(Date.parse(ticket.expiresAtUtc)) && Date.parse(ticket.expiresAtUtc) > Date.parse(ticket.issuedAtUtc) &&
    ticket.playerSnapshot?.combat && ticket.opponentSnapshot?.combat &&
    ticket.playerSnapshot?.equipment && ticket.opponentSnapshot?.equipment);
}

export function createPvpClient({
  apiClient,
  account,
  getCurrentState = () => null,
  getSaveRevision = () => null,
  getMode = () => 'offline',
  syncPendingSave = async () => ({ ok: false, error: 'save-sync-unavailable' }),
  refreshAccountSave = async () => ({ status: 'error', code: 'account-refresh-unavailable' }),
  isOnline = () => globalThis.navigator?.onLine !== false,
  reauthenticate = async () => ({ ok: false }),
  now = () => new Date(),
} = {}) {
  for (const method of ['publishPvpSnapshot', 'searchPvpMatch', 'submitPvpResult']) {
    if (typeof apiClient?.[method] !== 'function') throw new TypeError(`The PvP API client must provide ${method}.`);
  }
  if (!account) throw new TypeError('An Entra account is required for PvP.');

  let acknowledgedContent = null;
  let publishing = null;
  const submissions = new Map();

  async function publishContent(state, revision) {
    if (!isOnline()) return { ok: false, reason: 'offline' };
    if (!Number.isSafeInteger(revision) || revision < 1) return { ok: false, reason: 'save-revision-unavailable' };
    let content;
    try { content = stableStringify(buildPvpSnapshotContent(state)); }
    catch { return { ok: false, reason: 'invalid-local-snapshot' }; }
    if (content === acknowledgedContent) return { ok: true, changed: false };
    if (publishing) {
      await publishing;
      if (content === acknowledgedContent) return { ok: true, changed: false };
    }
    const task = (async () => {
      try {
        const response = await apiClient.publishPvpSnapshot(account, { expectedSaveRevision:revision });
        if (response?.status === 401 || response?.status === 403) return { ok: false, reason: 'authentication-required' };
        if (response?.status !== 200 || !response.snapshot) {
          return { ok: false, reason: response?.code ?? `snapshot-${response?.status ?? 'failed'}` };
        }
        const snapshotContent = stableStringify({
          character:response.snapshot.character,
          equipment:response.snapshot.equipment,
          combat:response.snapshot.combat,
        });
        if (snapshotContent !== content) return { ok:false, reason:'snapshot-revision-conflict' };
        acknowledgedContent = content;
        return { ok:true, changed:Boolean(response.changed), snapshot:response.snapshot };
      } catch (error) {
        return {
          ok:false,
          reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable',
        };
      }
    })();
    publishing = task;
    try { return await task; }
    finally { if (publishing === task) publishing = null; }
  }

  async function onCloudSaveSynced({ state = getCurrentState(), revision = getSaveRevision() } = {}) {
    return publishContent(state, revision);
  }

  async function publishCurrentSnapshot() {
    if (!isOnline()) return { ok:false, reason:'offline' };
    let synced;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { synced = await syncPendingSave(); }
      catch { return { ok:false, reason:'save-sync-failed' }; }
      if (!synced?.ok) return { ok:false, reason:synced?.error ?? 'save-sync-failed' };
      if (!synced.pending) break;
      if (attempt === 3) return { ok:false, reason:'save-sync-pending' };
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let refresh;
    try { refresh = await refreshAccountSave(); }
    catch { return { ok:false, reason:'save-refresh-failed' }; }
    if (refresh?.status !== 'ready' || refresh.mode !== 'online' || getMode() !== 'online') {
      return { ok:false, reason:refresh?.code ?? 'save-refresh-failed' };
    }
    let result = await publishContent(getCurrentState(), getSaveRevision());
    if (!result.ok && result.reason === 'save-revision-conflict' && isOnline()) {
      try { refresh = await refreshAccountSave(); }
      catch { return { ok:false, reason:'save-refresh-failed' }; }
      if (refresh?.status !== 'ready' || refresh.mode !== 'online') return { ok:false, reason:'save-refresh-failed' };
      result = await publishContent(getCurrentState(), getSaveRevision());
    }
    return result;
  }

  async function findMatch() {
    const snapshot = await publishCurrentSnapshot();
    if (!snapshot.ok) return { ok:false, reason:snapshot.reason };
    if (!isOnline()) return { ok:false, reason:'offline' };
    let response;
    try { response = await apiClient.searchPvpMatch(account, {}); }
    catch (error) {
      return {
        ok:false,
        reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable',
      };
    }
    if (response?.status === 409 && response.code === 'snapshot-required') {
      acknowledgedContent = null;
      const republished = await publishContent(getCurrentState(), getSaveRevision());
      if (!republished.ok) return republished;
      try { response = await apiClient.searchPvpMatch(account, {}); }
      catch (error) {
        return { ok:false, reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable' };
      }
    }
    if (response?.status === 201 && validMatchTicket(response.ticket) &&
        Date.parse(response.ticket.expiresAtUtc) > now().getTime()) return { ok:true, ticket:response.ticket };
    if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
    if (response?.status === 404 && response.code === 'no-opponent') {
      return {
        ok:false,
        reason:'no-opponent',
        search:{ initialWindow:100, maximumWindow:500, windowStep:100, intervalMs:5_000, waitMs:60_000 },
      };
    }
    return { ok:false, reason:response?.code ?? `match-search-${response?.status ?? 'failed'}` };
  }

  async function submitMatch(ticket, inputs) {
    if (!ticket || typeof ticket.matchId !== 'string' || !Array.isArray(inputs)) {
      return { ok:false, reason:'invalid-match-result' };
    }
    const inputJson = JSON.stringify(inputs);
    const submitted = submissions.get(ticket.matchId);
    if (submitted && submitted !== inputJson) return { ok:false, reason:'match-payload-changed' };
    submissions.set(ticket.matchId, inputJson);
    if (!isOnline()) return { ok:false, reason:'network-unavailable' };

    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await apiClient.submitPvpResult(account, ticket.matchId, { inputs });
        if (response?.status < 500 || attempt === 1) break;
      } catch (error) {
        if (error?.name === 'CloudSaveAuthenticationError') return { ok:false, reason:'authentication-required' };
        if (attempt === 1) return { ok:false, reason:'network-unavailable' };
      }
    }
    if (response?.status === 200) {
      const result = response.result ?? response;
      if (['win', 'loss', 'draw'].includes(result.outcome) && typeof result.rated === 'boolean' &&
          Number.isSafeInteger(result.playerRatingBefore) && Number.isSafeInteger(result.playerRatingAfter) &&
          Number.isSafeInteger(result.opponentRatingAfter) && Number.isFinite(result.remainingHpPercent) &&
          result.remainingHpPercent >= 0 && result.remainingHpPercent <= 1) {
        return {
          ok:true,
          result:{
            outcome:result.outcome,
            rated:result.rated,
            playerRatingBefore:result.playerRatingBefore,
            playerRatingAfter:result.playerRatingAfter,
            opponentRatingAfter:result.opponentRatingAfter,
            remainingHpPercent:result.remainingHpPercent,
          },
        };
      }
      return { ok:false, reason:'invalid-server-result' };
    }
    if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
    if (response?.status === 410) return { ok:false, reason:'match-expired' };
    return { ok:false, reason:response?.code ?? `match-result-${response?.status ?? 'failed'}` };
  }

  async function retryAuthentication() {
    try { return await reauthenticate(); }
    catch { return { ok:false }; }
  }

  return { publishCurrentSnapshot, onCloudSaveSynced, findMatch, submitMatch, retryAuthentication };
}
