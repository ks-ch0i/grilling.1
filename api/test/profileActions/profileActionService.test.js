import assert from 'node:assert/strict';
import { createInitialState } from '../../../src/game/domain/gear.js';
import { defaultRewardProfile } from '../../src/domain/playerProfile.js';
import { applyProfileAction } from '../../src/services/profileActionService.js';
import { test } from 'node:test';

const identity = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const actionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const secondActionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const fixedNow = new Date('2026-10-25T03:00:00.000Z');

function rowFromProfile(playerId, profile) {
  return {
    PlayerId: playerId,
    Level: profile.level,
    Xp: profile.xp,
    XpToNext: profile.xpToNext,
    PendingLevelUps: profile.pendingLevelUps,
    Gold: profile.gold,
    Materials: profile.materials,
    InventoryJson: JSON.stringify(profile.inventory),
    Chapter: profile.chapter,
    CurrentStage: profile.currentStage,
    UnlockedChapter: profile.unlockedChapter,
    UnlockedStage: profile.unlockedStage,
    ClearedStageIdsJson: JSON.stringify(profile.clearedStageIds),
    UpdatedAtUtc: fixedNow,
  };
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}

function createHarness({ profile: profileValues = {}, failures = {} } = {}) {
  let gearId = 0;
  const state = createInitialState(() => `owned-gear-${++gearId}`);
  const playerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const saves = new Map([[playerId, {
    SchemaVersion: 2,
    Revision: 1,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: fixedNow,
  }]]);
  const profiles = new Map([[playerId, rowFromProfile(playerId, { ...defaultRewardProfile(), ...profileValues })]]);
  const ledger = new Map();
  const lockTails = new Map();
  const releases = new WeakMap();
  const keyFor = (id, operationId) => `${id}/${operationId}`;

  const repository = {
    saves,
    profiles,
    ledger,
    async findPlayerIdByIdentity(_pool, input) {
      return input.tenantId === identity.tenantId && input.objectId === identity.objectId ? playerId : null;
    },
    async getProfileAction(_transaction, id, operationId) {
      return clone(ledger.get(keyFor(id, operationId)) ?? null);
    },
    async lockPlayer(transaction, id) {
      if (id !== playerId) return false;
      const previous = lockTails.get(id) ?? Promise.resolve();
      let release;
      const next = new Promise((resolve) => { release = resolve; });
      lockTails.set(id, next);
      await previous;
      releases.set(transaction, () => {
        release();
        if (lockTails.get(id) === next) lockTails.delete(id);
      });
      return true;
    },
    async getSaveForUpdate(_transaction, id) {
      return clone(saves.get(id) ?? null);
    },
    async getRewardProfileByPlayerId(_transaction, id) {
      return clone(profiles.get(id) ?? null);
    },
    async compareAndSwap(_transaction, input) {
      const current = saves.get(input.playerId);
      if (!current || Number(current.Revision) !== input.expectedRevision) return null;
      const updated = {
        SchemaVersion: input.schemaVersion,
        Revision: Number(current.Revision) + 1,
        SaveJson: input.saveJson,
        UpdatedAtUtc: input.updatedAtUtc,
      };
      saves.set(input.playerId, updated);
      if (failures.profileUpdate) throw new Error('profile update failed');
      if (input.rewardProfile) profiles.set(input.playerId, rowFromProfile(input.playerId, input.rewardProfile));
      return clone(updated);
    },
    async insertProfileAction(_transaction, input) {
      if (failures.ledgerInsert) throw new Error('ledger insert failed');
      const key = keyFor(input.playerId, input.actionId);
      if (ledger.has(key)) throw Object.assign(new Error('duplicate action'), { number: 2627 });
      const row = {
        PlayerId: input.playerId,
        ActionId: input.actionId,
        RequestJson: input.requestJson,
        ResultJson: input.resultJson,
        AppliedAtUtc: input.appliedAtUtc,
      };
      ledger.set(key, row);
      return clone(row);
    },
  };

  const withTransaction = async (_pool, work) => {
    const transaction = {};
    const savesBefore = new Map([...saves].map(([key, value]) => [key, clone(value)]));
    const profilesBefore = new Map([...profiles].map(([key, value]) => [key, clone(value)]));
    const ledgerBefore = new Map([...ledger].map(([key, value]) => [key, clone(value)]));
    try {
      return await work(transaction);
    } catch (error) {
      saves.clear();
      profiles.clear();
      ledger.clear();
      for (const [key, value] of savesBefore) saves.set(key, value);
      for (const [key, value] of profilesBefore) profiles.set(key, value);
      for (const [key, value] of ledgerBefore) ledger.set(key, value);
      throw error;
    } finally {
      releases.get(transaction)?.();
    }
  };

  return {
    repository,
    profile: () => JSON.parse(profiles.get(playerId).InventoryJson),
    playerId,
    state,
    run(body, options = {}) {
      return applyProfileAction({}, identity, body, {
        repository,
        withTransaction,
        clock: () => fixedNow,
        rollCritical: options.rollCritical ?? (() => false),
      });
    },
    revision: () => Number(saves.get(playerId).Revision),
    currentState: () => JSON.parse(saves.get(playerId).SaveJson),
  };
}

function makeItem(state, rarity = 'common', id = 'inventory-item-1') {
  return {
    ...structuredClone(state.equipment.helmet),
    id,
    rarity,
    effects: rarity === 'unique' || rarity === 'legendary'
      ? [{ id: 'bonusDamage', value: 0.1 }]
      : [],
  };
}

function request(action, { id = actionId, revision = 1 } = {}) {
  return { actionId: id, expectedSaveRevision: revision, action };
}

test('equipping swaps the selected inventory item with the previously equipped canonical item', async () => {
  const harness = createHarness({ profile: { inventory: [] } });
  const item = makeItem(harness.state);
  const displacedItem = harness.state.equipment.helmet;
  const profile = { ...defaultRewardProfile(), inventory: [item], gold: 10 };
  harness.repository.profiles.set(harness.playerId, rowFromProfile(harness.playerId, profile));
  const result = await harness.run(request({
    type: 'equip-inventory-item',
    itemId: item.id,
    expectedEquippedItemId:displacedItem.id,
  }));

  assert.equal(result.status, 200);
  assert.equal(result.revision, 2);
  assert.equal(result.appliedRevision, 2);
  assert.deepEqual(result.consumedItem, item);
  assert.deepEqual(result.state.inventory, [displacedItem]);
  assert.deepEqual(result.state.equipment.helmet, item);
  assert.equal(harness.revision(), 2);
  assert.deepEqual(JSON.parse(harness.repository.profiles.get(harness.playerId).InventoryJson), [displacedItem]);
  assert.equal(harness.currentState().equipment.helmet.id, item.id);
});

test('equipping rejects a stale replacement item without consuming the selected inventory gear', async () => {
  const harness = createHarness();
  const item = makeItem(harness.state);
  harness.repository.profiles.set(harness.playerId, rowFromProfile(harness.playerId, {
    ...defaultRewardProfile(), inventory:[item],
  }));
  const result = await harness.run(request({
    type:'equip-inventory-item',
    itemId:item.id,
    expectedEquippedItemId:'stale-equipped-item',
  }));

  assert.equal(result.status, 409);
  assert.equal(result.code, 'equipment-changed');
  assert.equal(result.revision, 1);
  assert.deepEqual(result.state.inventory, [item]);
  assert.equal(harness.revision(), 1);
  assert.deepEqual(harness.profile(), [item]);
});

for (const [rarity, expected] of Object.entries({ common: 1, uncommon: 2, rare: 4, unique: 8, legendary: 16 })) {
  test(`dismantling a ${rarity} inventory item grants its fixed material yield`, async () => {
    const harness = createHarness();
    const item = makeItem(harness.state, rarity);
    harness.repository.profiles.set(harness.playerId, rowFromProfile(harness.playerId, {
      ...defaultRewardProfile(), inventory: [item], materials: 0,
    }));
    const result = await harness.run(request({ type: 'dismantle-inventory-item', itemId: item.id }));

    assert.equal(result.status, 200);
    assert.equal(result.materialsGained, expected);
    assert.equal(result.criticalSuccess, false);
    assert.equal(result.state.materials, expected);
    assert.deepEqual(result.state.inventory, []);
  });
}

test('dismantling applies the server-side critical double yield and rejects safe-integer overflow atomically', async () => {
  const critical = createHarness();
  const item = makeItem(critical.state, 'rare');
  critical.repository.profiles.set(critical.playerId, rowFromProfile(critical.playerId, {
    ...defaultRewardProfile(), inventory: [item], materials: 2,
  }));
  const doubled = await critical.run(request({ type: 'dismantle-inventory-item', itemId: item.id }), {
    rollCritical: () => true,
  });
  assert.equal(doubled.materialsGained, 8);
  assert.equal(doubled.criticalSuccess, true);
  assert.equal(doubled.state.materials, 10);

  const overflow = createHarness();
  const overflowItem = makeItem(overflow.state, 'common');
  overflow.repository.profiles.set(overflow.playerId, rowFromProfile(overflow.playerId, {
    ...defaultRewardProfile(), inventory: [overflowItem], materials: Number.MAX_SAFE_INTEGER,
  }));
  const rejected = await overflow.run(request({ type: 'dismantle-inventory-item', itemId: overflowItem.id }));
  assert.deepEqual(rejected, { status: 422, code: 'profile-overflow' });
  assert.equal(overflow.revision(), 1);
  assert.equal(overflow.repository.ledger.size, 0);
  assert.equal(JSON.parse(overflow.repository.profiles.get(overflow.playerId).InventoryJson)[0].id, overflowItem.id);
});

test('gold and materials spending allows exact balances and rejects overspending', async () => {
  const gold = createHarness({ profile: { gold: 100 } });
  const exactGold = await gold.run(request({ type: 'spend-gold', amount: 100 }));
  assert.equal(exactGold.status, 200);
  assert.equal(exactGold.state.gold, 0);

  const materials = createHarness({ profile: { materials: 25 } });
  const exactMaterials = await materials.run(request({
    type: 'spend-materials', amount: 25,
  }));
  assert.equal(exactMaterials.status, 200);
  assert.equal(exactMaterials.state.materials, 0);
  assert.deepEqual(await materials.run(request({ type: 'spend-materials', amount: 1 }, { id: secondActionId, revision: 2 })), {
    status: 422, code: 'insufficient-materials',
  });
  assert.equal(materials.revision(), 2);
});

test('missing items and stale revisions return current canonical state without applying a command', async () => {
  const harness = createHarness({ profile: { gold: 7 } });
  const missing = await harness.run(request({ type: 'dismantle-inventory-item', itemId: 'missing-item' }));
  assert.deepEqual(missing, { status: 404, code: 'inventory-item-not-found' });

  const stale = await harness.run(request({ type: 'spend-gold', amount: 1 }, { revision: 2 }));
  assert.equal(stale.status, 409);
  assert.equal(stale.code, 'save-revision-conflict');
  assert.equal(stale.revision, 1);
  assert.equal(stale.state.gold, 7);
  assert.equal(harness.revision(), 1);
  assert.equal(harness.repository.ledger.size, 0);
});

test('retries return the original receipt and latest profile state; action-id reuse with different input conflicts', async () => {
  const harness = createHarness({ profile: { gold: 9 } });
  const item = makeItem(harness.state, 'rare');
  harness.repository.profiles.set(harness.playerId, rowFromProfile(harness.playerId, {
    ...defaultRewardProfile(), inventory: [item], gold: 9,
  }));
  const firstRequest = request({ type: 'dismantle-inventory-item', itemId: item.id });
  const first = await harness.run(firstRequest, { rollCritical: () => true });
  const second = await harness.run(request({ type: 'spend-gold', amount: 4 }, { id: secondActionId, revision: 2 }));
  const retry = await harness.run(firstRequest);
  const conflict = await harness.run(request({ type: 'spend-gold', amount: 1 }));

  assert.equal(first.materialsGained, 8);
  assert.equal(second.revision, 3);
  assert.equal(retry.replayed, true);
  assert.equal(retry.appliedRevision, 2);
  assert.equal(retry.revision, 3);
  assert.equal(retry.state.gold, 5);
  assert.equal(retry.state.materials, 8);
  assert.deepEqual(conflict, { status: 409, code: 'action-id-conflict' });
  assert.equal(harness.revision(), 3);
});

test('identical concurrent requests commit only once and both receive the stored receipt', async () => {
  const harness = createHarness({ profile: { gold: 9 } });
  const body = request({ type: 'spend-gold', amount: 3 });
  const results = await Promise.all([harness.run(body), harness.run(body)]);

  assert.deepEqual(results.map(({ status }) => status), [200, 200]);
  assert.equal(results.filter(({ replayed }) => replayed).length, 1);
  assert.equal(harness.revision(), 2);
  assert.equal(Number(harness.repository.profiles.get(harness.playerId).Gold), 6);
  assert.equal(harness.repository.ledger.size, 1);
});

test('profile or ledger write failures roll back CloudSave revision and profile state together', async () => {
  for (const failure of ['profileUpdate', 'ledgerInsert']) {
    const harness = createHarness({ profile: { gold: 10 }, failures: { [failure]: true } });
    await assert.rejects(
      () => harness.run(request({ type: 'spend-gold', amount: 3 })),
      new RegExp(failure === 'profileUpdate' ? 'profile update failed' : 'ledger insert failed'),
    );
    assert.equal(harness.revision(), 1);
    assert.equal(harness.currentState().gold, 0);
    assert.equal(Number(harness.repository.profiles.get(harness.playerId).Gold), 10);
    assert.equal(harness.repository.ledger.size, 0);
  }
});
