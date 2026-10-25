import assert from 'node:assert/strict';
import { createInitialState } from '../../src/game/domain/stateFactory.js';
import {
  previewProfileSpend,
  runProfileSpendPreview,
} from '../../src/game/domain/profileActionClient.js';
import { test } from 'node:test';

function state() {
  let id = 0;
  return createInitialState(() => `profile-client-${++id}`);
}

test('failed reset and upgrade previews never call the server spend command', async () => {
  let calls = 0;
  const noResetPoints = state();
  const reset = await runProfileSpendPreview(noResetPoints, { type:'reset-stat-points' }, async () => { calls += 1; });
  assert.equal(reset.ok, false);
  assert.equal(calls, 0);

  const noMaterials = state();
  const upgrade = await runProfileSpendPreview(noMaterials, {
    type:'upgrade-gear', itemId:noMaterials.equipment.helmet.id,
  }, async () => { calls += 1; });
  assert.equal(upgrade.ok, false);
  assert.equal(upgrade.reason, 'insufficient-materials');
  assert.equal(calls, 0);
});

test('online upgrades validate that the item is equipped before spending canonical materials', async () => {
  const current = state();
  current.materials = 100;
  current.inventory.push({ ...structuredClone(current.equipment.helmet), id:'inventory-only-item' });
  const preview = previewProfileSpend(current, { type:'upgrade-gear', itemId:'inventory-only-item' }, { serverProfile:true });
  assert.deepEqual(preview, { ok:false, reason:'server-upgrade-requires-equipped-item' });
});

test('successful previews request only the computed debit and retain server balances with client equipment results', async () => {
  const current = state();
  current.materials = 100;
  const result = await runProfileSpendPreview(current, {
    type:'upgrade-gear', itemId:current.equipment.helmet.id,
  }, async (action) => {
    assert.deepEqual(action, { type:'spend-materials', amount:10 });
    return {
      ok:true,
      revision:2,
      state:{ ...structuredClone(current), materials:90 },
    };
  }, { serverProfile:true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.action, { type:'spend-materials', amount:10 });
  assert.equal(result.state.materials, 90);
  assert.ok(result.state.equipment.helmet.level >= 1);
  assert.notEqual(result.state, current);
});
