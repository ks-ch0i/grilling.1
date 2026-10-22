import { BALANCE, getStageDropWeights } from '../data/balance.js';
import { getStageEnemyStats } from '@knight-run/game-rules/balance';
import { derivePlayerStats } from './gear.js';

export { getStageEnemyStats };

const ALLOCATABLE_STATS = new Set(['attack', 'defense', 'maxHp']);

function hasValidStatPoints(player) {
  return Number.isSafeInteger(player.availableStatPoints) && player.availableStatPoints >= 0 &&
    Number.isSafeInteger(player.spentStatPoints) && player.spentStatPoints >= 0;
}

function validAllocations(allocations) {
  if (!Array.isArray(allocations) || allocations.length > 2) return false;
  for (let index = 0; index < allocations.length; index += 1) {
    if (!ALLOCATABLE_STATS.has(allocations[index])) return false;
  }
  return true;
}

function withAllocatedStats(state, allocations) {
  const baseStats = { ...state.player.baseStats };
  let currentHp = state.player.currentHp;
  for (const statKey of allocations) {
    const gain = BALANCE.levelUp[statKey];
    baseStats[statKey] += gain;
    if (statKey === 'maxHp') currentHp += gain;
  }
  const next = { ...state, player: { ...state.player, baseStats, currentHp } };
  next.player.currentHp = Math.min(next.player.currentHp, derivePlayerStats(next).maxHp);
  return next;
}

export function xpRequiredForLevel(targetLevel) {
  if (!Number.isInteger(targetLevel) || targetLevel < 2) {
    throw new RangeError('targetLevel must be an integer greater than or equal to 2.');
  }
  let cost = 100;
  for (let level = 3; level <= targetLevel; level += 1) {
    const multiplier = level % 10 === 0 ? 2 : level % 5 === 0 ? 1.5 : 1.2;
    cost = Math.ceil(cost * multiplier);
  }
  return cost;
}

export function grantXp(state, amount, isReplay = false) {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: 'invalid-xp' };
  const granted = isReplay ? Math.floor(amount * BALANCE.replayXpMultiplier) : amount;
  let xp = state.player.xp + granted;
  let pendingLevelUps = state.player.pendingLevelUps;
  let virtualTargetLevel = state.player.level + pendingLevelUps + 1;
  let threshold = pendingLevelUps === 0
    ? state.player.xpToNext
    : xpRequiredForLevel(virtualTargetLevel);
  while (xp >= threshold) {
    xp -= threshold;
    pendingLevelUps += 1;
    virtualTargetLevel += 1;
    threshold = xpRequiredForLevel(virtualTargetLevel);
  }
  return {
    ok: true,
    state: { ...state, player: { ...state.player, xp, pendingLevelUps } },
    granted,
  };
}

export function resolveLevelUp(state, allocations) {
  if (!validAllocations(allocations)) return { ok: false, reason: 'invalid-allocation' };
  if (state.player.pendingLevelUps < 1) return { ok: false, reason: 'no-pending-level-up' };
  if (!hasValidStatPoints(state.player)) return { ok: false, reason: 'invalid-stat-points' };
  const availableStatPoints = state.player.availableStatPoints + 2 - allocations.length;
  const spentStatPoints = state.player.spentStatPoints + allocations.length;
  if (!Number.isSafeInteger(availableStatPoints) || !Number.isSafeInteger(spentStatPoints)) {
    return { ok: false, reason: 'invalid-stat-points' };
  }
  const level = state.player.level + 1;
  const allocated = withAllocatedStats(state, allocations);
  return {
    ok: true,
    state: {
      ...state,
      player: {
        ...allocated.player,
        level,
        xpToNext: xpRequiredForLevel(level + 1),
        pendingLevelUps: state.player.pendingLevelUps - 1,
        availableStatPoints,
        spentStatPoints,
      },
    },
  };
}

export function allocateStatPoint(state, statKey) {
  if (!ALLOCATABLE_STATS.has(statKey)) return { ok: false, reason: 'invalid-stat' };
  if (!hasValidStatPoints(state.player)) return { ok: false, reason: 'invalid-stat-points' };
  if (state.player.availableStatPoints < 1) return { ok: false, reason: 'insufficient-stat-points' };
  const next = withAllocatedStats(state, [statKey]);
  next.player.availableStatPoints -= 1;
  next.player.spentStatPoints += 1;
  if (!hasValidStatPoints(next.player)) return { ok: false, reason: 'invalid-stat-points' };
  return { ok: true, state: next };
}

export function getStatResetCost(resetCount) {
  if (!Number.isSafeInteger(resetCount) || resetCount < 0) {
    throw new RangeError('resetCount must be a non-negative safe integer.');
  }
  const cost = Math.ceil(1000 * (1.5 ** resetCount));
  if (!Number.isSafeInteger(cost)) throw new RangeError('stat reset cost exceeds the safe integer range.');
  return cost;
}

export function resetStatPoints(state) {
  const { player, gold } = state;
  if (!hasValidStatPoints(player) || !Number.isSafeInteger(player.statResetCount) || player.statResetCount < 0) {
    return { ok: false, reason: 'invalid-stat-points' };
  }
  if (!Number.isSafeInteger(gold) || gold < 0) return { ok: false, reason: 'invalid-gold' };
  if (player.spentStatPoints < 1) return { ok: false, reason: 'no-stat-points-spent' };
  const cost = getStatResetCost(player.statResetCount);
  if (gold < cost) return { ok: false, reason: 'insufficient-gold', cost };
  const availableStatPoints = player.availableStatPoints + player.spentStatPoints;
  const statResetCount = player.statResetCount + 1;
  if (!Number.isSafeInteger(availableStatPoints) || !Number.isSafeInteger(statResetCount)) {
    return { ok: false, reason: 'invalid-stat-points' };
  }
  const next = {
    ...state,
    gold: gold - cost,
    player: {
      ...player,
      baseStats: { ...BALANCE.basePlayer },
      currentHp: player.currentHp,
      availableStatPoints,
      spentStatPoints: 0,
      statResetCount,
    },
  };
  next.player.currentHp = Math.min(next.player.currentHp, derivePlayerStats(next).maxHp);
  return { ok: true, state: next, cost };
}

export function stageId(chapter, stage) {
  if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(stage) || stage < 1 || stage > 10) {
    throw new RangeError('chapter must be positive and stage must be an integer from 1 to 10.');
  }
  return chapter + '-' + stage;
}

export function getDropWeights(stageIndex) {
  if (!Number.isInteger(stageIndex) || stageIndex < 1 || stageIndex > 10) {
    throw new RangeError('stageIndex must be an integer from 1 to 10.');
  }
  return getStageDropWeights(stageIndex);
}

export function completeStage(state, chapter, stage) {
  const id = stageId(chapter, stage);
  const replay = state.progression.clearedStageIds.includes(id);
  const clearedStageIds = replay
    ? state.progression.clearedStageIds
    : [...state.progression.clearedStageIds, id];
  const isCurrentUnlock = chapter === state.progression.unlockedChapter &&
    stage === state.progression.unlockedStage;
  const nextChapter = stage === 10 ? chapter + 1 : chapter;
  const nextStage = stage === 10 ? 1 : stage + 1;
  let unlockedChapter = state.progression.unlockedChapter;
  let unlockedStage = state.progression.unlockedStage;
  if (isCurrentUnlock) {
    unlockedChapter = nextChapter;
    unlockedStage = nextStage;
  }
  const maxHp = derivePlayerStats(state).maxHp;
  const player = { ...state.player, currentHp: Math.max(state.player.currentHp, Math.ceil(maxHp * BALANCE.healAfterStage)) };
  const xpAward = BALANCE.xpRewards.stageClear + (stage % 5 === 0 ? BALANCE.xpRewards.boss : 0);
  const xpResult = grantXp({ ...state, player }, xpAward, replay);
  if (!xpResult.ok) return xpResult;
  return {
    ok: true,
    replay,
    xpGained: xpResult.granted,
    nextChapter,
    nextStage,
    state: {
      ...xpResult.state,
      progression: {
        ...state.progression,
        chapter,
        currentStage: stage,
        unlockedChapter,
        unlockedStage,
        clearedStageIds,
      },
    },
  };
}

export function retryStage(stageSnapshot, currentState) {
  const restored = {
    ...stageSnapshot,
    player: { ...currentState.player },
    progression: { ...stageSnapshot.progression },
  };
  const maxHp = derivePlayerStats(restored).maxHp;
  restored.player.currentHp = maxHp;
  return { ok: true, state: restored };
}
