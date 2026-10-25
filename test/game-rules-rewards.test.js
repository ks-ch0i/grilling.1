import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '@knight-run/game-rules/balance';
import { replayRankedRun } from '@knight-run/game-rules/simulation';
import { createSeededRandom, deriveSeed } from '../packages/game-rules/src/seededRandom.js';
import { rollGear } from '../src/game/domain/gear.js';
import {
  StageRewardError,
  grantProfileXp,
  resolveStageDrops,
  resolveStageRewards,
  xpRequiredForLevel,
} from '@knight-run/game-rules/rewards';

function profile(overrides = {}) {
  return {
    level: 1,
    xp: 0,
    xpToNext: 100,
    pendingLevelUps: 0,
    gold: 0,
    materials: 0,
    inventory: [],
    progression: {
      chapter: 1,
      currentStage: 1,
      unlockedChapter: 1,
      unlockedStage: 1,
      clearedStageIds: [],
    },
    ...overrides,
  };
}

function ticket(currentProfile, overrides = {}) {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    seed: 123456789,
    simulatorVersion: 3,
    balanceVersion: 2,
    chapter: 1,
    stage: 1,
    playerSnapshot: {
      level: currentProfile.level,
      xp: currentProfile.xp,
      xpToNext: currentProfile.xpToNext,
      pendingLevelUps: currentProfile.pendingLevelUps,
      replayXpMultiplier: 1,
    },
    ...overrides,
  };
}

function replay(overrides = {}) {
  return {
    valid: true,
    outcome: 'death',
    elapsedTicks: 20,
    playerHp: overrides.outcome === 'clear' ? 1 : 0,
    rejectReason: null,
    defeatedEnemies: [],
    levelUps: [],
    collectedDropOrdinals: [],
    ...overrides,
  };
}

function enemy(id, { boss = false, tick = 5, x = 700, dropEligible = false } = {}) {
  return { id, isBoss: boss, tick, x, dropEligible };
}

test('reward streams derive a stable nonzero seed separate from the combat seed', () => {
  assert.equal(deriveSeed(123456789, 'stage-rewards'), deriveSeed(123456789, 'stage-rewards'));
  assert.notEqual(deriveSeed(123456789, 'stage-rewards'), 0);
  assert.notEqual(deriveSeed(123456789, 'stage-rewards'), deriveSeed(123456789, 'combat'));
  assert.throws(() => deriveSeed(0, 'stage-rewards'), RangeError);
  const first = createSeededRandom(deriveSeed(123456789, 'stage-rewards'));
  const second = createSeededRandom(deriveSeed(123456789, 'stage-rewards'));
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

test('normal kills and clear bonuses calculate XP, gold and progression without client reward fields', () => {
  const current = profile();
  const result = resolveStageRewards({
    ticket: ticket(current),
    replay: replay({
      outcome: 'clear',
      defeatedEnemies: [enemy('enemy-1'), enemy('enemy-2')],
      xpGranted: 999999,
      goldGranted: 999999,
      profilePatch: { gold: 999999 },
      drops: [{ id: 'client-item' }],
    }),
    profile: current,
  });

  assert.equal(result.xpGranted, BALANCE.xpRewards.normalEnemy * 2 + BALANCE.xpRewards.stageClear);
  assert.equal(result.goldGranted, BALANCE.goldRewards.normalEnemy * 2 + BALANCE.goldRewards.stageClear);
  assert.equal(result.profilePatch.xp, 20);
  assert.equal(result.profilePatch.pendingLevelUps, 1);
  assert.equal(result.profilePatch.gold, 197);
  assert.deepEqual(result.profilePatch.progression.clearedStageIds, ['1-1']);
  assert.deepEqual([result.profilePatch.progression.unlockedChapter, result.profilePatch.progression.unlockedStage], [1, 2]);
  assert.deepEqual(Object.keys(result.profilePatch).sort(), [
    'gold', 'inventory', 'level', 'pendingLevelUps', 'progression', 'xp', 'xpToNext',
  ]);
  assert.equal(current.gold, 0);
  assert.deepEqual(current.progression.clearedStageIds, []);
});

test('death keeps enemy rewards but never grants clear XP, clear gold or progression unlocks', () => {
  const current = profile();
  const defeat = replay({ defeatedEnemies: [enemy('enemy-1')] });
  const dead = resolveStageRewards({ ticket: ticket(current), replay: defeat, profile: current });
  const clear = resolveStageRewards({
    ticket: ticket(current),
    replay: { ...defeat, outcome: 'clear', playerHp: 1 },
    profile: current,
  });

  assert.equal(dead.xpGranted, BALANCE.xpRewards.normalEnemy);
  assert.equal(dead.goldGranted, BALANCE.goldRewards.normalEnemy);
  assert.deepEqual(dead.profilePatch.progression.clearedStageIds, []);
  assert.deepEqual([dead.profilePatch.progression.unlockedChapter, dead.profilePatch.progression.unlockedStage], [1, 1]);
  assert.equal(clear.xpGranted - dead.xpGranted, BALANCE.xpRewards.stageClear);
  assert.equal(clear.goldGranted - dead.goldGranted, BALANCE.goldRewards.stageClear);
  assert.deepEqual(clear.profilePatch.progression.clearedStageIds, ['1-1']);
});

test('boss clear rewards add boss gold and stage-five boss XP with the replay snapshot multiplier', () => {
  const current = profile({ progression: {
    chapter: 1,
    currentStage: 5,
    unlockedChapter: 1,
    unlockedStage: 6,
    clearedStageIds: ['1-5'],
  } });
  const stageTicket = ticket(current, {
    stage: 5,
    playerSnapshot: { ...ticket(current).playerSnapshot, replayXpMultiplier: BALANCE.replayXpMultiplier },
  });
  const result = resolveStageRewards({
    ticket: stageTicket,
    replay: replay({
      outcome: 'clear',
      defeatedEnemies: [enemy('enemy-1'), enemy('boss', { boss: true })],
    }),
    profile: current,
  });

  assert.equal(result.xpGranted,
    Math.floor(BALANCE.xpRewards.normalEnemy * BALANCE.replayXpMultiplier) +
    Math.floor(BALANCE.xpRewards.stageClear * BALANCE.replayXpMultiplier) +
    Math.floor(BALANCE.xpRewards.boss * BALANCE.replayXpMultiplier));
  assert.equal(result.goldGranted, BALANCE.goldRewards.normalEnemy + BALANCE.goldRewards.boss + BALANCE.goldRewards.stageClear);
  assert.deepEqual(result.profilePatch.progression.clearedStageIds, ['1-5']);
  assert.deepEqual([result.profilePatch.progression.unlockedChapter, result.profilePatch.progression.unlockedStage], [1, 6]);
});

test('replay level-up events consume pending levels and update the canonical threshold', () => {
  const current = profile({ xp: 90 });
  const result = resolveStageRewards({
    ticket: ticket(current),
    replay: replay({
      defeatedEnemies: [enemy('enemy-1')],
      levelUps: [{ tick: 10, level: 2, allocations: ['attack'] }],
    }),
    profile: current,
  });

  assert.equal(result.profilePatch.level, 2);
  assert.equal(result.profilePatch.xp, 0);
  assert.equal(result.profilePatch.xpToNext, xpRequiredForLevel(3));
  assert.equal(result.profilePatch.pendingLevelUps, 0);
  assert.deepEqual(Object.keys(result.profilePatch).includes('baseStats'), false);
});

test('grantProfileXp applies the snapshot replay multiplier as a floored per-award value', () => {
  const granted = grantProfileXp({
    level: 2, xp: 18, xpToNext: 20, pendingLevelUps: 0,
  }, 10, 0.3);

  assert.equal(granted.xpGranted, 3);
  assert.equal(granted.xp, 1);
  assert.equal(granted.pendingLevelUps, 1);
  assert.equal(granted.level, 2);
});

test('stage ten clear rolls the next unlock into chapter two stage one', () => {
  const current = profile({ progression: {
    chapter: 1,
    currentStage: 10,
    unlockedChapter: 1,
    unlockedStage: 10,
    clearedStageIds: [],
  } });
  const result = resolveStageRewards({
    ticket: ticket(current, { stage: 10 }),
    replay: replay({ outcome: 'clear', defeatedEnemies: [enemy('enemy-1'), enemy('boss', { boss: true })] }),
    profile: current,
  });

  assert.deepEqual([result.profilePatch.progression.unlockedChapter, result.profilePatch.progression.unlockedStage], [2, 1]);
  assert.deepEqual(result.profilePatch.progression.clearedStageIds, ['1-10']);
});

test('deterministic boss drops use stable IDs and collection requires the 45-pixel pickup range', () => {
  const current = profile();
  const stageTicket = ticket(current, { stage: 5 });
  const defeated = [enemy('boss', { boss: true, tick: 2, x: 500, dropEligible: true })];
  const atRange = [{ tick: 3, x: 546 }, { tick: 4, x: 545 }];
  const first = resolveStageDrops(stageTicket, defeated, atRange);
  const second = resolveStageDrops(stageTicket, defeated, atRange);
  const outsideRange = resolveStageDrops(stageTicket, defeated, [{ tick: 3, x: 546 }]);

  assert.deepEqual(first, second);
  assert.equal(first.drops.length, BALANCE.bossDropCount);
  assert.equal(first.drops[0].item.id, `${stageTicket.runId}:drop:1`);
  assert.deepEqual(first.drops[0].item, rollGear({
    stageIndex: stageTicket.stage,
    rng: createSeededRandom(deriveSeed(stageTicket.seed, 'stage-rewards')),
    idFactory: () => `${stageTicket.runId}:drop:1`,
  }));
  assert.deepEqual(first.collectedDropOrdinals, [1]);
  assert.deepEqual(outsideRange.collectedDropOrdinals, []);
  assert.deepEqual(resolveStageDrops(stageTicket, [enemy('boss', { boss: true, dropEligible: false })], []).drops, []);
});

test('normal enemies use the seeded normal-drop chance and repeated reward resolution stays byte-stable', () => {
  const current = profile();
  const stageTicket = ticket(current);
  const defeated = Array.from({ length: 100 }, (_, index) => enemy(`enemy-${index + 1}`, {
    tick: index,
    x: 700 + index * 10,
    dropEligible: true,
  }));
  const firstDrops = resolveStageDrops(stageTicket, defeated, []);
  const secondDrops = resolveStageDrops(stageTicket, defeated, []);
  const stageReplay = replay({ outcome: 'death', defeatedEnemies: [defeated[0]] });
  const firstRewards = resolveStageRewards({ ticket: stageTicket, replay: stageReplay, profile: current });
  const secondRewards = resolveStageRewards({ ticket: stageTicket, replay: stageReplay, profile: current });

  assert.ok(firstDrops.drops.length > 0 && firstDrops.drops.length < defeated.length);
  assert.deepEqual(firstDrops, secondDrops);
  assert.deepEqual(firstRewards, secondRewards);
});

test('full inventory prevents collected drops from entering the profile', () => {
  const inventory = Array.from({ length: BALANCE.inventoryCapacity }, (_, index) => ({
    id: `existing-${index}`,
    slot: 'helmet',
    rarity: 'common',
    level: 1,
    stats: { defense: 4 },
    effects: [],
  }));
  const current = profile({ inventory, progression: {
    chapter: 1, currentStage: 5, unlockedChapter: 1, unlockedStage: 5, clearedStageIds: [],
  } });
  const stageTicket = ticket(current, { stage: 5 });
  const result = resolveStageRewards({
    ticket: stageTicket,
    replay: replay({
      outcome: 'clear',
      defeatedEnemies: [enemy('boss', { boss: true, dropEligible: true })],
      collectedDropOrdinals: [1],
    }),
    profile: current,
  });

  assert.deepEqual(result.drops, []);
  assert.equal(result.profilePatch.inventory.length, BALANCE.inventoryCapacity);
  assert.equal(current.inventory.length, BALANCE.inventoryCapacity);
});

test('invalid replay/profile, ungenerated ordinals and numeric overflow use typed errors', () => {
  const current = profile();
  const stageTicket = ticket(current);
  const invalidCode = (callback, code) => assert.throws(callback, (error) => error instanceof StageRewardError && error.code === code);

  invalidCode(() => resolveStageRewards({ ticket: stageTicket, replay: replay({ valid: false, outcome: 'incomplete' }), profile: current }), 'invalid-replay');
  invalidCode(() => resolveStageRewards({ ticket: stageTicket, replay: replay(), profile: { ...current, gold: -1 } }), 'invalid-profile');
  invalidCode(() => resolveStageRewards({ ticket: { ...stageTicket, seed: 0 }, replay: replay(), profile: current }), 'invalid-stage');
  invalidCode(() => resolveStageRewards({
    ticket: stageTicket,
    replay: replay({ collectedDropOrdinals: [1] }),
    profile: current,
  }), 'invalid-replay');
  invalidCode(() => resolveStageRewards({
    ticket: stageTicket,
    replay: replay({ defeatedEnemies: [enemy('enemy-1')] }),
    profile: { ...current, gold: Number.MAX_SAFE_INTEGER },
  }), 'reward-overflow');
});

test('replay output exposes kill, drop-pickup and validated level-up events only for terminal runs', () => {
  const ticketData = {
    runId: 'replay-events', seed: 123456789, chapter: 1, stage: 1,
    simulatorVersion: 3, balanceVersion: 2, issuedAtUtc: '2026-10-21T00:00:00.000Z',
  };
  const terminal = replayRankedRun(ticketData, {
    maxHp: 10000, currentHp: 10000, attack: 1000, defense: 1000,
    critChance: 0, critMultiplier: 2, moveSpeed: 200, effects: [],
    level: 1, xp: 0, xpToNext: 100, pendingLevelUps: 0,
    availableStatPoints: 0, spentStatPoints: 0, replayXpMultiplier: 1,
  }, [{ tick: 0, kind: 'move', value: 1 }]);
  const incomplete = replayRankedRun(ticketData, {
    maxHp: 10000, currentHp: 10000, attack: 1000, defense: 1000,
    critChance: 0, critMultiplier: 2, moveSpeed: 200, effects: [],
    level: 1, xp: 99, xpToNext: 100, pendingLevelUps: 0,
    availableStatPoints: 0, spentStatPoints: 0, replayXpMultiplier: 1,
  }, [{ tick: 0, kind: 'move', value: 0 }]);

  assert.equal(terminal.valid, true);
  assert.ok(terminal.defeatedEnemies.length > 0);
  assert.ok(Array.isArray(terminal.levelUps));
  assert.ok(Array.isArray(terminal.collectedDropOrdinals));
  assert.equal(incomplete.valid, false);
  assert.equal(Object.hasOwn(incomplete, 'defeatedEnemies'), false);
});
