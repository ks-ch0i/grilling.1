import { GEAR_SLOT, BALANCE, RARITY } from '../data/balance.js';

export const SAVE_KEY = 'lancer-belt-scroll-game:save:v1';
const REQUIRED_EQUIPMENT_SLOTS = Object.values(GEAR_SLOT);
const RARITIES = new Set(Object.values(RARITY));

function cloneState(state) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(state);
  return JSON.parse(JSON.stringify(state));
}
function isPlainObject(value) {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function isGearItem(item, slot) {
  return item === null || (
    isPlainObject(item) &&
    typeof item.id === 'string' &&
    item.slot === slot &&
    RARITIES.has(item.rarity) &&
    Number.isInteger(item.level) &&
    item.level >= 1 &&
    item.level <= BALANCE.gearMaxLevel &&
    isPlainObject(item.stats) &&
    Object.values(item.stats).every(Number.isFinite) &&
    Array.isArray(item.effects) &&
    item.effects.every((effect) => isPlainObject(effect) && typeof effect.id === 'string' && Number.isFinite(effect.value))
  );
}
function isValidState(state) {
  return isPlainObject(state) &&
    state.schemaVersion === 1 &&
    isPlainObject(state.player) &&
    Number.isInteger(state.player.level) && state.player.level >= 1 &&
    Number.isFinite(state.player.xp) && state.player.xp >= 0 &&
    Number.isFinite(state.player.xpToNext) && state.player.xpToNext > 0 &&
    Number.isInteger(state.player.pendingLevelUps) && state.player.pendingLevelUps >= 0 &&
    Number.isFinite(state.player.currentHp) && state.player.currentHp >= 0 &&
    isPlainObject(state.player.baseStats) &&
    ['maxHp','attack','defense','critChance','critMultiplier','moveSpeed'].every((key) => Number.isFinite(state.player.baseStats[key])) &&
    Array.isArray(state.inventory) &&
    state.inventory.length <= BALANCE.inventoryCapacity &&
    state.inventory.every((item) => item !== null && REQUIRED_EQUIPMENT_SLOTS.includes(item.slot) && isGearItem(item, item.slot)) &&
    Number.isFinite(state.materials) && state.materials >= 0 &&
    isPlainObject(state.equipment) &&
    REQUIRED_EQUIPMENT_SLOTS.every((slot) =>
      Object.prototype.hasOwnProperty.call(state.equipment, slot) && isGearItem(state.equipment[slot], slot),
    ) &&
    isPlainObject(state.progression) &&
    Number.isInteger(state.progression.chapter) && state.progression.chapter >= 1 &&
    Number.isInteger(state.progression.currentStage) && state.progression.currentStage >= 1 && state.progression.currentStage <= 10 &&
    Number.isInteger(state.progression.unlockedChapter) && state.progression.unlockedChapter >= 1 &&
    Number.isInteger(state.progression.unlockedStage) && state.progression.unlockedStage >= 1 && state.progression.unlockedStage <= 10 &&
    Array.isArray(state.progression.clearedStageIds) &&
    state.progression.clearedStageIds.every((id) => typeof id === 'string' && /^\d+-\d+$/.test(id));
}
function toSaveData(state) {
  const copyGear = (item) => item === null ? null : ({
    id: item.id, slot: item.slot, rarity: item.rarity, level: item.level,
    stats: { ...item.stats }, effects: item.effects.map(({ id, value }) => ({ id, value })),
  });
  return {
    schemaVersion: 1,
    player: {
      level: state.player.level,
      xp: state.player.xp,
      xpToNext: state.player.xpToNext,
      pendingLevelUps: state.player.pendingLevelUps,
      currentHp: state.player.currentHp,
      baseStats: Object.fromEntries(['maxHp','attack','defense','critChance','critMultiplier','moveSpeed'].map((key) => [key, state.player.baseStats[key]])),
    },
    equipment: Object.fromEntries(REQUIRED_EQUIPMENT_SLOTS.map((slot) => [slot, copyGear(state.equipment[slot])])),
    inventory: state.inventory.map(copyGear),
    materials: state.materials,
    progression: {
      chapter: state.progression.chapter,
      currentStage: state.progression.currentStage,
      unlockedChapter: state.progression.unlockedChapter,
      unlockedStage: state.progression.unlockedStage,
      clearedStageIds: [...state.progression.clearedStageIds],
    },
  };
}
function getStorage(storage) {
  return storage ?? globalThis.localStorage;
}

export function loadGameState(fallbackState, storage) {
  try {
    const serialized = getStorage(storage).getItem(SAVE_KEY);
    if (serialized === null) return cloneState(fallbackState);
    const state = JSON.parse(serialized);
    return isValidState(state) ? state : cloneState(fallbackState);
  } catch {
    return cloneState(fallbackState);
  }
}
export function saveGameState(state, storage) {
  try {
    if (!isValidState(state)) return { ok:false, error:'invalid-state' };
    getStorage(storage).setItem(SAVE_KEY, JSON.stringify(toSaveData(state)));
    return { ok:true };
  } catch {
    return { ok:false, error:'storage-unavailable' };
  }
}
export function removeSavedGame(storage) {
  try {
    getStorage(storage).removeItem(SAVE_KEY);
    return { ok:true };
  } catch {
    return { ok:false, error:'storage-unavailable' };
  }
}
