import assert from 'node:assert/strict';
import { createInitialState } from '../../../src/game/domain/gear.js';
import { toLegacyV1Save } from '../../test-support/saveStateFixtures.js';
import { test } from 'node:test';

let itemId = 0;
const makeState = () => createInitialState(() => `starter-${++itemId}`);
const makeBody = (state = makeState()) => ({ schemaVersion: 2, state });
const defaultProfile = () => ({
  level: 1, xp: 0, xpToNext: 100, pendingLevelUps: 0, gold: 0, materials: 0, inventory: [],
  chapter: 1, currentStage: 1, unlockedChapter: 1, unlockedStage: 1, clearedStageIds: [],
});
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

function profileRow(playerId, profile) {
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
    UpdatedAtUtc: new Date('2026-10-21T02:00:00.000Z'),
  };
}

function createMemoryRepository() {
  const players = new Map();
  const saves = new Map();
  const profiles = new Map();
  let playerNumber = 0;
  const identityKey = (identity) => `${identity.tenantId}/${identity.objectId}`;
  return {
    players,
    saves,
    profiles,
    async findPlayerIdByIdentity(_pool, identity) {
      return players.get(identityKey(identity)) ?? null;
    },
    async getOrCreatePlayerId(_pool, identity) {
      const key = identityKey(identity);
      if (!players.has(key)) players.set(key, `player-${++playerNumber}`);
      return players.get(key);
    },
    async getByPlayerId(_pool, playerId) {
      const row = saves.get(playerId);
      return row ? { ...clone(row), RewardProfile: clone(profiles.get(playerId) ?? null) } : null;
    },
    async getSaveForUpdate(_transaction, playerId) {
      return clone(saves.get(playerId) ?? null);
    },
    async getRewardProfileByPlayerId(_connection, playerId) {
      return clone(profiles.get(playerId) ?? null);
    },
    async createRewardProfile(_transaction, playerId, profile) {
      if (profiles.has(playerId)) throw Object.assign(new Error('duplicate profile'), { number: 2627 });
      const row = profileRow(playerId, profile);
      profiles.set(playerId, row);
      return clone(row);
    },
    async updateRewardProfile(_transaction, { playerId, profile }) {
      if (!profiles.has(playerId)) return null;
      const row = profileRow(playerId, profile);
      profiles.set(playerId, row);
      return clone(row);
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
    withTransaction: async (_pool, work) => {
      const saves = new Map([...repository.saves].map(([key, value]) => [key, clone(value)]));
      const profiles = new Map([...repository.profiles].map(([key, value]) => [key, clone(value)]));
      try {
        return await work({});
      } catch (error) {
        repository.saves.clear();
        repository.profiles.clear();
        for (const [key, value] of saves) repository.saves.set(key, value);
        for (const [key, value] of profiles) repository.profiles.set(key, value);
        throw error;
      }
    },
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
  const envelope = parseCloudSave(row, defaultProfile());

  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.revision, 12);
  assert.equal(envelope.updatedAtUtc, '2026-10-21T02:00:00.000Z');
  assert.equal(envelope.state.schemaVersion, 2);
  assert.equal(envelope.state.gold, 0);
  assert.equal(envelope.state.player.availableStatPoints, 2 * (state.player.level - 1));
  assert.deepEqual(row, before);
  assert.deepEqual(envelope, parseCloudSave(row, defaultProfile()));
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
  }, defaultProfile());

  assert.equal(envelope.schemaVersion, 2);
  assert.equal(envelope.revision, 5);
  assert.deepEqual(envelope.state, state);
  assert.throws(() => parseCloudSave({
    SchemaVersion: 1,
    Revision: 1,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date(),
  }), /schema|version/i);
  assert.throws(() => parseCloudSave({
    SchemaVersion: 2,
    Revision: 1,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date(),
  }), /profile|missing/i);
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
  assert.equal(dependencies.repository.profiles.has('player-1'), true);

  const state = makeState();
  state.materials += 1;
  const updated = await putCurrent(pool, identityA, makeBody(state), { kind: 'update', expectedRevision: 1 }, dependencies);
  assert.equal(updated.status, 200);
  assert.equal(updated.envelope.revision, 2);

  const profileBeforeStaleWrite = clone(dependencies.repository.profiles.get('player-1'));
  const stale = await putCurrent(pool, identityA, makeBody(), { kind: 'update', expectedRevision: 1 }, dependencies);
  assert.equal(stale.status, 409);
  assert.equal(stale.current.revision, 2);
  assert.equal(stale.current.state.materials, 0);
  assert.deepEqual(dependencies.repository.profiles.get('player-1'), profileBeforeStaleWrite);
  assert.equal(dependencies.repository.saves.get('player-1').Revision, 2);

  const duplicateCreate = await putCurrent(pool, identityA, makeBody(), { kind: 'create' }, dependencies);
  assert.equal(duplicateCreate.status, 409);
  assert.equal(duplicateCreate.current.revision, 2);
});

test('PUT ignores reward and progression fields while preserving client-owned state', async () => {
  const { getCurrent, putCurrent } = await loadCloudSaveService();
  const dependencies = createServiceDependencies();
  const pool = {};
  const body = makeBody();
  body.state.player.level = 80;
  body.state.player.xp = 50000;
  body.state.player.xpToNext = 1;
  body.state.player.pendingLevelUps = 12;
  body.state.player.currentHp = 37;
  body.state.player.baseStats.attack = 77;
  body.state.gold = 900000;
  body.state.materials = 900000;
  body.state.progression = {
    chapter: 8, currentStage: 9, unlockedChapter: 8, unlockedStage: 9, clearedStageIds: ['1-1', '1-2'],
  };
  const created = await putCurrent(pool, identityA, body, { kind: 'create' }, dependencies);

  assert.equal(created.status, 201);
  assert.equal(created.envelope.state.player.level, 1);
  assert.equal(created.envelope.state.player.xp, 0);
  assert.equal(created.envelope.state.player.xpToNext, 100);
  assert.equal(created.envelope.state.player.pendingLevelUps, 0);
  assert.equal(created.envelope.state.gold, 0);
  assert.equal(created.envelope.state.materials, 0);
  assert.deepEqual(created.envelope.state.progression.clearedStageIds, []);
  assert.equal(created.envelope.state.player.currentHp, 37);
  assert.equal(created.envelope.state.player.baseStats.attack, 77);
  assert.equal(JSON.parse(dependencies.repository.saves.get('player-1').SaveJson).player.xp, 0);

  const update = makeBody();
  update.state.player.level = 99;
  update.state.player.currentHp = 22;
  update.state.player.baseStats.attack = 88;
  update.state.gold = 888;
  update.state.progression.currentStage = 10;
  const saved = await putCurrent(pool, identityA, update, { kind: 'update', expectedRevision: 1 }, dependencies);
  const read = await getCurrent(pool, identityA, dependencies);
  assert.equal(saved.status, 200);
  assert.equal(read.envelope.state.player.level, 1);
  assert.equal(read.envelope.state.gold, 0);
  assert.equal(read.envelope.state.progression.currentStage, 1);
  assert.equal(read.envelope.state.player.currentHp, 22);
  assert.equal(read.envelope.state.player.baseStats.attack, 88);
});

test('initial profile write failure rolls back the new CloudSave row', async () => {
  const { putCurrent } = await loadCloudSaveService();
  const repository = createMemoryRepository();
  const dependencies = createServiceDependencies(repository);
  repository.createRewardProfile = async () => { throw new Error('profile insert failed'); };

  await assert.rejects(() => putCurrent({}, identityA, makeBody(), { kind: 'create' }, dependencies), /profile insert failed/);
  assert.equal(repository.saves.size, 0);
  assert.equal(repository.profiles.size, 0);
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
  repository.profiles.set(playerId, profileRow(playerId, defaultProfile()));

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
  first.player.currentHp = 11;
  const second = makeState();
  second.player.currentHp = 22;

  const results = await Promise.all([
    putCurrent(pool, identityA, makeBody(first), { kind: 'update', expectedRevision: 1 }, dependencies),
    putCurrent(pool, identityA, makeBody(second), { kind: 'update', expectedRevision: 1 }, dependencies),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const current = await getCurrent(pool, identityA, dependencies);
  assert.equal(current.envelope.revision, 2);
  assert.ok([11, 22].includes(current.envelope.state.player.currentHp));
});
