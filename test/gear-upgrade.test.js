import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE, GEAR_SLOT, RARITY, getGearUpgradeBand } from '../packages/game-rules/src/balance.js';
import { createInitialState, derivePlayerStats, getGearUpgradeCost, upgradeGear } from '../src/game/domain/gear.js';

function makeItem({ id = 'test-gear', slot = GEAR_SLOT.SPEAR, rarity = RARITY.COMMON, level = 1, stats = { attack: 100 }, effects = [] } = {}) {
  return { id, slot, rarity, level, stats, effects };
}

function stateWithItem(item, location = 'equipment') {
  const state = createInitialState(() => 'starter');
  state.materials = getGearUpgradeCost(item.level);
  if (location === 'equipment') state.equipment = { ...state.equipment, [item.slot]: item };
  else state.inventory = [item];
  return state;
}

function queuedRng(values) {
  let calls = 0;
  return {
    rng() {
      const value = values[calls];
      calls += 1;
      return value ?? 0;
    },
    get calls() { return calls; },
  };
}

test('upgrade results expose the current-level failure, destruction, and great-success chances', () => {
  const item = makeItem({ level: 26 });
  const state = stateWithItem(item);
  const random = queuedRng([0.99, 0.99, 0.99, 0, 0, 0]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'success');
  assert.equal(result.failureChance, getGearUpgradeBand(26).failureChance);
  assert.equal(result.destructionChance, getGearUpgradeBand(26).destructionChance);
  assert.equal(result.greatSuccessChance, BALANCE.gearUpgrade.greatSuccessChance);
  assert.equal(result.greatSuccess, false);
});

test('destruction takes precedence even when the independent failure roll also succeeds', () => {
  const item = makeItem({ level: 26 });
  const state = stateWithItem(item);
  const random = queuedRng([0.149, 0.69]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'destroyed');
  assert.strictEqual(result.destroyedItem, item);
  assert.equal(result.greatSuccess, false);
  assert.equal(result.state.equipment[item.slot], null);
  assert.equal(result.state.materials, state.materials - getGearUpgradeCost(item.level));
  assert.equal(random.calls, 2);
});

test('destruction removes an inventory item and preserves all other items', () => {
  const item = makeItem({ level: 11 });
  const other = makeItem({ id: 'other', slot: GEAR_SLOT.HELMET });
  const state = stateWithItem(item, 'inventory');
  state.inventory.push(other);
  const random = queuedRng([0.029, 0.14]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.outcome, 'destroyed');
  assert.deepEqual(result.state.inventory, [other]);
  assert.strictEqual(result.destroyedItem, item);
  assert.equal(random.calls, 2);
});

test('destroying equipped maximum-HP gear clamps current HP to the new maximum', () => {
  const item = makeItem({ slot: GEAR_SLOT.ARMOR, level: 11, stats: { maxHp: 120 } });
  const state = stateWithItem(item);
  state.player.currentHp = derivePlayerStats(state).maxHp;
  const random = queuedRng([0.029, 0.14]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.outcome, 'destroyed');
  assert.equal(result.state.player.currentHp, derivePlayerStats(result.state).maxHp);
  assert.ok(result.state.player.currentHp <= derivePlayerStats(result.state).maxHp);
});

test('a non-destructive failed attempt consumes materials and preserves the item unchanged', () => {
  const item = makeItem({ level: 6 });
  const state = stateWithItem(item);
  const random = queuedRng([0.01, 0.049]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.outcome, 'failed');
  assert.strictEqual(result.item, item);
  assert.strictEqual(result.state.equipment[item.slot], item);
  assert.equal(result.state.materials, state.materials - getGearUpgradeCost(item.level));
  assert.equal(result.greatSuccess, false);
  assert.equal(random.calls, 2);
});

test('a successful item uses its level band and great success doubles only the rolled increase', () => {
  const item = makeItem({ level: 26 });
  const state = stateWithItem(item);
  const ordinary = queuedRng([0.15, 0.7, 0.99, 0, 0, 0]);
  const success = upgradeGear(state, item.id, ordinary.rng);
  assert.equal(success.outcome, 'success');
  assert.equal(success.item.stats.attack, 106);
  assert.equal(success.state.materials, state.materials - getGearUpgradeCost(item.level));
  assert.equal(ordinary.calls, 6);

  const great = queuedRng([0.15, 0.7, 0.049, 0, 0, 0]);
  const greatSuccess = upgradeGear(state, item.id, great.rng);
  assert.equal(greatSuccess.outcome, 'success');
  assert.equal(greatSuccess.greatSuccess, true);
  assert.equal(greatSuccess.item.stats.attack, 112);
  assert.equal(great.calls, 6);
});

test('fractional ordinary stats are rounded to six decimals after a great success', () => {
  const item = makeItem({ level: 1, stats: { attack: 12.3456789 } });
  const state = stateWithItem(item);
  const random = queuedRng([0.99, 0.99, 0.01, 0, 0, 0]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.greatSuccess, true);
  assert.equal(result.item.stats.attack, 13.654321);
});

test('invalid attempts do not consume random values or resources', () => {
  const random = queuedRng([0]);
  const missing = createInitialState(() => 'starter');
  missing.materials = 100;
  assert.equal(upgradeGear(missing, 'missing', random.rng).reason, 'item-not-found');

  const item = makeItem({ level: BALANCE.gearMaxLevel });
  const maxed = stateWithItem(item);
  assert.equal(upgradeGear(maxed, item.id, random.rng).reason, 'max-level');

  const lowMaterials = stateWithItem(makeItem({ id: 'low', level: 6 }));
  lowMaterials.materials -= 1;
  assert.equal(upgradeGear(lowMaterials, 'low', random.rng).reason, 'insufficient-materials');
  assert.equal(random.calls, 0);
});

test('damage reduction cannot exceed its 100 percent cap after a great success', () => {
  const item = makeItem({
    rarity: RARITY.UNIQUE,
    level: 1,
    stats: { attack: 100 },
    effects: [{ id: 'damageReduction', value: 0.99 }],
  });
  const state = stateWithItem(item);
  const random = queuedRng([0.99, 0.99, 0, 0.34, 0, 0.99]);
  const result = upgradeGear(state, item.id, random.rng);

  assert.equal(result.outcome, 'success');
  assert.equal(result.greatSuccess, true);
  assert.ok(result.item.effects[0].value <= 1);
});
