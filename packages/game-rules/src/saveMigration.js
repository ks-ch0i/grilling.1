import {
  BALANCE,
  GEAR_SLOT,
  RARITY,
  STAT_KEYS,
  getGearUpgradeBand,
} from './balance.js';

const GEAR_SLOTS = Object.values(GEAR_SLOT);
const RARITIES = new Set(Object.values(RARITY));
const STAT_KEY_SET = new Set(STAT_KEYS);
const EFFECT_IDS = new Set(Object.keys(BALANCE.effectValues));
const PLAYER_STAT_KEYS = ['maxHp', 'attack', 'defense', 'critChance', 'critMultiplier', 'moveSpeed'];
const ORDINARY_GEAR_STATS = new Set(['maxHp', 'attack', 'defense']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isSafeNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validPlayer(state, version) {
  const player = state.player;
  if (!isPlainObject(player) ||
      !Number.isSafeInteger(player.level) || player.level < 1 ||
      !Number.isFinite(player.xp) || player.xp < 0 ||
      !Number.isFinite(player.xpToNext) || player.xpToNext <= 0 ||
      !isSafeNonnegativeInteger(player.pendingLevelUps) ||
      !Number.isFinite(player.currentHp) || player.currentHp < 0 ||
      !isPlainObject(player.baseStats) || !hasExactKeys(player.baseStats, PLAYER_STAT_KEYS) ||
      !PLAYER_STAT_KEYS.every((key) => Number.isFinite(player.baseStats[key]))) return false;

  if (player.baseStats.maxHp <= 0 || player.baseStats.attack < 0 || player.baseStats.defense < 0 ||
      player.baseStats.critChance < 0 || player.baseStats.critChance > BALANCE.critChanceCap ||
      player.baseStats.critMultiplier <= 0 || player.baseStats.moveSpeed <= 0) return false;

  return version === 1 || (
    isSafeNonnegativeInteger(player.availableStatPoints) &&
    isSafeNonnegativeInteger(player.spentStatPoints) &&
    isSafeNonnegativeInteger(player.statResetCount)
  );
}

function validGearItem(item, expectedSlot, version) {
  if (item === null) return expectedSlot !== undefined;
  if (!isPlainObject(item) || typeof item.id !== 'string' || item.id.length === 0 ||
      !GEAR_SLOTS.includes(item.slot) || (expectedSlot !== undefined && item.slot !== expectedSlot) ||
      !RARITIES.has(item.rarity) || !Number.isSafeInteger(item.level) ||
      item.level < 1 || item.level > BALANCE.gearMaxLevel || !isPlainObject(item.stats) ||
      !Array.isArray(item.effects)) return false;

  const template = BALANCE.equipmentTemplates[item.slot];
  if (!hasExactKeys(item.stats, Object.keys(template))) return false;
  if (!Object.keys(item.stats).every((key) => STAT_KEY_SET.has(key) && Number.isFinite(item.stats[key]))) return false;
  if (version === 2 && !Object.values(item.stats).every((value) => value >= 0)) return false;

  const effectLimit = item.rarity === RARITY.UNIQUE ? 2 : item.rarity === RARITY.LEGENDARY ? 3 : 0;
  if (item.effects.length > effectLimit ||
      ((item.rarity === RARITY.UNIQUE || item.rarity === RARITY.LEGENDARY) && item.effects.length < 1)) return false;
  const seenEffects = new Set();
  for (const effect of item.effects) {
    if (!isPlainObject(effect) || typeof effect.id !== 'string' || !EFFECT_IDS.has(effect.id) ||
        !Number.isFinite(effect.value) || effect.value < 0 || seenEffects.has(effect.id)) return false;
    seenEffects.add(effect.id);
  }
  return true;
}

function validProgression(progression) {
  return isPlainObject(progression) &&
    Number.isSafeInteger(progression.chapter) && progression.chapter >= 1 &&
    Number.isSafeInteger(progression.currentStage) && progression.currentStage >= 1 && progression.currentStage <= 10 &&
    Number.isSafeInteger(progression.unlockedChapter) && progression.unlockedChapter >= 1 &&
    Number.isSafeInteger(progression.unlockedStage) && progression.unlockedStage >= 1 && progression.unlockedStage <= 10 &&
    Array.isArray(progression.clearedStageIds) &&
    progression.clearedStageIds.every((id) => typeof id === 'string' && /^\d+-\d+$/.test(id));
}

function validInventory(inventory, version) {
  return Array.isArray(inventory) && inventory.length <= BALANCE.inventoryCapacity &&
    inventory.every((item) => item !== null && validGearItem(item, undefined, version));
}

function hasUniqueGearIds(state) {
  const ids = new Set();
  const items = [...Object.values(state.equipment), ...state.inventory];
  for (const item of items) {
    if (item === null) continue;
    if (ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

function validGameStateV1(state) {
  return isPlainObject(state) && state.schemaVersion === 1 && validPlayer(state, 1) &&
    isPlainObject(state.equipment) && hasExactKeys(state.equipment, GEAR_SLOTS) &&
    GEAR_SLOTS.every((slot) => validGearItem(state.equipment[slot], slot, 1)) &&
    validInventory(state.inventory, 1) && Number.isFinite(state.materials) && state.materials >= 0 &&
    validProgression(state.progression) && hasUniqueGearIds(state);
}

export function validateGameStateV2(state) {
  return isPlainObject(state) && state.schemaVersion === 2 && validPlayer(state, 2) &&
    isSafeNonnegativeInteger(state.gold) && isPlainObject(state.equipment) &&
    hasExactKeys(state.equipment, GEAR_SLOTS) &&
    GEAR_SLOTS.every((slot) => validGearItem(state.equipment[slot], slot, 2)) &&
    validInventory(state.inventory, 2) && Number.isFinite(state.materials) && state.materials >= 0 &&
    validProgression(state.progression) && hasUniqueGearIds(state);
}

function deepClone(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function roundFraction(value) {
  return Number(value.toFixed(6));
}

function initialGearStat(item, key) {
  const base = BALANCE.equipmentTemplates[item.slot][key] * BALANCE.gearRarityMultipliers[item.rarity];
  return ORDINARY_GEAR_STATS.has(key) ? Math.ceil(base) : roundFraction(base);
}

function migrateGearStat(item, key) {
  let value = initialGearStat(item, key);
  const specialRange = BALANCE.gearUpgrade.specialIncrease[key];
  for (let level = 1; level < item.level; level += 1) {
    if (ORDINARY_GEAR_STATS.has(key)) {
      const band = getGearUpgradeBand(level);
      const meanRate = (band.min + band.max) / 2;
      value = Math.ceil(value * (1 + meanRate));
    } else if (specialRange) {
      value = roundFraction(value + (specialRange.min + specialRange.max) / 2);
    } else {
      throw new TypeError(`Unsupported legacy gear stat: ${key}`);
    }
    if (key === 'critChance') value = Math.min(BALANCE.critChanceCap, value);
  }
  return value;
}

function migrateGear(item) {
  return {
    id: item.id,
    slot: item.slot,
    rarity: item.rarity,
    level: item.level,
    stats: Object.fromEntries(Object.keys(item.stats).map((key) => [key, migrateGearStat(item, key)])),
    effects: item.effects.map(({ id }) => {
      const range = BALANCE.gearUpgrade.specialIncrease[id];
      let value = BALANCE.effectValues[id][item.rarity];
      if (!Number.isFinite(value)) throw new TypeError(`Unsupported legacy gear effect: ${id}`);
      for (let level = 1; level < item.level; level += 1) {
        value = roundFraction(value + (range.min + range.max) / 2);
        if (id === 'damageReduction') value = Math.min(1, value);
      }
      return { id, value };
    }),
  };
}

function effectiveMaxHp(baseStats, equipment) {
  const bonus = Object.values(equipment).reduce((sum, item) => sum + (item?.stats.maxHp ?? 0), 0);
  return Math.ceil(baseStats.maxHp + bonus);
}

export function migrateGameState(state) {
  if (state?.schemaVersion === 2) {
    if (!validateGameStateV2(state)) throw new TypeError('Invalid schemaVersion 2 game state.');
    return deepClone(state);
  }
  if (!validGameStateV1(state)) throw new TypeError('Invalid schemaVersion 1 game state.');

  const oldMaxHp = effectiveMaxHp(state.player.baseStats, state.equipment);
  if (!Number.isFinite(oldMaxHp) || oldMaxHp <= 0) throw new TypeError('Invalid legacy effective max HP.');
  const oldHpRatio = Math.max(0, Math.min(1, state.player.currentHp / oldMaxHp));
  const availableStatPoints = 2 * (state.player.level - 1);
  if (!isSafeNonnegativeInteger(availableStatPoints)) throw new TypeError('Legacy level produces an invalid stat point balance.');
  const equipment = Object.fromEntries(GEAR_SLOTS.map((slot) => [
    slot,
    state.equipment[slot] === null ? null : migrateGear(state.equipment[slot]),
  ]));
  const inventory = state.inventory.map(migrateGear);
  const baseStats = { ...BALANCE.basePlayer };
  const newMaxHp = effectiveMaxHp(baseStats, equipment);

  return {
    schemaVersion: 2,
    player: {
      level: state.player.level,
      xp: state.player.xp,
      xpToNext: state.player.xpToNext,
      pendingLevelUps: state.player.pendingLevelUps,
      currentHp: oldHpRatio === 0 ? 0 : Math.ceil(oldHpRatio * newMaxHp),
      baseStats,
      availableStatPoints,
      spentStatPoints: 0,
      statResetCount: 0,
    },
    equipment,
    inventory,
    materials: state.materials,
    gold: 0,
    progression: {
      chapter: state.progression.chapter,
      currentStage: state.progression.currentStage,
      unlockedChapter: state.progression.unlockedChapter,
      unlockedStage: state.progression.unlockedStage,
      clearedStageIds: [...state.progression.clearedStageIds],
    },
  };
}
