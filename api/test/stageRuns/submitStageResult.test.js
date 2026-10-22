import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStageDependencies, createStageRepository, identityA, ISSUED_AT, makeClearInputs,
  PLAYER_ID, RUN_ID, strongSnapshot,
} from '../../test-support/stageRuns.js';

async function loadStageRunService() {
  try {
    return await import('../../src/services/stageRunService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected stage-run service module: ${error.message}`);
    throw error;
  }
}

async function loadRankingDomain() {
  try {
    return await import('../../src/domain/stageRank.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected stage-rank domain module: ${error.message}`);
    throw error;
  }
}

function seedIssuedTicket(repository, { snapshot = strongSnapshot, stage = 1, expiresAtUtc = new Date(ISSUED_AT.getTime() + 30 * 60 * 1000) } = {}) {
  repository.tickets.set(RUN_ID, {
    RunId: RUN_ID,
    PlayerId: PLAYER_ID,
    Chapter: 1,
    Stage: stage,
    Seed: 123456,
    SimulatorVersion: 2,
    BalanceVersion: 2,
    PlayerSnapshotJson: JSON.stringify(snapshot),
    IssuedAtUtc: ISSUED_AT,
    ExpiresAtUtc: expiresAtUtc,
    Status: 'issued',
    CompletedAtUtc: null,
    InputJson: null,
    Outcome: null,
  });
}

test('submitStageResult replays clear input, records only server elapsed time and publishes a changed best', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const dependencies = createStageDependencies(repository, {
    clock: () => new Date('2026-10-21T02:02:00.000Z'),
  });
  const { inputs, replay } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 2,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const { submitStageResult } = await loadStageRunService();
  const result = await submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);

  assert.equal(replay.outcome, 'clear');
  assert.equal(result.status, 200);
  assert.equal(result.outcome, 'clear');
  assert.equal(result.clearTimeMs, 120000);
  assert.equal(result.bestChanged, true);
  assert.equal(repository.bests.get(PLAYER_ID).RunId, RUN_ID);
  assert.equal(repository.calls.published.length, 1);
  assert.equal(repository.calls.published[0].chapter, 1);
});

test('a top-board publish failure does not suppress the player rank event', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const playerEvents = [];
  const dependencies = createStageDependencies(repository, {
    publishRankingChanged:async () => { throw new Error('group publish unavailable'); },
    publishPlayerRankChanged:async (event) => playerEvents.push(event),
  });
  const { inputs } = makeClearInputs({
    runId:RUN_ID, seed:123456, chapter:1, stage:1, simulatorVersion:2,
    balanceVersion:2, issuedAtUtc:ISSUED_AT.toISOString(),
  });
  const { submitStageResult } = await loadStageRunService();

  const result = await submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);

  assert.equal(result.status, 200);
  assert.equal(playerEvents.length, 1);
  assert.equal(playerEvents[0].board, 'stage');
  assert.equal(playerEvents[0].identity, identityA);
});

test('submitStageResult rejects non-clear, too-fast, expired, foreign and changed-payload replays', async () => {
  const { submitStageResult } = await loadStageRunService();
  const incompleteRepo = createStageRepository();
  seedIssuedTicket(incompleteRepo);
  const incomplete = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), createStageDependencies(incompleteRepo));
  assert.equal(incomplete.status, 422);
  assert.equal(incomplete.code, 'run-not-cleared');
  assert.equal(incompleteRepo.bests.size, 0);

  const tooFastRepo = createStageRepository();
  seedIssuedTicket(tooFastRepo);
  const clearTrace = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 2,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const tooFast = await submitStageResult(
    {}, identityA, RUN_ID, { inputs: clearTrace.inputs },
    new Date(ISSUED_AT.getTime() + 1000), createStageDependencies(tooFastRepo),
  );
  assert.equal(tooFast.status, 422);
  assert.equal(tooFast.code, 'run-too-fast');
  assert.equal(tooFastRepo.bests.size, 0);

  const expiredRepo = createStageRepository();
  seedIssuedTicket(expiredRepo, { expiresAtUtc: new Date('2026-10-21T02:01:00.000Z') });
  const expired = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(expiredRepo));
  assert.equal(expired.status, 410);
  assert.equal(expired.code, 'run-expired');

  const foreign = await submitStageResult({}, { ...identityA, objectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(expiredRepo));
  assert.equal(foreign.status, 404);
});

test('identical completed results are idempotent and different payload reuse conflicts', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const { inputs } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 2,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const dependencies = createStageDependencies(repository, { clock: () => new Date('2026-10-21T02:02:00.000Z') });
  const { submitStageResult } = await loadStageRunService();
  const first = await submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);
  const retry = await submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:03:00.000Z'), dependencies);
  const changed = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:03:00.000Z'), dependencies);

  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.clearTimeMs, first.clearTimeMs);
  assert.equal(repository.calls.completeRun.length, 1);
  assert.equal(repository.calls.published.length, 1);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'run-already-completed');
});

test('personal best changes only for farther progress or a faster time on the same stage', async () => {
  const repository = createStageRepository();
  const firstTicket = RUN_ID;
  seedIssuedTicket(repository, { stage: 1 });
  const ticket2 = 'cccccccc-3333-4333-8333-333333333333';
  repository.tickets.set(ticket2, {
    ...structuredClone(repository.tickets.get(firstTicket)),
    RunId: ticket2,
    IssuedAtUtc: new Date('2026-10-21T02:01:00.000Z'),
  });
  const ticket3 = 'dddddddd-4444-4444-8444-444444444444';
  repository.tickets.set(ticket3, {
    ...structuredClone(repository.tickets.get(firstTicket)),
    RunId: ticket3,
    Stage: 2,
    IssuedAtUtc: new Date('2026-10-21T02:02:00.000Z'),
  });
  const dependencies = createStageDependencies(repository);
  const { submitStageResult } = await loadStageRunService();
  const trace1 = makeClearInputs({ runId: firstTicket, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 2, balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString() });
  const trace2 = makeClearInputs({ runId: ticket2, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 2, balanceVersion: 2, issuedAtUtc: '2026-10-21T02:01:00.000Z' });
  const trace3 = makeClearInputs({ runId: ticket3, seed: 123456, chapter: 1, stage: 2, simulatorVersion: 2, balanceVersion: 2, issuedAtUtc: '2026-10-21T02:02:00.000Z' });

  const first = await submitStageResult({}, identityA, firstTicket, { inputs: trace1.inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);
  const slower = await submitStageResult({}, identityA, ticket2, { inputs: trace2.inputs }, new Date('2026-10-21T02:04:00.000Z'), dependencies);
  const farther = await submitStageResult({}, identityA, ticket3, { inputs: trace3.inputs }, new Date('2026-10-21T02:05:00.000Z'), dependencies);

  assert.equal(first.bestChanged, true);
  assert.equal(slower.bestChanged, false);
  assert.equal(farther.bestChanged, true);
  assert.equal(repository.bests.get(PLAYER_ID).Stage, 2);
  assert.equal(repository.bests.get(PLAYER_ID).RunId, ticket3);
  assert.equal(repository.calls.published.length, 2);
});

test('validateStageInputs accepts zero to two stat keys and rejects legacy or invalid allocations', async () => {
  const { validateStageInputs } = await loadRankingDomain();
  for (const value of [[], ['attack'], ['attack', 'defense']]) {
    assert.deepEqual(validateStageInputs({ inputs: [{ tick: 0, kind: 'levelUp', value }] }).inputs, [
      { tick: 0, kind: 'levelUp', value },
    ]);
  }
  for (const value of ['attack', ['invalid'], ['attack', 'defense', 'maxHp']]) {
    assert.throws(
      () => validateStageInputs({ inputs: [{ tick: 0, kind: 'levelUp', value }] }),
      (error) => error.code === 'invalid-input-log',
    );
  }
});

test('an issued v1 ticket is expired and rejected without changing the existing best', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const ticket = repository.tickets.get(RUN_ID);
  ticket.SimulatorVersion = 1;
  ticket.BalanceVersion = 1;
  const previousBest = {
    PlayerId: PLAYER_ID,
    Chapter: 1,
    Stage: 4,
    ClearTimeMs: 90_000,
    RunId: 'cccccccc-3333-4333-8333-333333333333',
  };
  repository.bests.set(PLAYER_ID, structuredClone(previousBest));
  const { submitStageResult } = await loadStageRunService();

  const result = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(repository));

  assert.equal(result.status, 409);
  assert.equal(result.code, 'unsupported-simulator-version');
  assert.equal(repository.tickets.get(RUN_ID).Status, 'expired');
  assert.equal(repository.calls.expireTicket.length, 1);
  assert.equal(repository.calls.completeRun.length, 0);
  assert.deepEqual(repository.bests.get(PLAYER_ID), previousBest);
  assert.equal(repository.calls.published.length, 0);
});

test('a completed v1 ticket remains idempotent and leaves its historical best unchanged', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const ticket = repository.tickets.get(RUN_ID);
  ticket.SimulatorVersion = 1;
  ticket.BalanceVersion = 1;
  ticket.Status = 'completed';
  ticket.InputJson = JSON.stringify([]);
  ticket.Outcome = 'clear';
  ticket.CompletedAtUtc = new Date('2026-10-21T02:02:00.000Z');
  const previousBest = {
    PlayerId: PLAYER_ID,
    Chapter: 1,
    Stage: 3,
    ClearTimeMs: 90_000,
    RunId: 'cccccccc-3333-4333-8333-333333333333',
  };
  repository.bests.set(PLAYER_ID, structuredClone(previousBest));
  const { submitStageResult } = await loadStageRunService();

  const result = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:03:00.000Z'), createStageDependencies(repository));

  assert.equal(result.status, 200);
  assert.equal(result.outcome, 'clear');
  assert.equal(result.bestChanged, false);
  assert.equal(repository.calls.completeRun.length, 0);
  assert.deepEqual(repository.bests.get(PLAYER_ID), previousBest);
});

test('getStageTopFive continues to expose historical stage best rows', async () => {
  const repository = createStageRepository();
  const history = [{
    DisplayName: 'Legacy Player',
    Chapter: 1,
    Stage: 4,
    ClearTimeMs: 90_000,
  }];
  repository.getTopFive = async () => structuredClone(history);
  const { getStageTopFive } = await loadStageRunService();

  assert.deepEqual(await getStageTopFive({}, createStageDependencies(repository)), [{
    displayName: 'Legacy Player',
    chapter: 1,
    stage: 4,
    clearTimeMs: 90_000,
    rank: 1,
  }]);
  assert.deepEqual(await repository.getTopFive(), history);
});

test('compareStageRank orders farther progress, faster times, then stable player ids', async () => {
  const { compareStageRank } = await loadRankingDomain();
  const rows = [
    { chapter: 2, stage: 1, clearTimeMs: 5000, playerId: 'b' },
    { chapter: 1, stage: 10, clearTimeMs: 1000, playerId: 'a' },
    { chapter: 2, stage: 1, clearTimeMs: 4000, playerId: 'z' },
    { chapter: 2, stage: 1, clearTimeMs: 4000, playerId: 'a' },
  ].sort(compareStageRank);
  assert.deepEqual(rows.map((row) => row.playerId), ['a', 'z', 'b', 'a']);
});
