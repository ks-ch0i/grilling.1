import { BALANCE, GEAR_SLOT, RARITY } from '@knight-run/game-rules/balance';
import { migrateGameState } from '@knight-run/game-rules/save';
import { mergeRewardProfile } from './playerProfile.js';

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
    throw new TypeError('A gear item does not match the save schema.');
  }
  if (!Object.values(item.stats).every(Number.isFinite) ||
      !item.effects.every((effect) => isPlainObject(effect) && typeof effect.id === 'string' && Number.isFinite(effect.value))) {
    throw new TypeError('A gear item contains an invalid number or effect.');
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

function canonicalizeV2State(state) {
  const migrated = migrateGameState(state);
  const { player, progression } = migrated;
  const equipment = {};
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = copyGearItem(migrated.equipment[slot], slot);
  const inventory = migrated.inventory.map((item) => copyGearItem(item, item.slot));

  return {
    schemaVersion: 2,
    player: {
      level: player.level,
      xp: player.xp,
      xpToNext: player.xpToNext,
      pendingLevelUps: player.pendingLevelUps,
      currentHp: player.currentHp,
      baseStats: Object.fromEntries(REQUIRED_STATS.map((key) => [key, player.baseStats[key]])),
      availableStatPoints: player.availableStatPoints,
      spentStatPoints: player.spentStatPoints,
      statResetCount: player.statResetCount,
    },
    equipment,
    inventory,
    materials: migrated.materials,
    gold: migrated.gold,
    progression: {
      chapter: progression.chapter,
      currentStage: progression.currentStage,
      unlockedChapter: progression.unlockedChapter,
      unlockedStage: progression.unlockedStage,
      clearedStageIds: [...progression.clearedStageIds],
    },
  };
}

function canonicalizeWritableState(state) {
  if (!isPlainObject(state) || state.schemaVersion !== 2) {
    invalid('The save state does not match schemaVersion 2.');
  }
  try {
    return canonicalizeV2State(state);
  } catch (error) {
    invalid(error.message || 'The save state does not match schemaVersion 2.');
  }
}

export function validateCloudSave(body) {
  if (!isPlainObject(body) || body.schemaVersion !== 2 || !hasOnlyFiniteNumbers(body)) {
    invalid('The cloud save body must use schemaVersion 2 and contain finite JSON numbers.');
  }
  return { schemaVersion: 2, state: canonicalizeWritableState(body.state) };
}

export function parseArchivedSaveState(value) {
  const rawState = typeof value === 'string' ? JSON.parse(value) : value;
  if (!hasOnlyFiniteNumbers(rawState) || ![1, 2].includes(rawState?.schemaVersion)) {
    throw new TypeError('Archived cloud save has an unsupported or non-finite state.');
  }
  try {
    return canonicalizeV2State(rawState);
  } catch (error) {
    throw new TypeError('Archived cloud save contains an invalid state.', { cause: error });
  }
}

export function parseCloudSave(row, rewardProfile) {
  if (!row || ![1, 2].includes(row.SchemaVersion)) {
    throw new TypeError('Cloud save row has an unsupported schema version.');
  }
  const revision = typeof row.Revision === 'bigint' ? Number(row.Revision) : Number(row.Revision);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Cloud save row has an invalid revision.');
  const updatedAt = row.UpdatedAtUtc instanceof Date ? row.UpdatedAtUtc : new Date(row.UpdatedAtUtc);
  if (!Number.isFinite(updatedAt.getTime())) throw new TypeError('Cloud save row has an invalid timestamp.');
  const rawState = typeof row.SaveJson === 'string' ? JSON.parse(row.SaveJson) : row.SaveJson;
  if (!hasOnlyFiniteNumbers(rawState)) throw new TypeError('Cloud save row contains a non-finite number.');
  if (rawState?.schemaVersion !== row.SchemaVersion) {
    throw new TypeError('Cloud save row and JSON state have mismatched schema versions.');
  }

  let state;
  try {
    state = canonicalizeV2State(rawState);
  } catch (error) {
    throw new TypeError('Cloud save row contains an invalid state.', { cause: error });
  }
  const canonical = {
    schemaVersion: 2,
    revision,
    updatedAtUtc: updatedAt.toISOString(),
    state,
  };
  return {
    ...canonical,
    state: mergeRewardProfile(canonical.state, rewardProfile),
  };
}
