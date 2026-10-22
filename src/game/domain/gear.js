import { BALANCE, GEAR_SLOT, RARITY, STAT_KEYS, getStageDropWeights } from '../data/balance.js';

const RARITIES = Object.values(RARITY);
const SLOTS = Object.values(GEAR_SLOT);
const RARITY_ORDER = [RARITY.COMMON, RARITY.UNCOMMON, RARITY.RARE, RARITY.UNIQUE, RARITY.LEGENDARY];
const MATERIAL_YIELD = Object.freeze([1, 2, 4, 8, 16]);
const EFFECT_IDS = Object.freeze(['bonusDamage', 'lifeSteal', 'damageReduction', 'thorns']);
let generatedId = 0;

function makeId(idFactory) {
  if (idFactory) return idFactory();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  generatedId += 1;
  return 'gear-' + Date.now().toString(36) + '-' + generatedId.toString(36);
}

function randomIndex(length, rng) {
  return Math.min(length - 1, Math.floor(rng() * length));
}

function roundStat(key, value) {
  if (key === 'maxHp' || key === 'attack' || key === 'defense') return Math.ceil(value);
  return Number(value.toFixed(6));
}

function rollStats(slot, rarity, rng) {
  const multiplier = BALANCE.gearRarityMultipliers[rarity];
  return Object.fromEntries(
    Object.entries(BALANCE.equipmentTemplates[slot]).map(([key, base]) => {
      const roll = BALANCE.gearRollRange.min + rng() * (BALANCE.gearRollRange.max - BALANCE.gearRollRange.min);
      return [key, roundStat(key, base * multiplier * roll)];
    }),
  );
}

function rollEffects(rarity, rng) {
  if (rarity !== RARITY.UNIQUE && rarity !== RARITY.LEGENDARY) return [];
  const roll = rng();
  const count = rarity === RARITY.UNIQUE
    ? (roll < 0.8 ? 1 : 2)
    : (roll < 0.5 ? 1 : roll < 0.9 ? 2 : 3);
  const pool = [...EFFECT_IDS];
  const effects = [];
  for (let i = 0; i < count; i += 1) {
    const id = pool.splice(randomIndex(pool.length, rng), 1)[0];
    effects.push({ id, value: BALANCE.effectValues[id][rarity] });
  }
  return effects;
}

function createGear(slot, rarity, idFactory, rng, level = 1) {
  return {
    id: makeId(idFactory),
    slot,
    rarity,
    level,
    stats: rollStats(slot, rarity, rng),
    effects: rollEffects(rarity, rng),
  };
}

export function rollRarity(stageIndex, rng = Math.random) {
  const weights = getStageDropWeights(stageIndex);
  const roll = rng() * weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = 0;
  for (let index = 0; index < weights.length; index += 1) {
    threshold += weights[index];
    if (roll < threshold) return RARITIES[index];
  }
  return RARITY.LEGENDARY;
}

export function rollGear({ stageIndex, rng = Math.random, idFactory }) {
  const stage = Math.min(10, Math.max(1, stageIndex));
  const slot = SLOTS[randomIndex(SLOTS.length, rng)];
  return createGear(slot, rollRarity(stage, rng), idFactory, rng);
}

export function createStarterEquipment(idFactory) {
  return Object.fromEntries(
    SLOTS.map((slot) => [slot, createGear(slot, RARITY.COMMON, idFactory, Math.random)]),
  );
}

export function getGearStatSummary(item) {
  return STAT_KEYS
    .filter((key) => Object.hasOwn(item.stats, key))
    .map((key) => ({ key, value: item.stats[key] }));
}

export function createInitialState(idFactory) {
  const state = {
    schemaVersion: 2,
    player: {
      level: 1, xp: 0, xpToNext: 100, pendingLevelUps: 0,
      availableStatPoints: 0, spentStatPoints: 0, statResetCount: 0,
      currentHp: BALANCE.basePlayer.maxHp,
      baseStats: { ...BALANCE.basePlayer },
    },
    equipment: createStarterEquipment(idFactory),
    inventory: [], materials: 0, gold: 0,
    progression: { chapter: 1, currentStage: 1, unlockedChapter: 1, unlockedStage: 1, clearedStageIds: [] },
  };
  state.player.currentHp = derivePlayerStats(state).maxHp;
  return state;
}

export function equipGear(state, itemId) {
  const inventoryIndex = state.inventory.findIndex((item) => item.id === itemId);
  if (inventoryIndex < 0) return { ok: false, reason: 'item-not-found' };
  const item = state.inventory[inventoryIndex];
  const oldItem = state.equipment[item.slot];
  if (oldItem && state.inventory.length >= BALANCE.inventoryCapacity) {
    return { ok: false, reason: 'inventory-full' };
  }
  const inventory = state.inventory.filter((candidate) => candidate.id !== itemId);
  if (oldItem) inventory.push(oldItem);
  return {
    ok: true,
    state: {
      ...state,
      inventory,
      equipment: { ...state.equipment, [item.slot]: item },
    },
  };
}

export function dismantleGear(state, itemId, rng = Math.random) {
  const item = state.inventory.find((candidate) => candidate.id === itemId);
  if (!item) return { ok: false, reason: 'item-not-found' };
  const baseYield = MATERIAL_YIELD[RARITY_ORDER.indexOf(item.rarity)];
  const criticalSuccess = rng() < 0.05;
  const materialsGained = baseYield * (criticalSuccess ? 2 : 1);
  return {
    ok: true,
    state: {
      ...state,
      inventory: state.inventory.filter((candidate) => candidate.id !== itemId),
      materials: state.materials + materialsGained,
    },
    materialsGained,
    criticalSuccess,
  };
}

export function getGearUpgradeCost(currentLevel) {
  let cost = 10;
  for (let targetLevel = 3; targetLevel <= currentLevel + 1; targetLevel += 1) {
    const multiplier = targetLevel % 10 === 0 ? 2 : targetLevel % 5 === 0 ? 1.5 : 1.2;
    cost = Math.ceil(cost * multiplier);
  }
  return cost;
}

function improveValue(key, value, rng, greatSuccess) {
  const specialRange = BALANCE.gearUpgrade.specialIncrease[key];
  const multiplier = greatSuccess ? 2 : 1;
  if (specialRange) {
    const increase = specialRange.min + rng() * (specialRange.max - specialRange.min);
    return Number((value + increase * multiplier).toFixed(6));
  }

  const { min, max } = BALANCE.gearUpgrade.ordinaryIncrease;
  const rate = min + rng() * (max - min);
  const normalValue = ['maxHp', 'attack', 'defense'].includes(key)
    ? Math.ceil(value * (1 + rate))
    : Number((value * (1 + rate)).toFixed(6));
  const gain = normalValue - value;
  return value + gain * multiplier;
}

function upgradeItem(item, rng, greatSuccess) {
  const stats = { ...item.stats };
  const effects = item.effects.map((effect) => ({ ...effect }));
  const statKeys = Object.keys(stats);
  const modes = item.rarity === RARITY.UNIQUE || item.rarity === RARITY.LEGENDARY
    ? ['stat-only', 'effect-only', 'both']
    : ['stat-only'];
  const mode = modes[randomIndex(modes.length, rng)];
  if ((mode === 'stat-only' || mode === 'both') && statKeys.length) {
    const key = statKeys[randomIndex(statKeys.length, rng)];
    stats[key] = improveValue(key, stats[key], rng, greatSuccess);
    if (key === 'critChance') stats[key] = Math.min(1, stats[key]);
  }
  if ((mode === 'effect-only' || mode === 'both') && effects.length) {
    const index = randomIndex(effects.length, rng);
    effects[index].value = improveValue(effects[index].id, effects[index].value, rng, greatSuccess);
  }
  return { ...item, level: item.level + 1, stats, effects };
}

export function upgradeGear(state, itemId, rng = Math.random) {
  let item = null;
  let location = null;
  let index = -1;
  for (const slot of SLOTS) {
    if (state.equipment[slot]?.id === itemId) {
      item = state.equipment[slot];
      location = slot;
      break;
    }
  }
  if (!item) {
    index = state.inventory.findIndex((candidate) => candidate.id === itemId);
    if (index >= 0) {
      item = state.inventory[index];
      location = 'inventory';
    }
  }
  if (!item) return { ok: false, reason: 'item-not-found' };
  if (item.level >= BALANCE.gearMaxLevel) return { ok: false, reason: 'max-level' };
  const cost = getGearUpgradeCost(item.level);
  if (state.materials < cost) return { ok: false, reason: 'insufficient-materials', cost };
  const greatSuccess = rng() < BALANCE.gearUpgrade.greatSuccessChance;
  const upgraded = upgradeItem(item, rng, greatSuccess);
  const nextState = location === 'inventory'
    ? { ...state, materials: state.materials - cost, inventory: state.inventory.map((candidate, i) => i === index ? upgraded : candidate) }
    : { ...state, materials: state.materials - cost, equipment: { ...state.equipment, [location]: upgraded } };
  return { ok: true, state: nextState, cost, item: upgraded, greatSuccess };
}

export function derivePlayerStats(state) {
  const stats = { ...state.player.baseStats };
  for (const item of Object.values(state.equipment)) {
    if (!item) continue;
    for (const [key, value] of Object.entries(item.stats)) {
      if (key === 'moveSpeedPercent') {
        if (item.slot === GEAR_SLOT.HORSE) stats.moveSpeed *= 1 + value;
      } else if (key in stats) {
        stats[key] += value;
      }
    }
  }
  stats.critChance = Math.min(BALANCE.critChanceCap, stats.critChance);
  for (const key of ['maxHp', 'attack', 'defense']) stats[key] = Math.ceil(stats[key]);
  return stats;
}

export function tryStoreDrop(state, item) {
  if (state.inventory.length >= BALANCE.inventoryCapacity) {
    return { ok: false, reason: 'inventory-full', groundItem: item };
  }
  return { ok: true, state: { ...state, inventory: [...state.inventory, item] } };
}

