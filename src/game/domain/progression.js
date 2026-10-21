import { BALANCE, getStageDropWeights } from '../data/balance.js';
import { getStageEnemyStats } from '@knight-run/game-rules/balance';
import { derivePlayerStats } from './gear.js';

export { getStageEnemyStats };

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

export function chooseLevelUpStat(state, statKey) {
  const gains = BALANCE.levelUp;
  if (!Object.hasOwn(gains, statKey)) return { ok: false, reason: 'invalid-stat' };
  if (state.player.pendingLevelUps < 1) return { ok: false, reason: 'no-pending-level-up' };
  const oldMaxHp = state.player.baseStats.maxHp;
  const baseStats = { ...state.player.baseStats, [statKey]: state.player.baseStats[statKey] + gains[statKey] };
  const level = state.player.level + 1;
  const currentHp = statKey === 'maxHp'
    ? Math.min(baseStats.maxHp, state.player.currentHp + baseStats.maxHp - oldMaxHp)
    : Math.min(baseStats.maxHp, state.player.currentHp);
  return {
    ok: true,
    state: {
      ...state,
      player: {
        ...state.player,
        level,
        baseStats,
        currentHp,
        xpToNext: xpRequiredForLevel(level + 1),
        pendingLevelUps: state.player.pendingLevelUps - 1,
      },
    },
  };
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
