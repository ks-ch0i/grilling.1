import { BALANCE, GEAR_SLOT } from '@knight-run/game-rules/balance';

export const SIMULATOR_VERSION = 1;
export const BALANCE_VERSION = 1;
export const STAGE_RUN_TTL_MS = 30 * 60 * 1000;
export const MAX_STAGE_RESULT_BYTES = 1024 * 1024;
export const MAX_STAGE_INPUT_EVENTS = 100_000;
export const MAX_REPLAY_TICKS = 360_000;

const LEVEL_UP_STATS = new Set(['attack', 'defense', 'maxHp']);
const GUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class StageRunValidationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'StageRunValidationError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new StageRunValidationError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, keys) {
  return isPlainObject(value) && Object.keys(value).every((key) => keys.includes(key));
}

export function validateStartRequest(body) {
  if (!hasOnlyKeys(body, ['chapter', 'stage', 'expectedSaveRevision']) ||
      Object.keys(body).length !== 3 ||
      !Number.isSafeInteger(body.chapter) || body.chapter < 1 || body.chapter > 2_147_483_647 ||
      !Number.isInteger(body.stage) || body.stage < 1 || body.stage > 10 ||
      !Number.isSafeInteger(body.expectedSaveRevision) || body.expectedSaveRevision < 1) {
    invalid('invalid-stage-request', 'Chapter, stage and expected save revision are required.');
  }
  return {
    chapter: body.chapter,
    stage: body.stage,
    expectedSaveRevision: body.expectedSaveRevision,
  };
}

export function validateStageInputs(body) {
  if (!hasOnlyKeys(body, ['inputs']) || Object.keys(body).length !== 1 ||
      !Array.isArray(body.inputs) || body.inputs.length > MAX_STAGE_INPUT_EVENTS) {
    invalid('invalid-input-log', 'The result body must contain a bounded inputs array.');
  }
  return {
    inputs: body.inputs.map((event) => {
      if (!hasOnlyKeys(event, ['tick', 'kind', 'value']) || Object.keys(event).length !== 3 ||
          !Number.isSafeInteger(event.tick) || event.tick < 0 || event.tick >= MAX_REPLAY_TICKS) {
        invalid('invalid-input-log', 'An input event has an invalid shape or tick.');
      }
      if (event.kind === 'move' && [-1, 0, 1].includes(event.value)) {
        return { tick: event.tick, kind: 'move', value: event.value };
      }
      if (event.kind === 'levelUp' && LEVEL_UP_STATS.has(event.value)) {
        return { tick: event.tick, kind: 'levelUp', value: event.value };
      }
      invalid('invalid-input-log', 'An input event has an unsupported kind or value.');
    }),
  };
}

export function isStageAccessible(state, chapter, stage) {
  const progression = state?.progression;
  if (!progression) return false;
  const requestedOrdinal = chapter * 10 + stage;
  const unlockedOrdinal = progression.unlockedChapter * 10 + progression.unlockedStage;
  const clearedIds = new Set(progression.clearedStageIds ?? []);
  return requestedOrdinal <= unlockedOrdinal || clearedIds.has(`${chapter}-${stage}`);
}

export function derivePlayerCombatSnapshot(state, chapter, stage) {
  if (!state?.player?.baseStats || !state?.equipment) {
    throw new StageRunValidationError('invalid-save-snapshot', 'Cloud save cannot produce combat stats.');
  }
  const stats = { ...state.player.baseStats };
  const effects = [];
  for (const [slot, item] of Object.entries(state.equipment)) {
    if (!item) continue;
    for (const [key, value] of Object.entries(item.stats)) {
      if (key === 'moveSpeedPercent') {
        if (slot === GEAR_SLOT.HORSE) stats.moveSpeed *= 1 + value;
      } else if (Object.hasOwn(stats, key)) {
        stats[key] += value;
      }
    }
    effects.push(...item.effects.map(({ id, value }) => ({ id, value })));
  }
  stats.critChance = Math.min(BALANCE.critChanceCap, stats.critChance);
  for (const key of ['maxHp', 'attack', 'defense']) stats[key] = Math.ceil(stats[key]);
  const snapshot = {
    maxHp: stats.maxHp,
    currentHp: state.player.currentHp,
    attack: stats.attack,
    defense: stats.defense,
    critChance: stats.critChance,
    critMultiplier: stats.critMultiplier,
    moveSpeed: stats.moveSpeed,
    effects,
  };
  if (Number.isInteger(chapter) && chapter >= 1 && Number.isInteger(stage) && stage >= 1 && stage <= 10) {
    snapshot.level = state.player.level;
    snapshot.xp = state.player.xp;
    snapshot.xpToNext = state.player.xpToNext;
    snapshot.pendingLevelUps = state.player.pendingLevelUps;
    snapshot.replayXpMultiplier = state.progression.clearedStageIds.includes(`${chapter}-${stage}`)
      ? BALANCE.replayXpMultiplier
      : 1;
  }
  if (Object.values(snapshot).some((value) => typeof value === 'number' && !Number.isFinite(value)) ||
      snapshot.maxHp <= 0 || snapshot.currentHp < 0 || snapshot.currentHp > snapshot.maxHp ||
      snapshot.attack < 0 || snapshot.defense < 0 || snapshot.moveSpeed < 0 ||
      snapshot.critChance < 0 || snapshot.critMultiplier < 0) {
    throw new StageRunValidationError('invalid-save-snapshot', 'Cloud save combat stats are outside the simulator range.');
  }
  return snapshot;
}

export function compareStageRank(a, b) {
  const ordinalA = a.chapter * 10 + a.stage;
  const ordinalB = b.chapter * 10 + b.stage;
  return ordinalB - ordinalA || a.clearTimeMs - b.clearTimeMs || String(a.playerId).localeCompare(String(b.playerId));
}

export function isRunId(value) {
  return typeof value === 'string' && GUID_PATTERN.test(value);
}
