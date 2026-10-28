import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStageDependencies, createStageRepository, identityA, PLAYER_ID, RUN_ID,
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
  const saveRow = repository.saves.get(PLAYER_ID);
  const save = JSON.parse(saveRow.SaveJson);
  save.player.level = 80;
  save.player.xp = 50000;
  save.player.xpToNext = 1;
  save.player.availableStatPoints = 3;
  save.player.spentStatPoints = 1;
  repository.saves.set(PLAYER_ID, {
    ...saveRow,
    SaveJson: JSON.stringify(save),
    RewardProfile: { ...saveRow.RewardProfile, Level: 3, Xp: 12, PendingLevelUps: 1 },
  });
  const dependencies = createStageDependencies(repository);
  const { startStageRun } = await loadStageRunService();
  const result = await startStageRun({}, identityA, {
    chapter: 1, stage: 1, expectedSaveRevision: 7,
  }, dependencies);

  assert.equal(result.status, 201);
  assert.equal(result.ticket.runId, 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(result.ticket.seed, 123456);
  assert.equal(result.ticket.simulatorVersion, 5);
  assert.equal(result.ticket.balanceVersion, 2);
  assert.equal(result.ticket.issuedAtUtc, '2026-10-21T02:00:00.000Z');
  assert.equal(result.ticket.expiresAtUtc, '2026-10-21T02:30:00.000Z');
  assert.ok(result.ticket.playerSnapshot.maxHp > 0);
  assert.equal(result.ticket.playerSnapshot.availableStatPoints, 3);
  assert.equal(result.ticket.playerSnapshot.spentStatPoints, 1);
  assert.deepEqual({
    level: result.ticket.playerSnapshot.level,
    xp: result.ticket.playerSnapshot.xp,
    xpToNext: result.ticket.playerSnapshot.xpToNext,
    pendingLevelUps: result.ticket.playerSnapshot.pendingLevelUps,
    replayXpMultiplier: result.ticket.playerSnapshot.replayXpMultiplier,
  }, { level: 3, xp: 12, xpToNext: 100, pendingLevelUps: 1, replayXpMultiplier: 1 });
  assert.equal(repository.calls.createTicket[0].playerId, PLAYER_ID);
  assert.equal(repository.calls.createTicket[0].expectedSaveRevision, 7);
  assert.equal(repository.calls.createTicket[0].simulatorVersion, 5);
  assert.equal(repository.calls.createTicket[0].balanceVersion, 2);
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

test('startStageRun expires an active v3 ticket before issuing a v5 ticket', async () => {
  const previousRunId = 'cccccccc-3333-4333-8333-333333333333';
  const repository = createStageRepository({ existingTicket: {
    RunId: previousRunId,
    PlayerId: PLAYER_ID,
    Chapter: 1,
    Stage: 1,
    Seed: 123456,
    SimulatorVersion: 3,
    BalanceVersion: 2,
    PlayerSnapshotJson: JSON.stringify({ maxHp: 100, currentHp: 100, attack: 10, defense: 5, critChance: 0, critMultiplier: 2, moveSpeed: 200, effects: [] }),
    IssuedAtUtc: new Date('2026-10-21T01:59:00.000Z'),
    ExpiresAtUtc: new Date('2026-10-21T02:30:00.000Z'),
    Status: 'issued',
    CompletedAtUtc: null,
    InputJson: null,
    Outcome: null,
  } });
  const { startStageRun } = await loadStageRunService();

  const result = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, createStageDependencies(repository));

  assert.equal(result.status, 201);
  assert.equal(repository.tickets.get(previousRunId).Status, 'expired');
  assert.equal(repository.tickets.get(RUN_ID).SimulatorVersion, 5);
  assert.equal(repository.tickets.get(RUN_ID).BalanceVersion, 2);
});

test('startStageRun rejects stale revisions, locked stages and invalid requests before inserting a ticket', async () => {
  const { startStageRun } = await loadStageRunService();
  const staleRepository = createStageRepository({ revision: 8 });
  const stale = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, createStageDependencies(staleRepository));
  assert.equal(stale.status, 409);
  assert.equal(stale.currentRevision, 8);

  const lockedRepository = createStageRepository();
  const spoofedState = JSON.parse(lockedRepository.saves.get(PLAYER_ID).SaveJson);
  spoofedState.progression.unlockedChapter = 99;
  spoofedState.progression.unlockedStage = 10;
  lockedRepository.saves.set(PLAYER_ID, {
    ...lockedRepository.saves.get(PLAYER_ID), SaveJson: JSON.stringify(spoofedState),
  });
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
  const row = repository.saves.get(PLAYER_ID);
  repository.saves.set(PLAYER_ID, {
    ...row,
    SaveJson: JSON.stringify(state),
    RewardProfile: { ...row.RewardProfile, ClearedStageIdsJson: '["1-2"]' },
  });
  const dependencies = createStageDependencies(repository);
  const cleared = await startStageRun({}, identityA, { chapter: 1, stage: 2, expectedSaveRevision: 7 }, dependencies);
  assert.equal(cleared.status, 201);
  assert.equal(cleared.ticket.playerSnapshot.replayXpMultiplier, 0.3);

  const active = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, dependencies);
  assert.equal(active.status, 409);
  assert.equal(active.code, 'active-run-exists');
});


test('startStageRun preserves an unexpired v4 run while issuing v5 for new runs', async () => {
  const previousRunId = 'cccccccc-3333-4333-8333-333333333333';
  const repository = createStageRepository({ existingTicket: {
    RunId: previousRunId, PlayerId: PLAYER_ID, SimulatorVersion: 4, BalanceVersion: 2,
    IssuedAtUtc: new Date('2026-10-21T01:59:00.000Z'), ExpiresAtUtc: new Date('2026-10-21T02:30:00.000Z'), Status: 'issued',
  } });
  const { startStageRun } = await loadStageRunService();
  const result = await startStageRun({}, identityA, { chapter: 1, stage: 1, expectedSaveRevision: 7 }, createStageDependencies(repository));
  assert.equal(result.code, 'active-run-exists');
  assert.equal(repository.tickets.get(previousRunId).Status, 'issued');
});
