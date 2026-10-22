import assert from 'node:assert/strict';
import { createInitialState } from '../../../src/game/domain/gear.js';
import { toLegacyV1Save } from '../../test-support/saveStateFixtures.js';
import { test } from 'node:test';

let itemId = 0;
const makeState = () => createInitialState(() => `starter-${++itemId}`);
const makeBody = (state = makeState()) => ({ schemaVersion: 2, state });
const identityA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Player A',
};
const identityB = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  displayName: 'Player B',
};

async function loadCloudSaveDomain() {
  try {
    return await import('../../src/domain/cloudSave.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the cloud-save DTO module to exist: ${error.message}`);
    }
    throw error;
  }
}

async function loadCloudSaveService() {
  try {
    return await import('../../src/services/cloudSaveService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the cloud-save service module to exist: ${error.message}`);
    }
    throw error;
  }
}

function clone(value) {
  return value === null ? null : structuredClone(value);
}

function createMemoryRepository() {
  const players = new Map();
  const saves = new Map();
  let playerNumber = 0;
  const identityKey = (identity) => `${identity.tenantId}/${identity.objectId}`;
  return {
    players,
    saves,
    async findPlayerIdByIdentity(_pool, identity) {
      return players.get(identityKey(identity)) ?? null;
    },
    async getOrCreatePlayerId(_pool, identity) {
      const key = identityKey(identity);
      if (!players.has(key)) players.set(key, `player-${++playerNumber}`);
      return players.get(key);
    },
    async getByPlayerId(_pool, playerId) {
      return clone(saves.get(playerId) ?? null);
    },
    async insertInitial(_transaction, input) {
      if (saves.has(input.playerId)) throw Object.assign(new Error('duplicate'), { number: 2627 });
      const row = {
        SchemaVersion: input.schemaVersion,
        Revision: 1,
        SaveJson: input.saveJson,
        UpdatedAtUtc: input.updatedAtUtc,
      };
      saves.set(input.playerId, row);
      return clone(row);
    },
    async compareAndSwap(_transaction, input) {
      const row = saves.get(input.playerId);
      if (!row || row.Revision !== input.expectedRevision) return null;
      const updated = {
        SchemaVersion: input.schemaVersion,
        Revision: row.Revision + 1,
        SaveJson: input.saveJson,
        UpdatedAtUtc: input.updatedAtUtc,
      };
      saves.set(input.playerId, updated);
      return clone(updated);
    },
  };
}

function createServiceDependencies(repository = createMemoryRepository()) {
  return {
    repository,
    withTransaction: async (_pool, work) => work({}),
    clock: () => new Date('2026-10-21T02:00:00.000Z'),
  };
}

test('validateCloudSave accepts only schemaVersion 2 and returns only canonical save fields', async () => {
  const { validateCloudSave } = await loadCloudSaveDomain();
  const body = makeBody();
  body.unexpected = 'discard';
  body.state.unexpected = 'discard';
  const validated = validateCloudSave(body);

  assert.equal(validated.schemaVersion, 2);
  assert.equal(Object.hasOwn(validated, 'unexpected'), false);
  assert.equal(Object.hasOwn(validated.state, 'unexpected'), false);
  assert.equal(validated.state.schemaVersion, 2);
  assert.deepEqual(Object.keys(validated.state.player), [
    'level', 'xp', 'xpToNext', 'pendingLevelUps', 'currentHp', 'baseStats',
    'availableStatPoints', 'spentStatPoints', 'statResetCount',
  ]);
  assert.equal(Object.hasOwn(validated.state, 'gold'), true);
  assert.throws(() => validateCloudSave({ schemaVersion: 1, state: toLegacyV1Save(makeState()) }), /schemaVersion 2/i);
});

test('validateCloudSave rejects invalid stats, gear enums, inventory bounds and non-finite JSON numbers', async () => {
  const { validateCloudSave } = await loadCloudSaveDomain();
  const invalidStat = makeBody();
  invalidStat.state.player.baseStats.attack = Infinity;
  const invalidRarity = makeBody();
  invalidRarity.state.inventory.push({ ...invalidRarity.state.equipment.helmet, rarity: 'mythic' });
  const fullInventory = makeBody();
  fullInventory.state.inventory = Array.from({ length: 21 }, () => ({ ...fullInventory.state.equipment.helmet }));
  const nonFiniteUnknown = makeBody();
  nonFiniteUnknown.state.unexpected = Infinity;

  for (const body of [invalidStat, invalidRarity, fullInventory, nonFiniteUnknown]) {
    assert.throws(() => validateCloudSave(body), /invalid|finite|capacity/i);
  }
});

test('parseCloudSave migrates v1 rows and preserves revision and timestamp without modifying the row', async () => {
  const { parseCloudSave, validateCloudSave } = await loadCloudSaveDomain();
  const state = toLegacyV1Save(makeState());
  const row = {
    SchemaVersion: 1,
    Revision: 12n,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date('2026-10-21T02:00:00.000Z'),
  };
  const before = structuredClone(row);
  const envelope = parseCloudSave(row);

  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.revision, 12);
  assert.equal(envelope.updatedAtUtc, '2026-10-21T02:00:00.000Z');
  assert.equal(envelope.state.schemaVersion, 2);
  assert.equal(envelope.state.gold, 0);
  assert.equal(envelope.state.player.availableStatPoints, 2 * (state.player.level - 1));
  assert.deepEqual(row, before);
  assert.deepEqual(envelope, parseCloudSave(row));
  assert.throws(() => parseCloudSave({ SchemaVersion: 2, Revision: 0, SaveJson: '{}', UpdatedAtUtc: new Date() }));
  assert.throws(() => parseCloudSave({
    SchemaVersion: 1,
    Revision: 1,
    SaveJson: JSON.stringify(state).replace('"schemaVersion":1', '"schemaVersion":1,"unexpected":1e999'),
    UpdatedAtUtc: new Date(),
  }), /non-finite/i);
  assert.throws(() => parseCloudSave({
    SchemaVersion: 2,
    Revision: 1,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date(),
  }), /schema|version/i);
});

test('parseCloudSave validates v2 rows without re-migrating and rejects row-state version mismatch', async () => {
  const { parseCloudSave, validateCloudSave } = await loadCloudSaveDomain();
  const state = validateCloudSave(makeBody()).state;
  const envelope = parseCloudSave({
    SchemaVersion: 2,
    Revision: 5,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date('2026-10-21T02:00:00.000Z'),
  });

  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.revision, 5);
  assert.deepEqual(envelope.state, state);
  assert.throws(() => parseCloudSave({
    SchemaVersion: 1,
    Revision: 1,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date(),
  }), /schema|version/i);
});

test('cloud save creation, revision updates and stale writes return the current copy', async () => {
  const { getCurrent, putCurrent } = await loadCloudSaveService();
  const dependencies = createServiceDependencies();
  const pool = {};
  const missing = await getCurrent(pool, identityA, dependencies);
  assert.deepEqual(missing, { status: 404, code: 'save-not-found' });

  const created = await putCurrent(pool, identityA, makeBody(), { kind: 'create' }, dependencies);
  assert.equal(created.status, 201);
  assert.equal(created.envelope.schemaVersion, 2);
  assert.equal(dependencies.repository.saves.get('player-1').SchemaVersion, 2);
  assert.equal(created.envelope.revision, 1);
  assert.equal(created.envelope.updatedAtUtc, '2026-10-21T02:00:00.000Z');

  const state = makeState();
  state.materials += 1;
  const updated = await putCurrent(pool, identityA, makeBody(state), { kind: 'update', expectedRevision: 1 }, dependencies);
  assert.equal(updated.status, 200);
  assert.equal(updated.envelope.revision, 2);

  const stale = await putCurrent(pool, identityA, makeBody(), { kind: 'update', expectedRevision: 1 }, dependencies);
  assert.equal(stale.status, 409);
  assert.equal(stale.current.revision, 2);
  assert.equal(stale.current.state.materials, 1);

  const duplicateCreate = await putCurrent(pool, identityA, makeBody(), { kind: 'create' }, dependencies);
  assert.equal(duplicateCreate.status, 409);
  assert.equal(duplicateCreate.current.revision, 2);
});

test('v1 cloud save writes are rejected before creating or updating a row', async () => {
  const { putCurrent } = await loadCloudSaveService();
  const dependencies = createServiceDependencies();
  const legacyBody = { schemaVersion: 1, state: toLegacyV1Save(makeState()) };

  await assert.rejects(
    () => putCurrent({}, identityA, legacyBody, { kind: 'create' }, dependencies),
    /schemaVersion 2/i,
  );
  assert.equal(dependencies.repository.players.size, 0);
  assert.equal(dependencies.repository.saves.size, 0);
});

test('GET migrates a v1 cloud row without changing its revision or stored bytes', async () => {
  const { getCurrent } = await loadCloudSaveService();
  const repository = createMemoryRepository();
  const dependencies = createServiceDependencies(repository);
  const pool = {};
  const playerId = await repository.getOrCreatePlayerId(pool, identityA);
  const row = {
    SchemaVersion: 1,
    Revision: 4,
    SaveJson: JSON.stringify(toLegacyV1Save(makeState())),
    UpdatedAtUtc: new Date('2026-10-21T01:00:00.000Z'),
  };
  repository.saves.set(playerId, structuredClone(row));

  const first = await getCurrent(pool, identityA, dependencies);
  const second = await getCurrent(pool, identityA, dependencies);

  assert.equal(first.envelope.schemaVersion, 2);
  assert.equal(first.envelope.state.schemaVersion, 2);
  assert.equal(first.envelope.revision, 4);
  assert.equal(first.envelope.updatedAtUtc, '2026-10-21T01:00:00.000Z');
  assert.deepEqual(second, first);
  assert.deepEqual(repository.saves.get(playerId), row);
});

test('each Entra identity reads and writes only its own cloud save', async () => {
  const { getCurrent, putCurrent } = await loadCloudSaveService();
  const dependencies = createServiceDependencies();
  const pool = {};
  await putCurrent(pool, identityA, makeBody(), { kind: 'create' }, dependencies);

  assert.deepEqual(await getCurrent(pool, identityB, dependencies), { status: 404, code: 'save-not-found' });
  const createdForB = await putCurrent(pool, identityB, makeBody(), { kind: 'create' }, dependencies);
  assert.equal(createdForB.status, 201);
  assert.notEqual(
    dependencies.repository.players.get(`${identityA.tenantId}/${identityA.objectId}`),
    dependencies.repository.players.get(`${identityB.tenantId}/${identityB.objectId}`),
  );
});

test('simultaneous updates with the same revision allow exactly one writer', async () => {
  const { getCurrent, putCurrent } = await loadCloudSaveService();
  const dependencies = createServiceDependencies();
  const pool = {};
  await putCurrent(pool, identityA, makeBody(), { kind: 'create' }, dependencies);
  const first = makeState();
  first.materials = 11;
  const second = makeState();
  second.materials = 22;

  const results = await Promise.all([
    putCurrent(pool, identityA, makeBody(first), { kind: 'update', expectedRevision: 1 }, dependencies),
    putCurrent(pool, identityA, makeBody(second), { kind: 'update', expectedRevision: 1 }, dependencies),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const current = await getCurrent(pool, identityA, dependencies);
  assert.equal(current.envelope.revision, 2);
  assert.ok([11, 22].includes(current.envelope.state.materials));
});
