import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivePlayerStats } from '../src/game/domain/gear.js';
import { createInitialState } from '../src/game/domain/stateFactory.js';
import {
  allocateStatPoint,
  getStatResetCost,
  resetStatPoints,
  resolveLevelUp,
} from '../src/game/domain/progression.js';

function stateWith({ level = 1, pendingLevelUps = 0, availableStatPoints = 0, spentStatPoints = 0, gold = 0 } = {}) {
  const state = createInitialState((() => {
    let id = 0;
    return () => `gear-${++id}`;
  })());
  state.player.level = level;
  state.player.pendingLevelUps = pendingLevelUps;
  state.player.availableStatPoints = availableStatPoints;
  state.player.spentStatPoints = spentStatPoints;
  state.gold = gold;
  return state;
}

test('level-up resolves zero, one, or two points and permits duplicate allocations', () => {
  const initial = stateWith({ pendingLevelUps: 1, availableStatPoints: 3, spentStatPoints: 2 });
  const result = resolveLevelUp(initial, ['attack', 'attack']);

  assert.equal(result.ok, true);
  assert.equal(result.state.player.level, 2);
  assert.equal(result.state.player.pendingLevelUps, 0);
  assert.equal(result.state.player.baseStats.attack, initial.player.baseStats.attack + 10);
  assert.equal(result.state.player.availableStatPoints, 3);
  assert.equal(result.state.player.spentStatPoints, 4);
  assert.equal(result.state.player.currentHp, initial.player.currentHp);

  const held = resolveLevelUp(initial, []);
  assert.equal(held.ok, true);
  assert.equal(held.state.player.availableStatPoints, 5);
  assert.equal(held.state.player.spentStatPoints, 2);
});

test('level-up rejects invalid allocations without mutating state and requires a pending level', () => {
  const initial = stateWith({ pendingLevelUps: 1 });
  const sparse = [];
  sparse.length = 1;
  for (const allocations of [null, 'attack', ['attack', 'defense', 'maxHp'], ['speed'], sparse]) {
    const result = resolveLevelUp(initial, allocations);
    assert.deepEqual(result, { ok: false, reason: 'invalid-allocation' });
    assert.equal(initial.player.level, 1);
    assert.equal(initial.player.pendingLevelUps, 1);
  }
  assert.deepEqual(resolveLevelUp(stateWith(), []), { ok: false, reason: 'no-pending-level-up' });
});

test('town allocation spends one available point and caps HP at the gear-derived maximum', () => {
  const initial = stateWith({ availableStatPoints: 1 });
  initial.player.currentHp = 215;
  const maxHp = allocateStatPoint(initial, 'maxHp');

  assert.equal(maxHp.ok, true);
  assert.equal(maxHp.state.player.baseStats.maxHp, initial.player.baseStats.maxHp + 30);
  assert.equal(maxHp.state.player.currentHp, 245);
  assert.equal(maxHp.state.player.availableStatPoints, 0);
  assert.equal(maxHp.state.player.spentStatPoints, 1);
  assert.equal(maxHp.state.gold, initial.gold);
  assert.deepEqual(allocateStatPoint(initial, 'critChance'), { ok: false, reason: 'invalid-stat' });
  assert.deepEqual(allocateStatPoint(maxHp.state, 'attack'), { ok: false, reason: 'insufficient-stat-points' });
});

test('reset cost increases from 1000 gold and rejects unsafe counts', () => {
  assert.equal(getStatResetCost(0), 1000);
  assert.equal(getStatResetCost(1), 1500);
  assert.equal(getStatResetCost(2), 2250);
  assert.throws(() => getStatResetCost(-1), RangeError);
  assert.throws(() => getStatResetCost(1.5), RangeError);
  assert.throws(() => getStatResetCost(Number.MAX_SAFE_INTEGER), RangeError);
});

test('reset refunds spent points, charges gold, preserves progression and gear, and clamps current HP', () => {
  const initial = stateWith({ level: 8, pendingLevelUps: 1, availableStatPoints: 2, spentStatPoints: 3, gold: 1500 });
  initial.player.baseStats.attack += 10;
  initial.player.baseStats.maxHp += 90;
  initial.player.currentHp = 300;
  const gear = initial.equipment;
  const progression = initial.progression;
  const result = resetStatPoints(initial);

  assert.equal(result.ok, true);
  assert.equal(result.cost, 1000);
  assert.equal(result.state.gold, 500);
  assert.equal(result.state.player.statResetCount, 1);
  assert.equal(result.state.player.availableStatPoints, 5);
  assert.equal(result.state.player.spentStatPoints, 0);
  assert.equal(result.state.player.baseStats.maxHp, 200);
  assert.equal(result.state.player.baseStats.attack, 10);
  assert.equal(result.state.player.currentHp, derivePlayerStats(result.state).maxHp);
  assert.equal(result.state.player.level, 8);
  assert.equal(result.state.player.pendingLevelUps, 1);
  assert.strictEqual(result.state.equipment, gear);
  assert.strictEqual(result.state.progression, progression);

  const second = resetStatPoints({
    ...result.state,
    player: { ...result.state.player, spentStatPoints: 1, baseStats: { ...result.state.player.baseStats, defense: 15 } },
    gold: 2250,
  });
  assert.equal(second.cost, 1500);
  assert.equal(second.state.gold, 750);
  assert.equal(second.state.player.statResetCount, 2);
  assert.equal(resetStatPoints({ ...initial, gold: 999 }).reason, 'insufficient-gold');
  assert.equal(resetStatPoints({ ...initial, player: { ...initial.player, spentStatPoints: 0 } }).reason, 'no-stat-points-spent');
});
