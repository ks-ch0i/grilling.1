import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStageDependencies, createStageRepository, identityA, PLAYER_ID,
} from '../../test-support/stageRuns.js';
import { toLegacyV1Save } from '../../test-support/saveStateFixtures.js';

async function loadStageRunService() {
  try {
    return await import('../../src/services/stageRunService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected stage-run service module: ${error.message}`);
    throw error;
  }
}

test('startStageRun issues an immutable seeded ticket from the matching cloud revision', async () => {
  const repository = createStageRepository();
  const dependencies = createStageDependencies(repository);
  const { startStageRun } = await loadStageRunService();
  const result = await startStageRun({}, identityA, {
    chapter: 1, stage: 1, expectedSaveRevision: 7,
  }, dependencies);

  assert.equal(result.status, 201);
  assert.equal(result.ticket.runId, 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(result.ticket.seed, 123456);
  assert.equal(result.ticket.simulatorVersion, 1);
  assert.equal(result.ticket.balanceVersion, 1);
  assert.equal(result.ticket.issuedAtUtc, '2026-10-21T02:00:00.000Z');
  assert.equal(result.ticket.expiresAtUtc, '2026-10-21T02:30:00.000Z');
  assert.ok(result.ticket.playerSnapshot.maxHp > 0);
  assert.deepEqual({
    level: result.ticket.playerSnapshot.level,
    xp: result.ticket.playerSnapshot.xp,
    xpToNext: result.ticket.playerSnapshot.xpToNext,
    pendingLevelUps: result.ticket.playerSnapshot.pendingLevelUps,
    replayXpMultiplier: result.ticket.playerSnapshot.replayXpMultiplier,
  }, { level: 1, xp: 0, xpToNext: 100, pendingLevelUps: 0, replayXpMultiplier: 1 });
  assert.equal(repository.calls.createTicket[0].playerId, PLAYER_ID);
  assert.equal(repository.calls.createTicket[0].expectedSaveRevision, 7);
});

test('startStageRun derives its snapshot from a legacy v1 cloud save', async () => {
  const repository = createStageRepository();
  const row = repository.saves.get(PLAYER_ID);
  const legacyState = toLegacyV1Save(JSON.parse(row.SaveJson));
  legacyState.player.baseStats.attack = 9999;
  repository.saves.set(PLAYER_ID, {
    ...row,
    SchemaVersion: 1,
    SaveJson: JSON.stringify(legacyState),
  });
  const { startStageRun } = await loadStageRunService();
  const result = await startStageRun({}, identityA, {
    chapter: 1, stage: 1, expectedSaveRevision: 7,
  }, createStageDependencies(repository));

  assert.equal(result.status, 201);
  assert.equal(result.ticket.playerSnapshot.level, 1);
  assert.ok(result.ticket.playerSnapshot.attack < 9999);
  assert.ok(result.ticket.playerSnapshot.maxHp > 0);
  assert.equal(repository.saves.get(PLAYER_ID).SchemaVersion, 1);
});

test('startStageRun rejects stale revisions, locked stages and invalid requests before inserting a ticket', async () => {
  const { startStageRun } = await loadStageRunService();
  const staleRepository = createStageRepository({ revision: 8 });
  const stale = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, createStageDependencies(staleRepository));
  assert.equal(stale.status, 409);
  assert.equal(stale.currentRevision, 8);

  const lockedRepository = createStageRepository();
  const locked = await startStageRun({}, identityA, { chapter: 2, stage: 1, expectedSaveRevision: 7 }, createStageDependencies(lockedRepository));
  assert.equal(locked.status, 403);
  assert.equal(locked.code, 'stage-locked');

  const invalid = await startStageRun({}, identityA, { chapter: 1, stage: 11, expectedSaveRevision: 7 }, createStageDependencies(lockedRepository));
  assert.equal(invalid.status, 400);
  assert.equal(lockedRepository.calls.createTicket.length, 0);
});

test('startStageRun allows a previously cleared stage and rejects an existing active ticket', async () => {
  const { startStageRun } = await loadStageRunService();
  const repository = createStageRepository();
  const state = JSON.parse(repository.saves.get(PLAYER_ID).SaveJson);
  state.progression.clearedStageIds = ['1-2'];
  repository.saves.set(PLAYER_ID, { ...repository.saves.get(PLAYER_ID), SaveJson: JSON.stringify(state) });
  const dependencies = createStageDependencies(repository);
  const cleared = await startStageRun({}, identityA, { chapter: 1, stage: 2, expectedSaveRevision: 7 }, dependencies);
  assert.equal(cleared.status, 201);
  assert.equal(cleared.ticket.playerSnapshot.replayXpMultiplier, 0.3);

  const active = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, dependencies);
  assert.equal(active.status, 409);
  assert.equal(active.code, 'active-run-exists');
});
