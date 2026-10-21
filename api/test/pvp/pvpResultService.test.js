import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPvpDependencies, createPvpRepository, identityA, identityB, makePvpInputs,
  MATCH_A, MATCH_B, neutralCombat, PLAYER_B, makeSnapshot, seedIssuedMatch, strongCombat, weakCombat,
} from '../../test-support/pvp.js';

async function loadPvpResultService() {
  try {
    return await import('../../src/services/pvpResultService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP result service: ${error.message}`);
    throw error;
  }
}

async function loadPvpRatingDomain() {
  try {
    return await import('../../src/domain/pvpRating.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP rating domain: ${error.message}`);
    throw error;
  }
}

test('Elo uses K=32 and exact win, loss and draw scores', async () => {
  const { calculateElo } = await loadPvpRatingDomain();
  assert.deepEqual(calculateElo(1000, 1000, 'win'), { player1: 1016, player2: 984 });
  assert.deepEqual(calculateElo(1000, 1000, 'loss'), { player1: 984, player2: 1016 });
  assert.deepEqual(calculateElo(1000, 1000, 'draw'), { player1: 1000, player2: 1000 });
});

test('submitPvpResult replays contact combat and updates both ratings transactionally', async () => {
  const repository = createPvpRepository();
  const row = seedIssuedMatch(repository, { playerSnapshot: strongCombat, opponentSnapshot: weakCombat });
  const dependencies = createPvpDependencies(repository);
  const { inputs, replay } = makePvpInputs({ matchId: MATCH_A, seed: 123456, simulatorVersion: 1, issuedAtUtc: row.IssuedAtUtc.toISOString() }, strongCombat, weakCombat);
  const { submitPvpResult } = await loadPvpResultService();
  const result = await submitPvpResult({}, identityA, MATCH_A, { inputs }, new Date('2026-10-21T02:01:00.000Z'), dependencies);

  assert.equal(replay.outcome, 'win');
  assert.equal(result.status, 200);
  assert.equal(result.outcome, 'win');
  assert.equal(result.rated, true);
  assert.equal(result.playerRatingBefore, 1000);
  assert.equal(result.playerRatingAfter, 1016);
  assert.equal(result.opponentRatingAfter, 984);
  assert.equal(repository.calls.published.length, 1);
});

test('issued match replay uses the frozen opponent snapshot after a later publication', async () => {
  const repository = createPvpRepository();
  const row = seedIssuedMatch(repository, { playerSnapshot: strongCombat, opponentSnapshot: weakCombat });
  const dependencies = createPvpDependencies(repository);
  const trace = makePvpInputs({ matchId: MATCH_A, seed: 123456, simulatorVersion: 1, issuedAtUtc: row.IssuedAtUtc.toISOString() }, strongCombat, weakCombat);
  repository.snapshotRows.set(PLAYER_B, {
    PlayerId: PLAYER_B,
    Revision: 2,
    SnapshotJson: JSON.stringify(makeSnapshot(strongCombat, 2)),
    UpdatedAtUtc: new Date('2026-10-21T02:00:30.000Z'),
  });
  const { submitPvpResult } = await loadPvpResultService();
  const result = await submitPvpResult({}, identityA, MATCH_A, { inputs: trace.inputs }, new Date('2026-10-21T02:01:00.000Z'), dependencies);

  assert.equal(result.outcome, 'win');
  assert.equal(JSON.parse(repository.matches.get(MATCH_A).Player2SnapshotJson).revision, 1);
});

test('draws consume the daily pair result without changing either Elo rating', async () => {
  const repository = createPvpRepository();
  const row = seedIssuedMatch(repository, { playerSnapshot: neutralCombat, opponentSnapshot: neutralCombat });
  const dependencies = createPvpDependencies(repository);
  const { inputs, replay } = makePvpInputs({ matchId: MATCH_A, seed: 123456, simulatorVersion: 1, issuedAtUtc: row.IssuedAtUtc.toISOString() }, neutralCombat, neutralCombat);
  const { submitPvpResult } = await loadPvpResultService();
  const result = await submitPvpResult({}, identityA, MATCH_A, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), dependencies);

  assert.equal(replay.outcome, 'draw');
  assert.equal(result.outcome, 'draw');
  assert.equal(result.rated, true);
  assert.equal(result.playerRatingBefore, result.playerRatingAfter);
  assert.equal(result.opponentRatingAfter, 1000);
});

test('same-day pair guard makes later results unrated and completed payloads idempotent', async () => {
  const repository = createPvpRepository();
  const firstRow = seedIssuedMatch(repository, { playerSnapshot: strongCombat, opponentSnapshot: weakCombat });
  const dependencies = createPvpDependencies(repository);
  const trace = makePvpInputs({ matchId: MATCH_A, seed: 123456, simulatorVersion: 1, issuedAtUtc: firstRow.IssuedAtUtc.toISOString() }, strongCombat, weakCombat);
  const { submitPvpResult } = await loadPvpResultService();
  const first = await submitPvpResult({}, identityA, MATCH_A, { inputs: trace.inputs }, new Date('2026-10-21T02:01:00.000Z'), dependencies);
  const retry = await submitPvpResult({}, identityA, MATCH_A, { inputs: trace.inputs }, new Date('2026-10-21T02:11:00.000Z'), dependencies);
  const changed = await submitPvpResult({}, identityA, MATCH_A, { inputs: [] }, new Date('2026-10-21T02:12:00.000Z'), dependencies);

  seedIssuedMatch(repository, { matchId: MATCH_B, playerSnapshot: strongCombat, opponentSnapshot: weakCombat, issuedAtUtc: new Date('2026-10-21T02:03:00.000Z') });
  const second = await submitPvpResult({}, identityA, MATCH_B, { inputs: trace.inputs }, new Date('2026-10-21T02:04:00.000Z'), dependencies);

  assert.equal(first.rated, true);
  assert.equal(retry.rated, true);
  assert.equal(retry.playerRatingAfter, first.playerRatingAfter);
  assert.equal(changed.status, 409);
  assert.equal(second.rated, false);
  assert.equal(second.playerRatingAfter, first.playerRatingAfter);
  assert.equal(repository.calls.published.length, 1);
});

test('a top-board publish failure does not suppress the player rank event', async () => {
  const repository = createPvpRepository();
  const row = seedIssuedMatch(repository, { playerSnapshot:strongCombat, opponentSnapshot:weakCombat });
  const playerEvents = [];
  const dependencies = createPvpDependencies(repository, {
    publishMatchCompleted:async () => { throw new Error('group publish unavailable'); },
    publishPlayerRankChanged:async (event) => playerEvents.push(event),
  });
  const trace = makePvpInputs({ matchId:MATCH_A, seed:123456, simulatorVersion:1, issuedAtUtc:row.IssuedAtUtc.toISOString() }, strongCombat, weakCombat);
  const { submitPvpResult } = await loadPvpResultService();

  const result = await submitPvpResult({}, identityA, MATCH_A, { inputs:trace.inputs }, new Date('2026-10-21T02:01:00.000Z'), dependencies);

  assert.equal(result.status, 200);
  assert.equal(result.rated, true);
  assert.equal(playerEvents.length, 1);
  assert.equal(playerEvents[0].board, 'pvp');
  assert.equal(playerEvents[0].identity, identityA);
});

test('match ownership, expiry and client-supplied result claims are rejected', async () => {
  const repository = createPvpRepository();
  const expiredId = MATCH_B;
  seedIssuedMatch(repository, { matchId: expiredId, expiresAtUtc: new Date('2026-10-21T02:00:30.000Z') });
  const dependencies = createPvpDependencies(repository);
  const { submitPvpResult } = await loadPvpResultService();
  const foreign = await submitPvpResult({}, identityB, expiredId, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), dependencies);
  const expired = await submitPvpResult({}, identityA, expiredId, { inputs: [] }, new Date('2026-10-21T02:01:00.000Z'), dependencies);
  const spoofed = await submitPvpResult({}, identityA, expiredId, { inputs: [], outcome: 'win' }, new Date('2026-10-21T02:01:00.000Z'), dependencies);
  assert.equal(foreign.status, 404);
  assert.equal(expired.status, 410);
  assert.equal(spoofed.status, 400);
});
