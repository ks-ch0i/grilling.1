import { BALANCE, GEAR_SLOT, RARITY } from '@knight-run/game-rules/balance';

export const MAX_CLOUD_SAVE_BYTES = 256 * 1024;

const REQUIRED_STATS = Object.freeze([
  'maxHp', 'attack', 'defense', 'critChance', 'critMultiplier', 'moveSpeed',
]);
const EQUIPMENT_SLOTS = Object.freeze(Object.values(GEAR_SLOT));
const RARITIES = new Set(Object.values(RARITY));

export class CloudSaveValidationError extends Error {
  constructor(message = 'The cloud save is invalid.') {
    super(message);
    this.name = 'CloudSaveValidationError';
    this.code = 'invalid-save';
  }
}

function invalid(message) {
  throw new CloudSaveValidationError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyFiniteNumbers(value) {
  const seen = new WeakSet();
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) return false;
    seen.add(current);
    for (const child of Object.values(current)) pending.push(child);
  }
  return true;
}

function copyGearItem(item, expectedSlot) {
  if (item === null) return null;
  if (!isPlainObject(item) || typeof item.id !== 'string' || item.slot !== expectedSlot ||
      !RARITIES.has(item.rarity) || !Number.isInteger(item.level) || item.level < 1 ||
      item.level > BALANCE.gearMaxLevel || !isPlainObject(item.stats) || !Array.isArray(item.effects)) {
    invalid('A gear item does not match the save schema.');
  }
  if (!Object.values(item.stats).every(Number.isFinite) ||
      !item.effects.every((effect) => isPlainObject(effect) && typeof effect.id === 'string' && Number.isFinite(effect.value))) {
    invalid('A gear item contains an invalid number or effect.');
  }

  return {
    id: item.id,
    slot: item.slot,
    rarity: item.rarity,
    level: item.level,
    stats: { ...item.stats },
    effects: item.effects.map(({ id, value }) => ({ id, value })),
  };
}

function canonicalizeState(state) {
  if (!isPlainObject(state) || state.schemaVersion !== 1 || !isPlainObject(state.player) ||
      !isPlainObject(state.player.baseStats) || !isPlainObject(state.equipment) ||
      !Array.isArray(state.inventory) || !isPlainObject(state.progression)) {
    invalid('The save state does not match schemaVersion 1.');
  }

  const { player, progression } = state;
  if (!Number.isInteger(player.level) || player.level < 1 || !Number.isFinite(player.xp) || player.xp < 0 ||
      !Number.isFinite(player.xpToNext) || player.xpToNext <= 0 ||
      !Number.isInteger(player.pendingLevelUps) || player.pendingLevelUps < 0 ||
      !Number.isFinite(player.currentHp) || player.currentHp < 0 ||
      !REQUIRED_STATS.every((key) => Number.isFinite(player.baseStats[key]))) {
    invalid('The player fields do not match the save schema.');
  }
  if (state.inventory.length > BALANCE.inventoryCapacity) invalid('The inventory exceeds its capacity.');
  if (!Number.isFinite(state.materials) || state.materials < 0) invalid('Materials must be a non-negative finite number.');
  if (!Number.isInteger(progression.chapter) || progression.chapter < 1 ||
      !Number.isInteger(progression.currentStage) || progression.currentStage < 1 || progression.currentStage > 10 ||
      !Number.isInteger(progression.unlockedChapter) || progression.unlockedChapter < 1 ||
      !Number.isInteger(progression.unlockedStage) || progression.unlockedStage < 1 || progression.unlockedStage > 10 ||
      !Array.isArray(progression.clearedStageIds) ||
      !progression.clearedStageIds.every((id) => typeof id === 'string' && /^\d+-\d+$/.test(id))) {
    invalid('The progression fields do not match the save schema.');
  }

  const equipment = {};
  for (const slot of EQUIPMENT_SLOTS) {
    if (!Object.hasOwn(state.equipment, slot)) invalid('Equipment is missing a required slot.');
    equipment[slot] = copyGearItem(state.equipment[slot], slot);
  }
  const inventory = state.inventory.map((item) => {
    if (!isPlainObject(item) || !EQUIPMENT_SLOTS.includes(item.slot)) invalid('An inventory item has an invalid slot.');
    return copyGearItem(item, item.slot);
  });

  return {
    schemaVersion: 1,
    player: {
      level: player.level,
      xp: player.xp,
      xpToNext: player.xpToNext,
      pendingLevelUps: player.pendingLevelUps,
      currentHp: player.currentHp,
      baseStats: Object.fromEntries(REQUIRED_STATS.map((key) => [key, player.baseStats[key]])),
    },
    equipment,
    inventory,
    materials: state.materials,
    progression: {
      chapter: progression.chapter,
      currentStage: progression.currentStage,
      unlockedChapter: progression.unlockedChapter,
      unlockedStage: progression.unlockedStage,
      clearedStageIds: [...progression.clearedStageIds],
    },
  };
}

export function validateCloudSave(body) {
  if (!isPlainObject(body) || body.schemaVersion !== 1 || !hasOnlyFiniteNumbers(body)) {
    invalid('The cloud save body is invalid.');
  }
  return { schemaVersion: 1, state: canonicalizeState(body.state) };
}

export function parseCloudSave(row) {
  if (!row || row.SchemaVersion !== 1) throw new TypeError('Cloud save row has an unsupported schema version.');
  const revision = typeof row.Revision === 'bigint' ? Number(row.Revision) : Number(row.Revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Cloud save row has an invalid revision.');
  const updatedAt = row.UpdatedAtUtc instanceof Date ? row.UpdatedAtUtc : new Date(row.UpdatedAtUtc);
  if (!Number.isFinite(updatedAt.getTime())) throw new TypeError('Cloud save row has an invalid timestamp.');
  const rawState = typeof row.SaveJson === 'string' ? JSON.parse(row.SaveJson) : row.SaveJson;
  if (!hasOnlyFiniteNumbers(rawState)) throw new TypeError('Cloud save row contains a non-finite number.');
  const state = canonicalizeState(rawState);
  return {
    schemaVersion: 1,
    revision,
    updatedAtUtc: updatedAt.toISOString(),
    state,
  };
}
