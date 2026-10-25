import { BALANCE, GEAR_SLOT, RARITY, getStageDropWeights } from './balance.js';
import { createSeededRandom, deriveSeed } from './seededRandom.js';

const SLOTS = Object.values(GEAR_SLOT);
const RARITIES = Object.values(RARITY);
const EFFECT_IDS = Object.freeze(['bonusDamage', 'lifeSteal', 'damageReduction', 'thorns']);
const LEVEL_UP_KEYS = new Set(['attack', 'defense', 'maxHp']);
const INTEGER_GEAR_STATS = new Set(['maxHp', 'attack', 'defense']);

export class StageRewardError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = 'StageRewardError';
    this.code = code;
  }
}

function rewardError(code, message) {
  throw new StageRewardError(code, message);
}

export function xpRequiredForLevel(targetLevel) {
  if (!Number.isSafeInteger(targetLevel) || targetLevel < 2) {
    throw new RangeError('targetLevel must be a safe integer greater than or equal to 2.');
  }
  let cost = 100;
  for (let level = 3; level <= targetLevel; level += 1) {
    const multiplier = level % 10 === 0 ? 2 : level % 5 === 0 ? 1.5 : 1.2;
    cost = Math.ceil(cost * multiplier);
    if (!Number.isSafeInteger(cost)) {
      throw new StageRewardError('reward-overflow', 'XP required for this level exceeds the safe integer range.');
    }
  }
  return cost;
}

function randomIndex(length, random) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function rollRarity(stage, random) {
  const weights = getStageDropWeights(stage);
  const roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = 0;
  for (let index = 0; index < weights.length; index += 1) {
    threshold += weights[index];
    if (roll < threshold) return RARITIES[index];
  }
  return RARITY.LEGENDARY;
}

function rollGear(ticket, ordinal, random) {
  const slot = SLOTS[randomIndex(SLOTS.length, random)];
  const rarity = rollRarity(ticket.stage, random);
  const multiplier = BALANCE.gearRarityMultipliers[rarity];
  const stats = Object.fromEntries(Object.entries(BALANCE.equipmentTemplates[slot]).map(([key, base]) => {
    const roll = BALANCE.gearRollRange.min + random() * (BALANCE.gearRollRange.max - BALANCE.gearRollRange.min);
    const value = base * multiplier * roll;
    return [key, INTEGER_GEAR_STATS.has(key) ? Math.ceil(value) : Number(value.toFixed(6))];
  }));
  let effects = [];
  if (rarity === RARITY.UNIQUE || rarity === RARITY.LEGENDARY) {
    const roll = random();
    const count = rarity === RARITY.UNIQUE
      ? (roll < 0.8 ? 1 : 2)
      : (roll < 0.5 ? 1 : roll < 0.9 ? 2 : 3);
    const pool = [...EFFECT_IDS];
    effects = [];
    for (let index = 0; index < count; index += 1) {
      const id = pool.splice(randomIndex(pool.length, random), 1)[0];
      effects.push({ id, value: BALANCE.effectValues[id][rarity] });
    }
  }
  return {
    id: `${ticket.runId}:drop:${ordinal}`,
    slot,
    rarity,
    level: 1,
    stats,
    effects,
  };
}

function validateDropTicket(ticket) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket) ||
      typeof ticket.runId !== 'string' || !ticket.runId || ticket.runId.length > 128 ||
      !Number.isSafeInteger(ticket.seed) || ticket.seed < 1 || ticket.seed > 0xffffffff ||
      !Number.isSafeInteger(ticket.chapter) || ticket.chapter < 1 ||
      !Number.isSafeInteger(ticket.stage) || ticket.stage < 1 || ticket.stage > 10 ||
      ticket.balanceVersion !== 2 || ticket.simulatorVersion !== 3) {
    rewardError('invalid-stage', 'The stage ticket is outside the current reward rules.');
  }
}

function rollStageDrops(ticket, defeatedEnemies) {
  validateDropTicket(ticket);
  const random = createSeededRandom(deriveSeed(ticket.seed, 'stage-rewards'));
  const drops = [];
  for (const enemy of defeatedEnemies) {
    if (!enemy.dropEligible) continue;
    let count = 0;
    if (enemy.isBoss) count = BALANCE.bossDropCount;
    else if (random() < BALANCE.normalDropChance) count = 1;
    for (let index = 0; index < count; index += 1) {
      const ordinal = drops.length + 1;
      drops.push({
        ordinal,
        tick: enemy.tick,
        x: enemy.x,
        item: rollGear(ticket, ordinal, random),
      });
    }
  }
  return drops;
}

export function resolveStageDrops(ticket, defeatedEnemies, playerPath) {
  const drops = rollStageDrops(ticket, defeatedEnemies);
  const collectedDropOrdinals = [];
  for (const drop of drops) {
    if (playerPath.some((position) => position.tick > drop.tick && Math.abs(position.x - drop.x) <= 45)) {
      collectedDropOrdinals.push(drop.ordinal);
    }
  }
  return { drops, collectedDropOrdinals };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validGearItem(item) {
  if (!isPlainObject(item) || typeof item.id !== 'string' || item.id.length === 0 ||
      !SLOTS.includes(item.slot) || !RARITIES.includes(item.rarity) ||
      !Number.isSafeInteger(item.level) || item.level < 1 || item.level > BALANCE.gearMaxLevel ||
      !isPlainObject(item.stats) || !Array.isArray(item.effects)) return false;
  const template = BALANCE.equipmentTemplates[item.slot];
  const statKeys = Object.keys(item.stats).sort();
  const expectedStatKeys = Object.keys(template).sort();
  if (statKeys.length !== expectedStatKeys.length || statKeys.some((key, index) => key !== expectedStatKeys[index]) ||
      Object.values(item.stats).some((value) => !Number.isFinite(value) || value < 0)) return false;
  const effectLimit = item.rarity === RARITY.UNIQUE ? 2 : item.rarity === RARITY.LEGENDARY ? 3 : 0;
  if (item.effects.length > effectLimit ||
      ((item.rarity === RARITY.UNIQUE || item.rarity === RARITY.LEGENDARY) && item.effects.length < 1)) return false;
  const seenEffects = new Set();
  for (const effect of item.effects) {
    if (!isPlainObject(effect) || !EFFECT_IDS.includes(effect.id) || !Number.isFinite(effect.value) ||
        effect.value < 0 || seenEffects.has(effect.id)) return false;
    seenEffects.add(effect.id);
  }
  return true;
}

function validateProfile(profile) {
  if (!isPlainObject(profile) ||
      !Number.isSafeInteger(profile.level) || profile.level < 1 ||
      !Number.isSafeInteger(profile.xp) || profile.xp < 0 ||
      !Number.isSafeInteger(profile.xpToNext) || profile.xpToNext < 1 ||
      !Number.isSafeInteger(profile.pendingLevelUps) || profile.pendingLevelUps < 0 ||
      !Number.isSafeInteger(profile.gold) || profile.gold < 0 ||
      !Number.isSafeInteger(profile.materials) || profile.materials < 0 ||
      !Array.isArray(profile.inventory) || profile.inventory.length > BALANCE.inventoryCapacity ||
      !isPlainObject(profile.progression)) {
    rewardError('invalid-profile', 'The canonical reward profile is invalid.');
  }
  const progression = profile.progression;
  if (!Number.isSafeInteger(progression.chapter) || progression.chapter < 1 ||
      !Number.isSafeInteger(progression.currentStage) || progression.currentStage < 1 || progression.currentStage > 10 ||
      !Number.isSafeInteger(progression.unlockedChapter) || progression.unlockedChapter < 1 ||
      !Number.isSafeInteger(progression.unlockedStage) || progression.unlockedStage < 1 || progression.unlockedStage > 10 ||
      !Array.isArray(progression.clearedStageIds) ||
      progression.clearedStageIds.some((id) => typeof id !== 'string' || !/^[1-9]\d*-(?:[1-9]|10)$/.test(id)) ||
      new Set(progression.clearedStageIds).size !== progression.clearedStageIds.length) {
    rewardError('invalid-profile', 'The canonical stage progression is invalid.');
  }
  const itemIds = new Set();
  for (const item of profile.inventory) {
    if (!validGearItem(item) || itemIds.has(item.id)) {
      rewardError('invalid-profile', 'The canonical gear inventory is invalid.');
    }
    itemIds.add(item.id);
  }
}

function validateTicket(ticket, profile) {
  validateDropTicket(ticket);
  const multiplier = ticket.playerSnapshot?.replayXpMultiplier;
  if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
    rewardError('invalid-stage', 'The ticket is missing a valid replay XP multiplier.');
  }
  const snapshot = ticket.playerSnapshot;
  if (snapshot.level !== profile.level || snapshot.xp !== profile.xp ||
      snapshot.xpToNext !== profile.xpToNext || snapshot.pendingLevelUps !== profile.pendingLevelUps) {
    rewardError('invalid-profile', 'The reward profile does not match the ticket progression snapshot.');
  }
  return multiplier;
}

function validateReplay(replay) {
  if (!isPlainObject(replay) || replay.valid !== true || !['clear', 'death'].includes(replay.outcome) ||
      !Number.isSafeInteger(replay.elapsedTicks) || replay.elapsedTicks < 1 ||
      !Number.isFinite(replay.playerHp) || replay.playerHp < 0 ||
      !Array.isArray(replay.defeatedEnemies) || !Array.isArray(replay.levelUps) ||
      !Array.isArray(replay.collectedDropOrdinals)) {
    rewardError('invalid-replay', 'Only a complete, terminal stage replay can produce rewards.');
  }
  if ((replay.outcome === 'clear' && replay.playerHp <= 0) ||
      (replay.outcome === 'death' && replay.playerHp > 0)) {
    rewardError('invalid-replay', 'The terminal replay outcome does not match its final HP.');
  }
  const seenEnemies = new Set();
  let previousTick = -1;
  for (const enemy of replay.defeatedEnemies) {
    if (!isPlainObject(enemy) || typeof enemy.id !== 'string' || !enemy.id ||
        typeof enemy.isBoss !== 'boolean' || typeof enemy.dropEligible !== 'boolean' ||
        !Number.isSafeInteger(enemy.tick) || enemy.tick < previousTick || enemy.tick >= replay.elapsedTicks ||
        (enemy.isBoss ? enemy.id !== 'boss' : !/^enemy-[1-9]\d*$/.test(enemy.id)) ||
        !Number.isFinite(enemy.x) || seenEnemies.has(enemy.id)) {
      rewardError('invalid-replay', 'The replay contains an invalid defeated-enemy event.');
    }
    previousTick = enemy.tick;
    seenEnemies.add(enemy.id);
  }
  previousTick = -1;
  for (const levelUp of replay.levelUps) {
    if (!isPlainObject(levelUp) || !Number.isSafeInteger(levelUp.tick) ||
        levelUp.tick < previousTick || levelUp.tick >= replay.elapsedTicks ||
        !Number.isSafeInteger(levelUp.level) || levelUp.level < 2 ||
        !Array.isArray(levelUp.allocations) || levelUp.allocations.length > 2 ||
        levelUp.allocations.some((key) => !LEVEL_UP_KEYS.has(key))) {
      rewardError('invalid-replay', 'The replay contains an invalid level-up event.');
    }
    previousTick = levelUp.tick;
  }
  const collected = new Set();
  for (const ordinal of replay.collectedDropOrdinals) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || collected.has(ordinal)) {
      rewardError('invalid-replay', 'The replay contains an invalid collected-drop ordinal.');
    }
    collected.add(ordinal);
  }
  return collected;
}

function addGold(current, amount) {
  const total = current + amount;
  if (!Number.isSafeInteger(total) || total < 0) {
    rewardError('reward-overflow', 'The stage gold reward exceeds the safe integer range.');
  }
  return total;
}

export function grantProfileXp(state, amount, multiplier = 1) {
  if (!isPlainObject(state) ||
      !Number.isSafeInteger(state.level) || state.level < 1 ||
      !Number.isSafeInteger(state.xp) || state.xp < 0 ||
      !Number.isSafeInteger(state.xpToNext) || state.xpToNext < 1 ||
      !Number.isSafeInteger(state.pendingLevelUps) || state.pendingLevelUps < 0 ||
      !Number.isSafeInteger(state.xpGranted ?? 0) || (state.xpGranted ?? 0) < 0) {
    rewardError('invalid-profile', 'The canonical XP profile is invalid.');
  }
  if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
    rewardError('invalid-stage', 'The XP award or replay multiplier is invalid.');
  }
  const granted = Math.floor(amount * multiplier);
  let xp = state.xp + granted;
  const xpGranted = (state.xpGranted ?? 0) + granted;
  if (!Number.isSafeInteger(granted) || granted < 0 || !Number.isSafeInteger(xp) || !Number.isSafeInteger(xpGranted)) {
    rewardError('reward-overflow', 'The stage XP reward exceeds the safe integer range.');
  }
  let pendingLevelUps = state.pendingLevelUps;
  let virtualTargetLevel = state.level + pendingLevelUps + 1;
  if (!Number.isSafeInteger(virtualTargetLevel)) {
    rewardError('reward-overflow', 'The stage level target exceeds the safe integer range.');
  }
  let threshold = pendingLevelUps === 0 ? state.xpToNext : xpRequiredForLevel(virtualTargetLevel);
  while (xp >= threshold) {
    xp -= threshold;
    pendingLevelUps += 1;
    virtualTargetLevel += 1;
    if (!Number.isSafeInteger(pendingLevelUps) || !Number.isSafeInteger(virtualTargetLevel)) {
      rewardError('reward-overflow', 'The stage level reward exceeds the safe integer range.');
    }
    threshold = xpRequiredForLevel(virtualTargetLevel);
  }
  return { ...state, xp, pendingLevelUps, xpGranted };
}

export function resolveStageRewards({ ticket, replay, profile }) {
  validateProfile(profile);
  const replayXpMultiplier = validateTicket(ticket, profile);
  const collectedOrdinals = validateReplay(replay);
  const bossDefeated = replay.defeatedEnemies.some(({ isBoss }) => isBoss);
  if ((replay.outcome === 'clear' && (ticket.stage % 5 === 0) !== bossDefeated) ||
      (bossDefeated && ticket.stage % 5 !== 0)) {
    rewardError('invalid-replay', 'The replay terminal outcome does not match the stage boss rules.');
  }
  const generatedDrops = rollStageDrops(ticket, replay.defeatedEnemies);
  const generatedOrdinals = new Set(generatedDrops.map(({ ordinal }) => ordinal));
  if ([...collectedOrdinals].some((ordinal) => !generatedOrdinals.has(ordinal))) {
    rewardError('invalid-replay', 'The replay collected a drop that was not generated by its ticket.');
  }

  let rewardState = {
    level: profile.level,
    xp: profile.xp,
    xpToNext: profile.xpToNext,
    pendingLevelUps: profile.pendingLevelUps,
    xpGranted: 0,
  };
  let gold = profile.gold;
  for (const enemy of replay.defeatedEnemies) {
    gold = addGold(gold, enemy.isBoss ? BALANCE.goldRewards.boss : BALANCE.goldRewards.normalEnemy);
    if (!enemy.isBoss) rewardState = grantProfileXp(rewardState, BALANCE.xpRewards.normalEnemy, replayXpMultiplier);
  }
  if (replay.outcome === 'clear') {
    gold = addGold(gold, BALANCE.goldRewards.stageClear);
    rewardState = grantProfileXp(rewardState, BALANCE.xpRewards.stageClear, replayXpMultiplier);
    if (ticket.stage % 5 === 0) rewardState = grantProfileXp(rewardState, BALANCE.xpRewards.boss, replayXpMultiplier);
  }
  if (replay.levelUps.length > rewardState.pendingLevelUps) {
    rewardError('invalid-replay', 'The replay selected more levels than it earned.');
  }
  replay.levelUps.forEach((levelUp, index) => {
    if (levelUp.level !== profile.level + index + 1) {
      rewardError('invalid-replay', 'The replay level-up sequence does not match the profile level.');
    }
  });

  const level = profile.level + replay.levelUps.length;
  if (!Number.isSafeInteger(level)) {
    rewardError('reward-overflow', 'The stage level reward exceeds the safe integer range.');
  }
  const pendingLevelUps = rewardState.pendingLevelUps - replay.levelUps.length;
  if (!Number.isSafeInteger(level + 1)) {
    rewardError('reward-overflow', 'The next level exceeds the safe integer range.');
  }
  const xpToNext = replay.levelUps.length ? xpRequiredForLevel(level + 1) : profile.xpToNext;
  if (!Number.isSafeInteger(level) || !Number.isSafeInteger(pendingLevelUps) ||
      !Number.isSafeInteger(xpToNext) || !Number.isSafeInteger(gold)) {
    rewardError('reward-overflow', 'The stage reward profile exceeds the safe integer range.');
  }

  const availableSlots = BALANCE.inventoryCapacity - profile.inventory.length;
  const drops = generatedDrops
    .filter(({ ordinal }) => collectedOrdinals.has(ordinal))
    .slice(0, availableSlots)
    .map(({ item }) => structuredClone(item));
  const inventory = [...profile.inventory.map((item) => structuredClone(item)), ...drops];
  for (const item of drops) {
    if (profile.inventory.some((existing) => existing.id === item.id)) {
      rewardError('invalid-profile', 'A deterministic stage drop id already exists in the inventory.');
    }
  }

  let progression = {
    chapter: ticket.chapter,
    currentStage: ticket.stage,
    unlockedChapter: profile.progression.unlockedChapter,
    unlockedStage: profile.progression.unlockedStage,
    clearedStageIds: [...profile.progression.clearedStageIds],
  };
  if (replay.outcome === 'clear') {
    const clearedId = `${ticket.chapter}-${ticket.stage}`;
    if (!progression.clearedStageIds.includes(clearedId)) progression.clearedStageIds.push(clearedId);
    if (ticket.chapter === progression.unlockedChapter && ticket.stage === progression.unlockedStage) {
      if (ticket.stage === 10) {
        if (!Number.isSafeInteger(ticket.chapter + 1)) {
          rewardError('reward-overflow', 'The next chapter exceeds the safe integer range.');
        }
        progression.unlockedChapter = ticket.chapter + 1;
        progression.unlockedStage = 1;
      } else {
        progression.unlockedChapter = ticket.chapter;
        progression.unlockedStage = ticket.stage + 1;
      }
    }
  }

  const xpGranted = rewardState.xpGranted;
  return {
    outcome: replay.outcome,
    xpGranted,
    goldGranted: gold - profile.gold,
    drops,
    profilePatch: {
      level,
      xp: rewardState.xp,
      xpToNext,
      pendingLevelUps,
      gold,
      inventory,
      progression,
    },
  };
}
