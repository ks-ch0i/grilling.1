import { derivePlayerStats } from './gear.js';

const MATCH_TICKS = 60 * 60;
const PVP_HISTORY_PAGE_SIZE = 10;
const MAX_PVP_HISTORY_PAGE = 100_000;
const SEARCH_POLL_INTERVAL_MS = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_STATES = new Set(['searching', 'matched', 'started', 'cancelled', 'expired', 'no-opponent']);

function validUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function createRandomUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Secure random UUID generation is unavailable.');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function historyItemFrom(value) {
  if (!value || typeof value !== 'object' ||
      typeof value.matchId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.matchId) ||
      typeof value.completedAtUtc !== 'string' || !Number.isFinite(Date.parse(value.completedAtUtc)) ||
      typeof value.opponentDisplayName !== 'string' ||
      !['win', 'loss', 'draw'].includes(value.outcome) ||
      typeof value.rated !== 'boolean' ||
      !Number.isSafeInteger(value.ratingBefore) ||
      !Number.isSafeInteger(value.ratingAfter) ||
      !Number.isSafeInteger(value.opponentRatingAfter)) return null;
  return {
    matchId: value.matchId,
    completedAtUtc: value.completedAtUtc,
    opponentDisplayName: value.opponentDisplayName,
    outcome: value.outcome,
    rated: value.rated,
    ratingBefore: value.ratingBefore,
    ratingAfter: value.ratingAfter,
    opponentRatingAfter: value.opponentRatingAfter,
  };
}

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
  return Boolean(ticket && validUuid(ticket.matchId) &&
    Number.isInteger(ticket.seed) && ticket.seed >= 1 && ticket.seed <= 0xffffffff &&
    ticket.simulatorVersion === 2 && ticket.balanceVersion === 2 && ticket.timeLimitMs === 60_000 &&
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
  getMode = () => 'offline-unverified',
  syncPendingSave = async () => ({ ok: false, error: 'save-sync-unavailable' }),
  refreshAccountSave = async () => ({ status: 'error', code: 'account-refresh-unavailable' }),
  isOnline = () => globalThis.navigator?.onLine !== false,
  reauthenticate = async () => ({ ok: false }),
  now = () => new Date(),
  createSearchId = createRandomUuid,
  wait = pause,
} = {}) {
  for (const method of [
    'publishPvpSnapshot', 'searchPvpMatch', 'getPvpSearch', 'cancelPvpSearch', 'startPvpMatch',
    'submitPvpResult', 'getPvpMatchHistory',
  ]) {
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
    if (getMode() !== 'verified-online') {
      return { ok:false, reason:getMode() === 'guest-unverified' ? 'guest-unverified' : 'unverified-shadow' };
    }
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
    if (refresh?.status !== 'ready' || refresh.mode !== 'verified-online' || getMode() !== 'verified-online') {
      return { ok:false, reason:refresh?.code ?? 'save-refresh-failed' };
    }
    let result = await publishContent(getCurrentState(), getSaveRevision());
    if (!result.ok && result.reason === 'save-revision-conflict' && isOnline()) {
      try { refresh = await refreshAccountSave(); }
      catch { return { ok:false, reason:'save-refresh-failed' }; }
      if (refresh?.status !== 'ready' || refresh.mode !== 'verified-online') return { ok:false, reason:'save-refresh-failed' };
      result = await publishContent(getCurrentState(), getSaveRevision());
    }
    return result;
  }

  function outcomeForSearchState(state, ticket, searchId) {
    if (state === 'searching') return null;
    if (state === 'matched' || state === 'started') {
      if (!validMatchTicket(ticket)) return { ok:false, reason:'invalid-match-ticket', state };
      if (Date.parse(ticket.expiresAtUtc) <= now().getTime()) return { ok:false, reason:'match-expired', state:'expired' };
      return { ok:true, ticket, searchId, state };
    }
    if (state === 'cancelled') return { ok:false, reason:'cancelled', state };
    if (state === 'expired') return { ok:false, reason:'search-expired', state };
    if (state === 'no-opponent') return {
      ok:false,
      reason:'no-opponent',
      state,
      search:{ initialWindow:100, maximumWindow:500, windowStep:100, intervalMs:5_000, waitMs:60_000 },
    };
    return { ok:false, reason:'invalid-search-response' };
  }

  async function readSearchStatus(searchId) {
    if (!validUuid(searchId)) return { ok:false, reason:'invalid-search-id' };
    try {
      const response = await apiClient.getPvpSearch(account, searchId);
      if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
      if (response?.status === 404 && response.code === 'search-not-found') return { ok:false, reason:'search-not-found' };
      if (response?.status !== 200 || response.searchId !== searchId || !SEARCH_STATES.has(response.state)) {
        return { ok:false, reason:response?.code ?? `search-status-${response?.status ?? 'failed'}` };
      }
      return { ok:true, state:response.state, ticket:response.ticket };
    } catch (error) {
      return { ok:false, reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable' };
    }
  }

  async function getSearchStatus(searchId) {
    if (!isOnline()) return { ok:false, reason:'network-unavailable' };
    const response = await readSearchStatus(searchId);
    if (!response.ok) return response;
    if (response.state === 'searching') return { ok:true, state:response.state };
    return outcomeForSearchState(response.state, response.ticket, searchId) ?? { ok:true, state:response.state };
  }

  async function reconcileCancel(searchId, getKnownTicket) {
    let bootstrapRequested = false;
    while (true) {
      if (!isOnline()) {
        await wait(1_000);
        continue;
      }
      let response;
      try {
        response = await apiClient.cancelPvpSearch(account, searchId);
      } catch (error) {
        response = null;
      }
      if (response?.searchId === searchId && SEARCH_STATES.has(response.state)) {
        if (response.state === 'started') {
          const current = response.ticket ?? getKnownTicket();
          if (validMatchTicket(current)) return outcomeForSearchState('started', current, searchId);
        } else if (response.state === 'cancelled' || response.state === 'expired' || response.state === 'no-opponent') {
          return outcomeForSearchState(response.state, response.ticket, searchId);
        }
      }

      const status = await readSearchStatus(searchId);
      if (status.ok) {
        if (status.state === 'started') {
          const current = status.ticket ?? getKnownTicket();
          if (validMatchTicket(current)) return outcomeForSearchState('started', current, searchId);
        } else if (status.state === 'cancelled' || status.state === 'expired' || status.state === 'no-opponent') {
          return outcomeForSearchState(status.state, status.ticket, searchId);
        }
      } else if (status.reason === 'authentication-required') {
        await wait(5_000);
        continue;
      } else if (status.reason === 'search-not-found' && !bootstrapRequested) {
        // An ambiguous first POST may not have reached the service yet. Reuse its ID to ensure
        // the cancellation has a durable server state; the request itself may long-poll.
        bootstrapRequested = true;
        void apiClient.searchPvpMatch(account, { searchId }).catch(() => { bootstrapRequested = false; });
      }
      await wait(SEARCH_POLL_INTERVAL_MS);
    }
  }

  async function runSearch(searchId, isCancelled, requestSent, signalCancel) {
    const snapshot = await publishCurrentSnapshot();
    if (isCancelled()) return { ok:false, reason:'cancelled', state:'cancelled' };
    if (!snapshot.ok) return { ok:false, reason:snapshot.reason };
    if (!isOnline()) return { ok:false, reason:'offline' };
    requestSent();

    const findOnServer = async () => {
      while (true) {
        if (isCancelled()) return { ok:false, reason:'cancelled', state:'cancelled' };
        if (!isOnline()) {
          await wait(1_000);
          continue;
        }
        let response;
        try {
          response = await apiClient.searchPvpMatch(account, { searchId });
        } catch (error) {
          if (error?.name === 'CloudSaveAuthenticationError') return { ok:false, reason:'authentication-required' };
          const status = await readSearchStatus(searchId);
          if (status.ok) {
            const result = outcomeForSearchState(status.state, status.ticket, searchId);
            if (result) return result;
          } else if (status.reason === 'authentication-required') return status;
          await wait(1_000);
          continue;
        }
        if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
        if (response?.status === 409 && response.code === 'snapshot-required') {
          acknowledgedContent = null;
          const republished = await publishContent(getCurrentState(), getSaveRevision());
          if (!republished.ok) return republished;
          continue;
        }
        if (response?.state && SEARCH_STATES.has(response.state) && response.searchId === searchId) {
          const result = outcomeForSearchState(response.state, response.ticket, searchId);
          if (result) return result;
          while (!isCancelled()) {
            await wait(SEARCH_POLL_INTERVAL_MS);
            const status = await readSearchStatus(searchId);
            if (!status.ok) {
              if (status.reason === 'authentication-required') return status;
              if (status.reason === 'search-not-found') break;
              continue;
            }
            const polled = outcomeForSearchState(status.state, status.ticket, searchId);
            if (polled) return polled;
          }
          continue;
        }
        if (response?.status === 404 && response.code === 'no-opponent') {
          return outcomeForSearchState('no-opponent', undefined, searchId);
        }
        if (response?.status === 404 && response.code === 'search-not-found') {
          await wait(1_000);
          continue;
        }
        const status = await readSearchStatus(searchId);
        if (status.ok) {
          const result = outcomeForSearchState(status.state, status.ticket, searchId);
          if (result) return result;
        } else if (status.reason === 'authentication-required') return status;
        await wait(1_000);
      }
      return { ok:false, reason:'cancelled', state:'cancelled' };
    };

    const searchTask = findOnServer();
    const result = await Promise.race([
      searchTask,
      signalCancel.then((cancelPromise) => cancelPromise),
    ]);
    return result;
  }

  function createMatchSearch() {
    const searchId = createSearchId();
    if (!validUuid(searchId)) throw new TypeError('The search id generator must return a UUID.');
    let cancelled = false;
    let sent = false;
    let cancelPromise = null;
    let settledResult = null;
    let knownTicket = null;
    let signalCancel;
    const cancelSignal = new Promise((resolve) => { signalCancel = resolve; });

    const completion = (async () => {
      let result;
      try {
        result = await runSearch(searchId, () => cancelled, () => { sent = true; }, cancelSignal);
        if (cancelled && sent) result = await cancelPromise;
      } catch (error) {
        result = { ok:false, reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable' };
      }
      if (result?.ticket) knownTicket = result.ticket;
      settledResult = result;
      return result;
    })();

    async function cancel() {
      if (settledResult) {
        return settledResult.ok
          ? { ok:true, state:settledResult.state ?? 'started', ticket:settledResult.ticket }
          : { ok:settledResult.reason === 'cancelled', state:settledResult.state ?? settledResult.reason };
      }
      cancelled = true;
      if (!sent) return { ok:true, state:'cancelled', local:true };
      if (!cancelPromise) {
        cancelPromise = reconcileCancel(searchId, () => knownTicket);
        signalCancel(cancelPromise);
      }
      const result = await cancelPromise;
      if (result.ok) return { ok:true, state:result.state, ticket:result.ticket };
      if (['cancelled', 'expired', 'no-opponent'].includes(result.state)) return { ok:true, state:result.state };
      return result;
    }

    return { searchId, completion, cancel };
  }

  async function findMatch() {
    const handle = createMatchSearch();
    return handle.completion;
  }

  async function startMatch(searchId, matchId) {
    if (!validUuid(searchId) || !validUuid(matchId)) return { ok:false, reason:'invalid-match-start' };
    if (!isOnline()) return { ok:false, reason:'network-unavailable' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        response = await apiClient.startPvpMatch(account, matchId, { searchId });
      } catch (error) {
        if (error?.name === 'CloudSaveAuthenticationError') return { ok:false, reason:'authentication-required' };
      }
      if (response?.status === 200 && response.searchId === searchId && response.matchId === matchId && response.state === 'started') {
        return { ok:true, searchId, matchId, state:'started' };
      }
      if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
      if (response?.status === 410 || response?.state === 'expired') return { ok:false, reason:'match-expired' };
      if (response?.status === 409 && response.state === 'cancelled') return { ok:false, reason:'search-cancelled' };

      const status = await readSearchStatus(searchId);
      if (status.reason === 'authentication-required') return status;
      if (status.ok && status.state === 'started' && status.ticket?.matchId === matchId) {
        return { ok:true, searchId, matchId, state:'started' };
      }
      if (status.ok && status.state === 'matched' && status.ticket?.matchId === matchId) continue;
      if (status.ok && status.state === 'cancelled') return { ok:false, reason:'search-cancelled' };
      if (status.ok && status.state === 'expired') return { ok:false, reason:'match-expired' };
      if (status.ok && status.state === 'no-opponent') return { ok:false, reason:'no-opponent' };
      if (status.ok && status.state === 'searching') return { ok:false, reason:'match-not-ready' };
      if (attempt === 1) return { ok:false, reason:'start-outcome-unknown' };
      await wait(250);
    }
    return { ok:false, reason:'start-outcome-unknown' };
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

  async function getMatchHistory(page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > MAX_PVP_HISTORY_PAGE) {
      return { ok:false, reason:'invalid-history-page' };
    }
    if (!isOnline()) return { ok:false, reason:'network-unavailable' };
    let response;
    try {
      response = await apiClient.getPvpMatchHistory(account, page);
    } catch (error) {
      return {
        ok:false,
        reason:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable',
      };
    }
    if (response?.status === 401 || response?.status === 403) return { ok:false, reason:'authentication-required' };
    if (response?.status >= 500) return { ok:false, reason:'network-unavailable' };
    if (response?.status !== 200) return { ok:false, reason:response?.code ?? `match-history-${response?.status ?? 'failed'}` };
    if (response.page !== page || response.pageSize !== PVP_HISTORY_PAGE_SIZE ||
        typeof response.hasPrevious !== 'boolean' || typeof response.hasNext !== 'boolean' ||
        !Array.isArray(response.items) || response.items.length > PVP_HISTORY_PAGE_SIZE) {
      return { ok:false, reason:'invalid-history-response' };
    }
    const items = response.items.map(historyItemFrom);
    if (items.some((item) => item === null)) return { ok:false, reason:'invalid-history-response' };
    return {
      ok:true,
      page,
      pageSize:PVP_HISTORY_PAGE_SIZE,
      hasPrevious:response.hasPrevious,
      hasNext:response.hasNext,
      items,
    };
  }

  async function retryAuthentication() {
    try { return await reauthenticate(); }
    catch { return { ok:false }; }
  }

  return {
    publishCurrentSnapshot,
    onCloudSaveSynced,
    createMatchSearch,
    getSearchStatus,
    startMatch,
    findMatch,
    submitMatch,
    getMatchHistory,
    retryAuthentication,
  };
}
