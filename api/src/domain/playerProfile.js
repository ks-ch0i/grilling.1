import { migrateGameState } from '@knight-run/game-rules/save';

function safeInteger(value, field, minimum = 0) {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new TypeError(`Reward profile ${field} is invalid.`);
  }
  return parsed;
}

function parseJson(value, field) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (error) {
    throw new TypeError(`Reward profile ${field} is invalid JSON.`, { cause: error });
  }
}

export function defaultRewardProfile() {
  return {
    level: 1,
    xp: 0,
    xpToNext: 100,
    pendingLevelUps: 0,
    gold: 0,
    materials: 0,
    inventory: [],
    chapter: 1,
    currentStage: 1,
    unlockedChapter: 1,
    unlockedStage: 1,
    clearedStageIds: [],
  };
}

export function parseRewardProfile(row) {
  if (!row || row.PlayerId === null || row.PlayerId === undefined) {
    throw new TypeError('Reward profile row is missing.');
  }
  const inventory = parseJson(row.InventoryJson, 'inventory');
  const clearedStageIds = parseJson(row.ClearedStageIdsJson, 'cleared stages');
  if (!Array.isArray(inventory) || !Array.isArray(clearedStageIds) ||
      !clearedStageIds.every((id) => typeof id === 'string' && /^\d+-\d+$/.test(id))) {
    throw new TypeError('Reward profile collections are invalid.');
  }
  const profile = {
    level: safeInteger(row.Level, 'level', 1),
    xp: safeInteger(row.Xp, 'xp'),
    xpToNext: safeInteger(row.XpToNext, 'xp threshold', 1),
    pendingLevelUps: safeInteger(row.PendingLevelUps, 'pending level ups'),
    gold: safeInteger(row.Gold, 'gold'),
    materials: safeInteger(row.Materials, 'materials'),
    inventory,
    chapter: safeInteger(row.Chapter, 'chapter', 1),
    currentStage: safeInteger(row.CurrentStage, 'current stage', 1),
    unlockedChapter: safeInteger(row.UnlockedChapter, 'unlocked chapter', 1),
    unlockedStage: safeInteger(row.UnlockedStage, 'unlocked stage', 1),
    clearedStageIds,
  };
  if (profile.currentStage > 10 || profile.unlockedStage > 10) {
    throw new TypeError('Reward profile stage is invalid.');
  }
  return profile;
}

export function mergeRewardProfile(clientState, profile) {
  if (!profile) throw new TypeError('Reward profile is missing.');
  const base = migrateGameState(clientState);
  const merged = {
    ...base,
    player: {
      ...base.player,
      level: profile.level,
      xp: profile.xp,
      xpToNext: profile.xpToNext,
      pendingLevelUps: profile.pendingLevelUps,
    },
    inventory: structuredClone(profile.inventory),
    materials: profile.materials,
    gold: profile.gold,
    progression: {
      ...base.progression,
      chapter: profile.chapter,
      currentStage: profile.currentStage,
      unlockedChapter: profile.unlockedChapter,
      unlockedStage: profile.unlockedStage,
      clearedStageIds: [...profile.clearedStageIds],
    },
  };
  return migrateGameState(merged);
}
