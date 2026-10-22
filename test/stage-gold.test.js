import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../packages/game-rules/src/balance.js';
import { createInitialState, derivePlayerStats } from '../src/game/domain/gear.js';
import { completeStage, createGoldRoom, getStageGoldRequirement, grantGold, resetInvalidGoldBalance, retryStage } from '../src/game/domain/progression.js';

function stateWithGold(gold = 0) {
  const state = createInitialState((() => {
    let id = 0;
    return () => `starter-${++id}`;
  })());
  state.gold = gold;
  return state;
}

test('normal and boss defeat rewards add the confirmed amount exactly', () => {
  const initial = stateWithGold(20);
  const normal = grantGold(initial, BALANCE.goldRewards.normalEnemy);
  const boss = grantGold(normal.state, BALANCE.goldRewards.boss);

  assert.equal(normal.ok, true);
  assert.equal(normal.granted, 11);
  assert.equal(normal.state.gold, 31);
  assert.equal(boss.granted, 55);
  assert.equal(boss.state.gold, 86);
  assert.equal(initial.gold, 20);
});

test('gold additions reject invalid balances and safe-integer overflow without changing input state', () => {
  const initial = stateWithGold(Number.MAX_SAFE_INTEGER - 5);
  const overflow = grantGold(initial, BALANCE.goldRewards.normalEnemy);
  assert.deepEqual(overflow, { ok: false, reason: 'gold-overflow' });
  assert.equal(initial.gold, Number.MAX_SAFE_INTEGER - 5);
  assert.deepEqual(grantGold({ ...initial, gold: -1 }, 1), { ok: false, reason: 'invalid-gold' });
});

test('stage entry reserves enough safe-integer capacity for every kill and clear reward', () => {
  assert.equal(getStageGoldRequirement(4, false), 4 * 11 + 175);
  assert.equal(getStageGoldRequirement(10, true), 10 * 11 + 55 + 175);
  assert.throws(() => getStageGoldRequirement(3, false), RangeError);
  assert.throws(() => getStageGoldRequirement(4, 1), RangeError);

  const initial = stateWithGold(Number.MAX_SAFE_INTEGER - getStageGoldRequirement(4, false) + 1);
  assert.deepEqual(grantGold(initial, getStageGoldRequirement(4, false)), {
    ok:false,
    reason:'gold-overflow',
  });
});

test('explicit gold-room adjustment creates capacity while preserving a valid balance otherwise', () => {
  const requiredGold = getStageGoldRequirement(10, true);
  const initial = stateWithGold(Number.MAX_SAFE_INTEGER - 100);
  const adjustment = createGoldRoom(initial, requiredGold);

  assert.equal(adjustment.ok, true);
  assert.equal(adjustment.adjustment, requiredGold - 100);
  assert.equal(adjustment.state.gold, Number.MAX_SAFE_INTEGER - requiredGold);
  assert.equal(grantGold(adjustment.state, requiredGold).ok, true);
  assert.equal(initial.gold, Number.MAX_SAFE_INTEGER - 100);

  const alreadyFits = createGoldRoom(stateWithGold(20), requiredGold);
  assert.equal(alreadyFits.adjustment, 0);
  assert.equal(alreadyFits.state.gold, 20);
});

test('invalid gold repair is explicit and leaves every other saved field intact', () => {
  const invalid = { ...stateWithGold(0), gold:-1 };
  const repaired = resetInvalidGoldBalance(invalid);

  assert.equal(repaired.ok, true);
  assert.equal(repaired.state.gold, 0);
  assert.equal(invalid.gold, -1);
  assert.deepEqual(repaired.state.player, invalid.player);
  assert.deepEqual(repaired.state.progression, invalid.progression);
  assert.deepEqual(resetInvalidGoldBalance(stateWithGold(1)), { ok:false, reason:'gold-is-valid' });
});

test('successful first and replay clears both award exactly 175 gold', () => {
  const first = stateWithGold(40);
  const clear = completeStage(first, 1, 1);
  assert.equal(clear.ok, true);
  assert.equal(clear.replay, false);
  assert.equal(clear.state.gold, 40 + BALANCE.goldRewards.stageClear);
  assert.deepEqual(clear.state.progression.clearedStageIds, ['1-1']);

  const replayState = { ...clear.state, gold: 200 };
  const replay = completeStage(replayState, 1, 1);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(replay.state.gold, 200 + BALANCE.goldRewards.stageClear);
  assert.deepEqual(replay.state.progression.clearedStageIds, ['1-1']);
});

test('a clear reward overflow fails before XP, HP, or progression changes are applied', () => {
  const initial = stateWithGold(Number.MAX_SAFE_INTEGER);
  initial.player.currentHp = 1;
  const before = structuredClone(initial);
  const result = completeStage(initial, 1, 1);

  assert.deepEqual(result, { ok: false, reason: 'gold-overflow' });
  assert.deepEqual(initial, before);
});

test('retry restores the stage snapshot while retaining current gold and player progress', () => {
  const snapshot = stateWithGold(25);
  const current = {
    ...snapshot,
    gold: 108,
    player: { ...snapshot.player, currentHp: 0, xp: 85, pendingLevelUps: 1, availableStatPoints: 2 },
  };
  const result = retryStage(snapshot, current);

  assert.equal(result.ok, true);
  assert.equal(result.state.gold, 108);
  assert.equal(result.state.player.currentHp, derivePlayerStats(result.state).maxHp);
  assert.equal(result.state.player.xp, 85);
  assert.equal(result.state.player.pendingLevelUps, 1);
  assert.equal(result.state.player.availableStatPoints, 2);
  assert.deepEqual(result.state.progression, snapshot.progression);
});
