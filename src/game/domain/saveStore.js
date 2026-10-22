import { GEAR_SLOT } from '../data/balance.js';
import { migrateGameState, validateGameStateV2 } from '@knight-run/game-rules/save';

export const SAVE_KEY = 'lancer-belt-scroll-game:save:v2';
export const LEGACY_SAVE_KEY = 'lancer-belt-scroll-game:save:v1';
const REQUIRED_EQUIPMENT_SLOTS = Object.values(GEAR_SLOT);
const PLAYER_STAT_KEYS = ['maxHp', 'attack', 'defense', 'critChance', 'critMultiplier', 'moveSpeed'];

function cloneState(state) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(state);
  return JSON.parse(JSON.stringify(state));
}

function getStorage(storage) {
  return storage ?? globalThis.localStorage;
}

function parseStored(storage, key) {
  let serialized;
  try {
    serialized = getStorage(storage).getItem(key);
    if (serialized === null) return { exists: false, raw: null, state: null };
    const value = JSON.parse(serialized);
    return { exists: true, raw: serialized, state: value };
  } catch {
    return { exists: serialized !== undefined && serialized !== null, raw: serialized ?? null, state: null };
  }
}

function toSaveData(state) {
  const copyGear = (item) => item === null ? null : ({
    id: item.id,
    slot: item.slot,
    rarity: item.rarity,
    level: item.level,
    stats: { ...item.stats },
    effects: item.effects.map(({ id, value }) => ({ id, value })),
  });
  return {
    schemaVersion: 2,
    player: {
      level: state.player.level,
      xp: state.player.xp,
      xpToNext: state.player.xpToNext,
      pendingLevelUps: state.player.pendingLevelUps,
      currentHp: state.player.currentHp,
      baseStats: Object.fromEntries(PLAYER_STAT_KEYS.map((key) => [key, state.player.baseStats[key]])),
      availableStatPoints: state.player.availableStatPoints,
      spentStatPoints: state.player.spentStatPoints,
      statResetCount: state.player.statResetCount,
    },
    equipment: Object.fromEntries(REQUIRED_EQUIPMENT_SLOTS.map((slot) => [slot, copyGear(state.equipment[slot])])),
    inventory: state.inventory.map(copyGear),
    materials: state.materials,
    gold: state.gold,
    progression: {
      chapter: state.progression.chapter,
      currentStage: state.progression.currentStage,
      unlockedChapter: state.progression.unlockedChapter,
      unlockedStage: state.progression.unlockedStage,
      clearedStageIds: [...state.progression.clearedStageIds],
    },
  };
}

export function isValidGameState(state) {
  return validateGameStateV2(state);
}

export function readSavedGame(storage, key = SAVE_KEY) {
  const saved = parseStored(storage, key);
  if (!saved.exists || !validateGameStateV2(saved.state)) return null;
  return saved.state;
}

export function readOrMigrateSavedGame(storage, currentKey = SAVE_KEY, legacyKey = LEGACY_SAVE_KEY, { persistLegacy = true } = {}) {
  const current = parseStored(storage, currentKey);
  if (validateGameStateV2(current.state)) return { state: current.state, source: 'v2', savedLocally: true, legacyRaw: null, currentRaw: current.raw };

  const legacy = parseStored(storage, legacyKey);
  if (!legacy.exists || !legacy.state || legacy.state.schemaVersion !== 1) {
    return {
      state: null,
      source: legacy.exists ? 'invalid' : null,
      savedLocally: false,
      legacyRaw: legacy.raw,
      currentRaw: current.raw,
    };
  }

  let state;
  try {
    state = migrateGameState(legacy.state);
  } catch {
    return { state: null, source: 'invalid', savedLocally: false, legacyRaw: legacy.raw };
  }
  const saved = current.exists
    ? { ok: false, error: 'invalid-current-state' }
    : persistLegacy ? saveGameState(state, storage, currentKey) : { ok: false, error: 'migration-not-persisted' };
  return { state, source: 'legacy', savedLocally: saved.ok, legacyRaw: legacy.raw, currentRaw: current.raw };
}

export function loadGameState(fallbackState, storage, key = SAVE_KEY) {
  const legacyKey = key === SAVE_KEY
    ? LEGACY_SAVE_KEY
    : key.replace(':save:v2', ':save:v1');
  const loaded = readOrMigrateSavedGame(storage, key, legacyKey);
  return loaded.state ?? cloneState(fallbackState);
}

export function saveGameState(state, storage, key = SAVE_KEY) {
  try {
    if (!validateGameStateV2(state)) return { ok: false, error: 'invalid-state' };
    getStorage(storage).setItem(key, JSON.stringify(toSaveData(state)));
    return { ok: true };
  } catch {
    return { ok: false, error: 'storage-unavailable' };
  }
}

export function removeSavedGame(storage, key = SAVE_KEY) {
  try {
    getStorage(storage).removeItem(key);
    return { ok: true };
  } catch {
    return { ok: false, error: 'storage-unavailable' };
  }
}
