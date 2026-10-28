import { BALANCE } from '../data/balance.js';
import { derivePlayerStats } from './gear.js';

export const MAX_RANKED_INPUT_EVENTS = 100_000;
export const MAX_RANKED_INPUT_BYTES = 1024 * 1024;
export const RANKED_TICK_MS = 1000 / 60;

const LEVEL_UP_STATS = new Set(['attack', 'defense', 'maxHp']);

export function deriveRankedPlayerSnapshot(state, chapter, stage) {
  const stats = derivePlayerStats(state);
  const effects = Object.values(state.equipment).flatMap((item) =>
    item?.effects?.map(({ id, value }) => ({ id, value })) ?? []);
  const isReplay = state.progression?.clearedStageIds?.includes(`${chapter}-${stage}`) ?? false;
  return {
    maxHp: stats.maxHp,
    currentHp: state.player.currentHp,
    attack: stats.attack,
    defense: stats.defense,
    critChance: stats.critChance,
    critMultiplier: stats.critMultiplier,
    moveSpeed: stats.moveSpeed,
    effects,
    level: state.player.level,
    xp: state.player.xp,
    xpToNext: state.player.xpToNext,
    pendingLevelUps: state.player.pendingLevelUps,
    availableStatPoints: state.player.availableStatPoints,
    spentStatPoints: state.player.spentStatPoints,
    replayXpMultiplier: isReplay ? BALANCE.replayXpMultiplier : 1,
  };
}

function sameSnapshot(expected, actual) {
  const numericFields = [
    'maxHp', 'currentHp', 'attack', 'defense', 'critChance', 'critMultiplier', 'moveSpeed',
    'level', 'xp', 'xpToNext', 'pendingLevelUps', 'availableStatPoints', 'spentStatPoints', 'replayXpMultiplier',
  ];
  if (numericFields.some((field) => expected[field] !== actual?.[field])) return false;
  const sortEffects = (effects) => [...(effects ?? [])]
    .map(({ id, value }) => ({ id, value }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.value - right.value);
  return JSON.stringify(sortEffects(expected.effects)) === JSON.stringify(sortEffects(actual?.effects));
}

function unranked(reason) {
  return { ranked: false, reason };
}

function terminalStageResponse(result) {
  return result?.status === 200 || result?.status === 410 || result?.status === 422 ||
    (result?.status === 409 && ['run-already-completed', 'unsupported-simulator-version'].includes(result.code));
}

export async function requestStageTicket(apiClient, { chapter, stage, saveRevision, account } = {}) {
  if (!apiClient || typeof apiClient.startStageRun !== 'function') {
    throw new TypeError('A stage-run API client is required.');
  }
  if (!Number.isSafeInteger(chapter) || chapter < 1 || !Number.isInteger(stage) || stage < 1 || stage > 10 ||
      !Number.isSafeInteger(saveRevision) || saveRevision < 1) {
    throw new TypeError('Chapter, stage and save revision are required to request a stage ticket.');
  }
  const response = await apiClient.startStageRun(account, {
    chapter,
    stage,
    expectedSaveRevision: saveRevision,
  });
  return response?.status === 201 && response.ticket
    ? { ok: true, ticket: response.ticket }
    : { ok: false, reason: response?.code ?? `ticket-request-${response?.status ?? 'failed'}` };
}

function validTicket(ticket, chapter, stage, now) {
  if (!ticket || typeof ticket !== 'object' || typeof ticket.runId !== 'string' || !ticket.runId ||
      ticket.chapter !== chapter || ticket.stage !== stage ||
      !Number.isInteger(ticket.seed) || ticket.seed < 1 || ticket.seed > 0xffffffff ||
      ![4, 5].includes(ticket.simulatorVersion) || ticket.balanceVersion !== 2 ||
      typeof ticket.issuedAtUtc !== 'string' || typeof ticket.expiresAtUtc !== 'string' ||
      !ticket.playerSnapshot || typeof ticket.playerSnapshot !== 'object') return false;
  const expiresAt = Date.parse(ticket.expiresAtUtc);
  return Number.isFinite(expiresAt) && now.getTime() < expiresAt;
}

export function createRankedRunClient({
  apiClient,
  account,
  getSaveRevision = () => null,
  getCurrentState = () => null,
  getMode = () => 'offline-unverified',
  syncPendingSave = async () => ({ ok: false, error: 'save-sync-unavailable' }),
  refreshAccountSave = async () => ({ status: 'error', code: 'account-refresh-unavailable' }),
  saveState = () => ({ ok: true }),
  selectLocalShadow = async () => ({ ok:false, error:'local-shadow-unavailable' }),
  applyVerifiedState = null,
  installVerifiedState = () => ({ ok: true }),
  isOnline = () => globalThis.navigator?.onLine !== false,
  now = () => new Date(),
} = {}) {
  let pendingTicket = null;
  const installVerifiedEnvelope = typeof applyVerifiedState === 'function'
    ? applyVerifiedState
    : installVerifiedState;

  async function fallbackToLocal(reason) {
    try {
      const selected = await selectLocalShadow(reason, { preferExisting:true });
      if (selected?.ok && selected.state) return { ...unranked(reason), gameState:selected.state, shadowSelected:true };
    } catch { /* Local play remains available if recovery storage fails. */ }
    return unranked(reason);
  }

  async function preserveUnverifiedProgress(reason, state = getCurrentState()) {
    const provisionalState = state ?? getCurrentState();
    if (getMode() !== 'verified-online') {
      try {
        const saved = await saveState(provisionalState);
        if (saved?.ok === false) return { ...saved, state:provisionalState };
        return { ok:true, state:provisionalState, mode:getMode(), reason };
      } catch {
        return { ok:false, error:'offline-save-unavailable', state:provisionalState };
      }
    }
    let selected;
    try {
      selected = await selectLocalShadow(reason, { preferExisting:false });
    } catch {
      return { ok:false, error:'local-shadow-unavailable' };
    }
    if (!selected?.ok || !selected.state) return { ok:false, error:selected?.error ?? 'local-shadow-unavailable' };
    const stateToSave = provisionalState ?? selected.state;
    try {
      const saved = await saveState(stateToSave);
      if (saved?.ok === false) return { ...saved, state:stateToSave };
    } catch {
      return { ok:false, error:'offline-save-unavailable', state:stateToSave };
    }
    return { ok:true, state:stateToSave, mode:getMode(), reason };
  }

  async function rejectUnverifiedResult(code, terminal = false) {
    if (code !== 'stale-account-operation') await preserveUnverifiedProgress(code);
    return { verified:false, code, ...(terminal ? { terminal:true } : {}) };
  }

  async function syncBeforeTicket() {
    if (getMode() !== 'verified-online') {
      return { ok:false, reason:getMode() === 'guest-unverified' ? 'guest-unverified' : 'unverified-shadow' };
    }
    if (!isOnline()) return { ok: false, reason: 'offline' };
    let synced;
    try {
      synced = await syncPendingSave();
    } catch {
      return { ok: false, reason: 'save-sync-failed' };
    }
    if (!synced?.ok) return { ok: false, reason: synced?.error ?? 'save-sync-failed' };
    if (getMode() !== 'verified-online') {
      let refreshed;
      try {
        refreshed = await refreshAccountSave();
      } catch {
        return { ok: false, reason: 'save-refresh-failed' };
      }
      if (refreshed?.status !== 'ready' || refreshed.mode !== 'verified-online' || getMode() !== 'verified-online') {
        return { ok: false, reason: refreshed?.code ?? 'save-refresh-failed' };
      }
    }
    const revision = getSaveRevision();
    if (!Number.isSafeInteger(revision) || revision < 1) return { ok: false, reason: 'save-revision-unavailable' };
    return { ok: true, revision, state: getCurrentState() };
  }

  async function issueTicket(chapter, stage, revision) {
    try {
      return await requestStageTicket(apiClient, { chapter, stage, saveRevision: revision, account });
    } catch {
      return { ok: false, reason: 'ticket-request-failed' };
    }
  }

  async function abandonTicket(ticket, inputs = []) {
    if (!isOnline()) return false;
    try {
      const result = await apiClient.submitStageResult(account, ticket.runId, { inputs });
      const terminal = terminalStageResponse(result);
      if (terminal && pendingTicket?.runId === ticket.runId) pendingTicket = null;
      return terminal;
    } catch {
      return false;
    }
  }

  async function prepareStage({ chapter, stage, gameState } = {}) {
    if (getMode() !== 'verified-online') {
      return fallbackToLocal(getMode() === 'guest-unverified' ? 'guest-unverified' : 'unverified-shadow');
    }
    if (!isOnline()) return fallbackToLocal('offline');
    if (pendingTicket && !await abandonTicket(pendingTicket)) return fallbackToLocal('active-run-cleanup-failed');
    let synced = await syncBeforeTicket();
    if (!synced.ok) return fallbackToLocal(synced.reason);
    let currentState = gameState ?? synced.state;
    let issued = await issueTicket(chapter, stage, synced.revision);
    if (!issued.ok) return fallbackToLocal(issued.reason);

    let ticket = issued.ticket;
    const isValid = () => validTicket(ticket, chapter, stage, now()) &&
      sameSnapshot(deriveRankedPlayerSnapshot(currentState, chapter, stage), ticket.playerSnapshot);
    if (isValid()) {
      pendingTicket = ticket;
      return { ranked: true, ticket, playerSnapshot: ticket.playerSnapshot, gameState: currentState };
    }

    if (!validTicket(ticket, chapter, stage, now())) {
      await abandonTicket(ticket);
      return fallbackToLocal('invalid-or-expired-ticket');
    }

    // Reconcile local state into the account save before a single ticket retry.
    const localSave = saveState(currentState);
    if (localSave?.ok === false || !await abandonTicket(ticket)) return fallbackToLocal('snapshot-mismatch');
    synced = await syncBeforeTicket();
    if (!synced.ok) return fallbackToLocal(synced.reason);
    currentState = getCurrentState() ?? currentState;
    issued = await issueTicket(chapter, stage, synced.revision);
    if (!issued.ok) return fallbackToLocal(issued.reason);
    ticket = issued.ticket;
    if (!validTicket(ticket, chapter, stage, now())) {
      await abandonTicket(ticket);
      return fallbackToLocal('invalid-or-expired-ticket');
    }
    if (!sameSnapshot(deriveRankedPlayerSnapshot(currentState, chapter, stage), ticket.playerSnapshot)) {
      await abandonTicket(ticket);
      return fallbackToLocal('snapshot-mismatch');
    }
    pendingTicket = ticket;
    return { ranked: true, ticket, playerSnapshot: ticket.playerSnapshot, gameState: currentState };
  }

  async function submitResult(ticket, inputs) {
    if (!ticket) return { verified: false, code: 'no-stage-ticket' };
    if (!isOnline()) return rejectUnverifiedResult('network-unavailable');
    try {
      const result = await apiClient.submitStageResult(account, ticket.runId, { inputs });
      if (terminalStageResponse(result)) {
        if (pendingTicket?.runId === ticket.runId) pendingTicket = null;
      }
      if (result?.status === 200 && result.verified === true &&
          (result.outcome === 'clear' || result.outcome === 'death')) {
        const validClearTime = result.outcome === 'clear'
          ? Number.isSafeInteger(result.clearTimeMs) && result.clearTimeMs > 0
          : result.clearTimeMs === null;
        if (!validClearTime || !Number.isSafeInteger(result.revision) || result.revision < 1 ||
            !result.state || typeof result.state !== 'object') {
          return rejectUnverifiedResult('verified-state-missing', true);
        }
        const installed = await installVerifiedEnvelope({ revision: result.revision, state: result.state });
        if (installed?.ok === false) {
          return rejectUnverifiedResult(installed.error ?? 'verified-state-install-failed', true);
        }
        return {
          verified: true,
          outcome: result.outcome,
          clearTimeMs: result.clearTimeMs,
          revision: installed?.revision ?? result.revision,
          state: installed?.state ?? result.state,
          rewards: result.rewards,
          terminal: true,
        };
      }
      return rejectUnverifiedResult(
        result?.code ?? `result-${result?.status ?? 'failed'}`,
        terminalStageResponse(result),
      );
    } catch (error) {
      return rejectUnverifiedResult(
        error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable',
      );
    }
  }

  async function abandonRun(ticket = pendingTicket, inputs = []) {
    if (!ticket) return true;
    return abandonTicket(ticket, inputs);
  }

  return { prepareStage, submitResult, abandonRun, preserveUnverifiedProgress };
}

export function createRunInputRecorder({ maxEvents = MAX_RANKED_INPUT_EVENTS, maxBytes = MAX_RANKED_INPUT_BYTES } = {}) {
  const inputs = [];
  const encoder = new TextEncoder();
  const emptyPayloadBytes = encoder.encode('{"inputs":[]}').length;
  let encodedBytes = emptyPayloadBytes;
  let lastDirection = 0;
  let error = null;

  function append(event) {
    if (error) return { ok: false, reason: error };
    if (inputs.length >= maxEvents) {
      error = 'too-many-input-events';
      return { ok: false, reason: error };
    }
    const addedBytes = encoder.encode(JSON.stringify(event)).length + (inputs.length ? 1 : 0);
    if (encodedBytes + addedBytes > maxBytes) {
      error = 'input-payload-too-large';
      return { ok: false, reason: error };
    }
    inputs.push(event);
    encodedBytes += addedBytes;
    return { ok: true, recorded: true };
  }

  return {
    recordMove(tick, direction) {
      if (![-1, 0, 1].includes(direction)) throw new RangeError('Movement direction must be -1, 0 or 1.');
      if (direction === lastDirection) return { ok: !error, recorded: false, reason: error };
      const result = append({ tick, kind: 'move', value: direction });
      if (result.ok) lastDirection = direction;
      return result;
    },
    recordLevelUp(tick, allocations) {
      if (!Array.isArray(allocations) || allocations.length > 2 ||
          Array.from({ length: allocations.length }, (_, index) => allocations[index]).some((stat) => !LEVEL_UP_STATS.has(stat))) {
        throw new RangeError('Unsupported ranked level-up allocation.');
      }
      return append({ tick, kind: 'levelUp', value: [...allocations] });
    },
    getInputs() { return inputs.map((event) => ({ ...event })); },
    getError() { return error; },
  };
}

export function createFixedStepAccumulator({ stepMs = RANKED_TICK_MS, maxSteps = 5 } = {}) {
  let accumulatedMs = 0;
  return {
    push(deltaMs) {
      if (Number.isFinite(deltaMs) && deltaMs > 0) accumulatedMs += deltaMs;
      const availableSteps = Math.floor((accumulatedMs + 1e-8) / stepMs);
      const steps = Math.min(availableSteps, maxSteps);
      const discardedSteps = Math.max(0, availableSteps - steps);
      accumulatedMs -= (steps + discardedSteps) * stepMs;
      return { steps, discardedSteps };
    },
    reset() { accumulatedMs = 0; },
  };
}
