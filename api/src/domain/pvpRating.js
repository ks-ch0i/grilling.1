import { derivePlayerCombatSnapshot, StageRunValidationError } from './stageRank.js';

export const MATCH_TTL_MS = 10 * 60 * 1000;
export const MATCH_TIME_LIMIT_MS = 60_000;
export const MAX_MATCH_RESULT_BYTES = 1024 * 1024;
export const MAX_MATCH_INPUT_EVENTS = 100_000;

const GUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class PvpValidationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'PvpValidationError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

export function calculateElo(rating1, rating2, outcome) {
  if (!Number.isInteger(rating1) || !Number.isInteger(rating2) || !['win', 'loss', 'draw'].includes(outcome)) {
    throw new TypeError('Elo inputs must be integer ratings and a valid PvP outcome.');
  }
  if (outcome === 'draw') return { player1: rating1, player2: rating2 };
  const expected1 = 1 / (1 + 10 ** ((rating2 - rating1) / 400));
  const score1 = outcome === 'win' ? 1 : 0;
  return {
    player1: Math.round(rating1 + 32 * (score1 - expected1)),
    player2: Math.round(rating2 + 32 * ((1 - score1) - (1 - expected1))),
  };
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildSnapshotContent(saveState) {
  try {
    return {
      character: {
        level: saveState.player.level,
        baseStats: { ...saveState.player.baseStats },
      },
      equipment: structuredClone(saveState.equipment),
      combat: derivePlayerCombatSnapshot(saveState),
    };
  } catch (error) {
    if (error instanceof StageRunValidationError) throw new PvpValidationError('invalid-save-snapshot', error.message);
    throw error;
  }
}

export function validateSnapshotRequest(body) {
  if (!hasExactKeys(body, ['expectedSaveRevision']) ||
      !Number.isSafeInteger(body.expectedSaveRevision) || body.expectedSaveRevision < 1) {
    throw new PvpValidationError('invalid-snapshot-request');
  }
  return { expectedSaveRevision: body.expectedSaveRevision };
}

export function validateSearchRequest(body) {
  if (!isPlainObject(body) || Object.keys(body).length !== 0) throw new PvpValidationError('invalid-match-search');
  return {};
}

export function validatePvpInputs(body) {
  if (!hasExactKeys(body, ['inputs']) || !Array.isArray(body.inputs) || body.inputs.length > MAX_MATCH_INPUT_EVENTS) {
    throw new PvpValidationError('invalid-input-log');
  }
  const inputs = body.inputs.map((event) => {
    if (!hasExactKeys(event, ['tick', 'kind', 'value']) || !Number.isSafeInteger(event.tick) ||
        event.tick < 0 || event.tick >= MATCH_TIME_LIMIT_MS / (1000 / 60) ||
        event.kind !== 'move' || ![-1, 0, 1].includes(event.value)) {
      throw new PvpValidationError('invalid-input-log');
    }
    return { tick: event.tick, kind: 'move', value: event.value };
  });
  return { inputs };
}

export function isMatchId(value) {
  return typeof value === 'string' && GUID_PATTERN.test(value);
}
