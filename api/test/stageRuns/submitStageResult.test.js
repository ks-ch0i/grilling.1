import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStageDependencies, createStageRepository, identityA, ISSUED_AT, makeClearInputs, makeDeathInputs,
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
    SimulatorVersion: 4,
    BalanceVersion: 2,
    PlayerSnapshotJson: JSON.stringify(snapshot),
    IssuedAtUtc: ISSUED_AT,
    ExpiresAtUtc: expiresAtUtc,
    Status: 'issued',
    CompletedAtUtc: null,
    InputJson: null,
    Outcome: null,
    RewardJson: null,
  });
}

test('submitStageResult replays clear input, records only server elapsed time and publishes a changed best', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const dependencies = createStageDependencies(repository, {
    clock: () => new Date('2026-10-21T02:02:00.000Z'),
  });
  const { inputs, replay } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const { submitStageResult } = await loadStageRunService();
  const result = await submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);

  assert.equal(replay.outcome, 'clear');
  assert.equal(result.status, 200);
  assert.equal(result.outcome, 'clear');
  assert.equal(result.clearTimeMs, 120000);
  assert.equal(result.bestChanged, true);
  assert.equal(result.verified, true);
  assert.equal(result.revision, 8);
  assert.equal(result.state.progression.unlockedStage, 2);
  assert.equal(result.state.progression.clearedStageIds.includes('1-1'), true);
  assert.equal(result.rewards.outcome, 'clear');
  assert.ok(result.rewards.goldGranted > 0);
  assert.equal(repository.bests.get(PLAYER_ID).RunId, RUN_ID);
  assert.equal(JSON.parse(repository.saves.get(PLAYER_ID).RewardProfile.ClearedStageIdsJson).includes('1-1'), true);
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
    runId:RUN_ID, seed:123456, chapter:1, stage:1, simulatorVersion:4,
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
  // Chasing enemies reach an idle player; require a level-up after the first
  // kill so an empty log remains incomplete rather than passively clearing.
  seedIssuedTicket(incompleteRepo, { snapshot:{ ...strongSnapshot, xp:99 } });
  const incomplete = await submitStageResult({}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), createStageDependencies(incompleteRepo));
  assert.equal(incomplete.status, 422);
  assert.equal(incomplete.code, 'run-not-cleared');
  assert.equal(incompleteRepo.bests.size, 0);

  const tooFastRepo = createStageRepository();
  seedIssuedTicket(tooFastRepo);
  const clearTrace = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
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
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
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
  assert.equal(retry.revision, first.revision);
  assert.deepEqual(retry.rewards, first.rewards);
  assert.deepEqual(retry.state, first.state);
  assert.equal(repository.saves.get(PLAYER_ID).Revision, 8);
  assert.equal(repository.calls.completeRun.length, 2);
  assert.equal(repository.calls.published.length, 1);
  assert.equal(changed.status, 409);
  assert.equal(changed.code, 'run-already-completed');
});

test('a valid death receives replayed kill rewards without clear rewards, stage unlocks or a best', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository, { snapshot: {
    ...strongSnapshot,
    maxHp: 1,
    currentHp: 1,
    attack: 1000,
    defense: 0,
  } });
  const ticket = {
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1,
    simulatorVersion: 4, balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  };
  const { inputs, replay } = makeDeathInputs(ticket, repository.tickets.get(RUN_ID).PlayerSnapshotJson
    ? JSON.parse(repository.tickets.get(RUN_ID).PlayerSnapshotJson)
    : undefined);
  assert.equal(replay.outcome, 'death');
  const result = await (await loadStageRunService()).submitStageResult(
    {}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(repository),
  );

  assert.equal(result.status, 200);
  assert.equal(result.verified, true);
  assert.equal(result.outcome, 'death');
  assert.equal(result.clearTimeMs, null);
  assert.equal(result.bestChanged, false);
  assert.equal(result.rewards.outcome, 'death');
  assert.ok(result.rewards.goldGranted > 0);
  assert.equal(result.state.progression.unlockedStage, 1);
  assert.deepEqual(result.state.progression.clearedStageIds, []);
  assert.equal(repository.tickets.get(RUN_ID).Status, 'completed');
  assert.equal(repository.tickets.get(RUN_ID).RewardJson !== null, true);
  assert.equal(repository.bests.size, 0);
  assert.equal(repository.calls.published.length, 0);
});

test('invalid and incomplete replays are terminally recorded without reward or revision changes', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository, { snapshot:{ ...strongSnapshot, xp:99 } });
  const service = await loadStageRunService();
  const result = await service.submitStageResult(
    {}, identityA, RUN_ID, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), createStageDependencies(repository),
  );

  assert.equal(result.status, 422);
  assert.equal(result.outcome, 'incomplete');
  assert.equal(repository.tickets.get(RUN_ID).Status, 'rejected');
  assert.equal(repository.tickets.get(RUN_ID).RewardJson, null);
  assert.equal(repository.saves.get(PLAYER_ID).Revision, 7);
  assert.equal(repository.bests.size, 0);
});

test('completion applies its reward delta to the latest locked canonical profile and save revision', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const latest = repository.saves.get(PLAYER_ID);
  const latestState = JSON.parse(latest.SaveJson);
  latestState.player.currentHp = 12;
  latestState.player.baseStats.attack = 777;
  latestState.progression.unlockedChapter = 99;
  latestState.gold = 999999;
  latest.Revision = 12;
  latest.SaveJson = JSON.stringify(latestState);
  latest.RewardProfile.Gold = 50;
  const { inputs } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const result = await (await loadStageRunService()).submitStageResult(
    {}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(repository),
  );

  assert.equal(result.status, 200);
  assert.equal(result.revision, 13);
  assert.equal(result.state.player.currentHp, 12);
  assert.equal(result.state.player.baseStats.attack, 777);
  assert.equal(result.state.gold, 50 + result.rewards.goldGranted);
  assert.notEqual(result.state.progression.unlockedChapter, 99);
});

test('reward overflow and every transactional write failure leave the run, profile and save unchanged', async () => {
  const { inputs } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const overflow = createStageRepository();
  seedIssuedTicket(overflow);
  overflow.saves.get(PLAYER_ID).RewardProfile.Gold = Number.MAX_SAFE_INTEGER;
  const overflowResult = await (await loadStageRunService()).submitStageResult(
    {}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(overflow),
  );
  assert.deepEqual(overflowResult, { status: 422, code: 'reward-overflow' });
  assert.equal(overflow.saves.get(PLAYER_ID).Revision, 7);
  assert.equal(overflow.tickets.get(RUN_ID).Status, 'issued');

  for (const failure of ['profile', 'cloudSave', 'ticket', 'stageBest']) {
    const repository = createStageRepository();
    seedIssuedTicket(repository);
    repository.failAt = failure;
    await assert.rejects(
      () => (async () => (await loadStageRunService()).submitStageResult(
        {}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), createStageDependencies(repository),
      ))(),
      /write failed/,
    );
    assert.equal(repository.saves.get(PLAYER_ID).Revision, 7, `${failure} rollback keeps CloudSave revision`);
    assert.equal(Number(repository.saves.get(PLAYER_ID).RewardProfile.Gold), 0, `${failure} rollback keeps profile`);
    assert.equal(repository.tickets.get(RUN_ID).Status, 'issued', `${failure} rollback keeps ticket issued`);
    assert.equal(repository.tickets.get(RUN_ID).RewardJson, null, `${failure} rollback clears reward receipt`);
    assert.equal(repository.bests.size, 0, `${failure} rollback keeps StageBests`);
  }
});

test('concurrent duplicate submissions grant one reward and the retry reads latest state', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const { inputs } = makeClearInputs({
    runId: RUN_ID, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4,
    balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString(),
  });
  const dependencies = createStageDependencies(repository);
  const service = await loadStageRunService();
  const results = await Promise.all([
    service.submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies),
    service.submitStageResult({}, identityA, RUN_ID, { inputs }, new Date('2026-10-21T02:03:00.000Z'), dependencies),
  ]);

  assert.deepEqual(results.map((result) => result.status), [200, 200]);
  assert.equal(results[0].revision, 8);
  assert.equal(results[1].revision, 8);
  assert.deepEqual(results[0].rewards, results[1].rewards);
  assert.equal(repository.saves.get(PLAYER_ID).Revision, 8);
  assert.equal(repository.calls.published.length, 1);
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
  const trace1 = makeClearInputs({ runId: firstTicket, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4, balanceVersion: 2, issuedAtUtc: ISSUED_AT.toISOString() });
  const first = await submitStageResult({}, identityA, firstTicket, { inputs: trace1.inputs }, new Date('2026-10-21T02:02:00.000Z'), dependencies);

  const profileAfterFirst = repository.saves.get(PLAYER_ID).RewardProfile;
  const snapshotAfterFirst = {
    ...strongSnapshot,
    level: profileAfterFirst.Level,
    xp: profileAfterFirst.Xp,
    xpToNext: profileAfterFirst.XpToNext,
    pendingLevelUps: profileAfterFirst.PendingLevelUps,
    replayXpMultiplier: 0.3,
  };
  repository.tickets.get(ticket2).PlayerSnapshotJson = JSON.stringify(snapshotAfterFirst);
  const trace2 = makeClearInputs({ runId: ticket2, seed: 123456, chapter: 1, stage: 1, simulatorVersion: 4, balanceVersion: 2, issuedAtUtc: '2026-10-21T02:01:00.000Z' }, snapshotAfterFirst);
  const slower = await submitStageResult({}, identityA, ticket2, { inputs: trace2.inputs }, new Date('2026-10-21T02:04:00.000Z'), dependencies);

  const profileAfterSecond = repository.saves.get(PLAYER_ID).RewardProfile;
  const snapshotAfterSecond = {
    ...strongSnapshot,
    level: profileAfterSecond.Level,
    xp: profileAfterSecond.Xp,
    xpToNext: profileAfterSecond.XpToNext,
    pendingLevelUps: profileAfterSecond.PendingLevelUps,
    replayXpMultiplier: 1,
  };
  repository.tickets.get(ticket3).PlayerSnapshotJson = JSON.stringify(snapshotAfterSecond);
  const trace3 = makeClearInputs({ runId: ticket3, seed: 123456, chapter: 1, stage: 2, simulatorVersion: 4, balanceVersion: 2, issuedAtUtc: '2026-10-21T02:02:00.000Z' }, snapshotAfterSecond);
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

test('an issued v3 ticket is expired and rejected immediately after the v4 switch', async () => {
  const repository = createStageRepository();
  seedIssuedTicket(repository);
  const ticket = repository.tickets.get(RUN_ID);
  ticket.SimulatorVersion = 3;
  ticket.BalanceVersion = 2;
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
