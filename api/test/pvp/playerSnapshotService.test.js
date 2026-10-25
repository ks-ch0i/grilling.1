import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPvpDependencies, createPvpRepository, identityA, PLAYER_A,
} from '../../test-support/pvp.js';
import { toLegacyV1Save } from '../../test-support/saveStateFixtures.js';

async function loadSnapshotService() {
  try {
    return await import('../../src/services/playerSnapshotService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected player snapshot service: ${error.message}`);
    throw error;
  }
}

test('publishSnapshot derives the public snapshot from the matching cloud save revision', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null } });
  const dependencies = createPvpDependencies(repository);
  const { publishSnapshot } = await loadSnapshotService();
  const result = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, dependencies);

  assert.equal(result.status, 200);
  assert.equal(result.changed, true);
  assert.equal(result.snapshot.revision, 1);
  assert.equal(result.snapshot.character.level, 1);
  assert.ok(result.snapshot.combat.maxHp > 0);
  assert.equal(repository.snapshotRows.get(PLAYER_A).BalanceVersion, 2);
  assert.equal(repository.calls.snapshotWrites[0].balanceVersion, 2);
  assert.equal(Object.hasOwn(result.snapshot, 'playerId'), false);
  assert.equal(repository.calls.published.length, 1);
});

test('publishSnapshot uses the server reward level and keeps client-owned combat stats', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null } });
  const row = repository.saves.get(PLAYER_A);
  const state = JSON.parse(row.SaveJson);
  state.player.level = 90;
  state.player.baseStats.attack = 77;
  repository.saves.set(PLAYER_A, {
    ...row,
    SaveJson: JSON.stringify(state),
    RewardProfile: { ...row.RewardProfile, Level: 5 },
  });
  const { publishSnapshot } = await loadSnapshotService();

  const result = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, createPvpDependencies(repository));

  assert.equal(result.status, 200);
  assert.equal(result.snapshot.character.level, 5);
  assert.equal(result.snapshot.character.baseStats.attack, 77);
});

test('publishing unchanged combat content upgrades an existing v1 snapshot to balance version 2', async () => {
  const repository = createPvpRepository();
  repository.snapshotRows.get(PLAYER_A).BalanceVersion = 1;
  const { publishSnapshot } = await loadSnapshotService();

  const result = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, createPvpDependencies(repository));

  assert.equal(result.status, 200);
  assert.equal(result.changed, true);
  assert.equal(result.snapshot.revision, 2);
  assert.equal(repository.snapshotRows.get(PLAYER_A).BalanceVersion, 2);
  assert.equal(repository.calls.snapshotWrites[0].balanceVersion, 2);
});

test('publishSnapshot derives its snapshot from a legacy v1 cloud save', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null } });
  const row = repository.saves.get(PLAYER_A);
  const legacyState = toLegacyV1Save(JSON.parse(row.SaveJson));
  legacyState.player.baseStats.attack = 9999;
  repository.saves.set(PLAYER_A, {
    ...row,
    SchemaVersion: 1,
    SaveJson: JSON.stringify(legacyState),
  });
  const { publishSnapshot } = await loadSnapshotService();
  const result = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, createPvpDependencies(repository));

  assert.equal(result.status, 200);
  assert.equal(result.snapshot.character.level, 1);
  assert.notEqual(result.snapshot.character.baseStats.attack, 9999);
  assert.ok(result.snapshot.combat.maxHp > 0);
  assert.equal(repository.saves.get(PLAYER_A).SchemaVersion, 1);
});

test('snapshot revision changes only when canonical character, equipment or combat changes', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null } });
  const dependencies = createPvpDependencies(repository);
  const { publishSnapshot } = await loadSnapshotService();
  const first = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, dependencies);
  const same = await publishSnapshot({}, identityA, { expectedSaveRevision: 7 }, dependencies);
  assert.equal(first.snapshot.revision, 1);
  assert.equal(same.snapshot.revision, 1);
  assert.equal(same.changed, false);
  assert.equal(repository.calls.published.length, 1);

  const save = JSON.parse(repository.saves.get(PLAYER_A).SaveJson);
  save.player.xp += 1;
  repository.saves.set(PLAYER_A, { ...repository.saves.get(PLAYER_A), Revision: 8, SaveJson: JSON.stringify(save) });
  const xpOnly = await publishSnapshot({}, identityA, { expectedSaveRevision: 8 }, dependencies);
  assert.equal(xpOnly.snapshot.revision, 1);
  assert.equal(xpOnly.changed, false);

  save.equipment.spear.stats.attack += 1;
  repository.saves.set(PLAYER_A, { ...repository.saves.get(PLAYER_A), Revision: 9, SaveJson: JSON.stringify(save) });
  const changed = await publishSnapshot({}, identityA, { expectedSaveRevision: 9 }, dependencies);
  assert.equal(changed.snapshot.revision, 2);
  assert.equal(changed.changed, true);
});

test('publishSnapshot rejects stale revisions and unsupported request fields', async () => {
  const repository = createPvpRepository();
  const { publishSnapshot } = await loadSnapshotService();
  const stale = await publishSnapshot({}, identityA, { expectedSaveRevision: 6 }, createPvpDependencies(repository));
  const spoofed = await publishSnapshot({}, identityA, { expectedSaveRevision: 7, combat: { attack: 999999 } }, createPvpDependencies(repository));
  assert.equal(stale.status, 409);
  assert.equal(stale.currentRevision, 7);
  assert.equal(spoofed.status, 400);
});
