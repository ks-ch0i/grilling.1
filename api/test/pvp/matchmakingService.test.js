import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPvpDependencies, createPvpRepository, identityA, identityB, MATCH_A, MATCH_B, PLAYER_A, PLAYER_B, PLAYER_C,
  makeSnapshot, seedIssuedMatch, strongCombat,
} from '../../test-support/pvp.js';

const SEARCH_A = 'ffffffff-6666-4666-8666-666666666666';
const SEARCH_B = 'abababab-7777-4777-8777-777777777777';

async function loadMatchmakingService() {
  try {
    return await import('../../src/services/matchmakingService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected matchmaking service: ${error.message}`);
    throw error;
  }
}

test('findOpponent creates an immutable snapshot ticket from an eligible rating window', async () => {
  const repository = createPvpRepository();
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();
  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.status, 201);
  assert.equal(result.ticket.matchId, MATCH_A);
  assert.equal(result.ticket.seed, 123456);
  assert.equal(result.ticket.simulatorVersion, 2);
  assert.equal(result.ticket.balanceVersion, 2);
  assert.equal(result.ticket.expiresAtUtc, '2026-10-21T02:10:00.000Z');
  assert.equal(result.ticket.playerSnapshot.combat.attack, strongCombat.attack);
  assert.equal(result.ticket.opponentSnapshot.revision, 1);
  assert.equal(repository.calls.creates[0].player1Id, PLAYER_A);
  assert.equal(repository.calls.creates[0].player2Id, PLAYER_B);
  assert.equal(repository.calls.creates[0].balanceVersion, 2);
  assert.equal(repository.matches.get(MATCH_A).BalanceVersion, 2);
});

test('v1 snapshots are excluded from current-version matchmaking', async () => {
  const repository = createPvpRepository();
  repository.snapshotRows.get(PLAYER_B).BalanceVersion = 1;
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();

  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.status, 404);
  assert.equal(result.code, 'no-opponent');
  assert.equal(repository.calls.creates.length, 0);
});

test('a stale own snapshot must be republished before matchmaking', async () => {
  const repository = createPvpRepository();
  repository.snapshotRows.get(PLAYER_A).BalanceVersion = 1;
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();

  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.status, 409);
  assert.equal(result.code, 'snapshot-required');
  assert.equal(repository.calls.windows.length, 0);
});

test('an active v1 match does not block a new v2 match for current-version snapshots', async () => {
  const repository = createPvpRepository();
  seedIssuedMatch(repository, { matchId: MATCH_B, simulatorVersion: 1, balanceVersion: 1 });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();

  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.status, 201);
  assert.equal(repository.matches.get(MATCH_B).Status, 'expired');
  assert.equal(result.ticket.simulatorVersion, 2);
  assert.equal(result.ticket.balanceVersion, 2);
  assert.equal(repository.matches.get(MATCH_A).BalanceVersion, 2);
});

test('createMatch rechecks both snapshot balance versions inside the transaction', async () => {
  const repository = createPvpRepository();
  const createMatch = repository.createMatch.bind(repository);
  repository.createMatch = async (transaction, input) => {
    repository.snapshotRows.get(PLAYER_B).BalanceVersion = 1;
    return createMatch(transaction, input);
  };
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();

  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.status, 404);
  assert.equal(result.code, 'no-opponent');
  assert.equal(repository.matches.has(MATCH_A), false);
  assert.deepEqual(repository.ratingRows.get(PLAYER_A), { PlayerId: PLAYER_A, Rating: 1000, UpdatedAtUtc: new Date('2026-10-21T02:00:00.000Z') });
});

test('rating search expands by 100 every five seconds to the 500 point maximum', async () => {
  const repository = createPvpRepository({ ratings: { [PLAYER_A]: 1000, [PLAYER_B]: 1250 } });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();
  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  assert.equal(result.status, 201);
  assert.deepEqual(repository.calls.windows.slice(0, 3), [100, 200, 300]);
});

test('search returns no-opponent after 60 seconds and requires a published own snapshot', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null, [PLAYER_B]: null, [PLAYER_C]: null } });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();
  const missingSnapshot = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  assert.equal(missingSnapshot.status, 409);
  assert.equal(missingSnapshot.code, 'snapshot-required');

  const secondRepository = createPvpRepository({ snapshots: { [PLAYER_A]: makeSnapshot(strongCombat), [PLAYER_B]: null, [PLAYER_C]: null } });
  const second = createPvpDependencies(secondRepository);
  const noOpponent = await findOpponent({}, identityA, { searchId: SEARCH_A }, second);
  assert.equal(noOpponent.status, 404);
  assert.equal(noOpponent.code, 'no-opponent');
  assert.equal(secondRepository.searches.get(SEARCH_A).Status, 'no-opponent');
});

test('same search id returns the existing ticket without creating a second match', async () => {
  const repository = createPvpRepository();
  const dependencies = createPvpDependencies(repository);
  const { findOpponent, getSearch } = await loadMatchmakingService();

  const first = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  const retry = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  const status = await getSearch({}, identityA, SEARCH_A, dependencies);
  const foreign = await getSearch({}, identityB, SEARCH_A, dependencies);

  assert.equal(first.status, 201);
  assert.equal(first.state, 'matched');
  assert.equal(first.searchId, SEARCH_A);
  assert.equal(retry.status, 200);
  assert.equal(retry.state, 'matched');
  assert.deepEqual(retry.ticket, first.ticket);
  assert.equal(status.status, 200);
  assert.deepEqual(status.ticket, first.ticket);
  assert.deepEqual(foreign, { status: 404, code: 'search-not-found' });
  assert.equal(repository.calls.creates.length, 1);
  assert.equal(repository.calls.windows.length, 1);
});

test('duplicate active searches do not start another loop and cancellation is polled within five seconds', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: makeSnapshot(strongCombat), [PLAYER_B]: null, [PLAYER_C]: null } });
  let signalSleep;
  let resumeSleep;
  const sleepEntered = new Promise((resolve) => { signalSleep = resolve; });
  const dependencies = createPvpDependencies(repository, {
    sleep: async (ms) => {
      assert.ok(ms <= 5000);
      resumeSleep = () => {};
      signalSleep();
      await new Promise((resolve) => { resumeSleep = resolve; });
    },
  });
  const { findOpponent, cancelSearch } = await loadMatchmakingService();

  const firstLoop = findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  await Promise.race([
    sleepEntered,
    firstLoop.then(() => { throw new Error('The first search loop exited before its cancellation poll.'); }),
  ]);
  const duplicate = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  assert.equal(duplicate.status, 202);
  assert.equal(duplicate.state, 'searching');
  assert.equal(repository.calls.windows.length, 1);

  const cancelled = await cancelSearch({}, identityA, SEARCH_A, dependencies);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.state, 'cancelled');
  resumeSleep();
  const firstResult = await firstLoop;
  assert.equal(firstResult.state, 'cancelled');
  assert.equal(repository.calls.creates.length, 0);
});

test('start confirmation is idempotent, preserves ticket expiry and blocks later cancellation', async () => {
  const repository = createPvpRepository();
  const dependencies = createPvpDependencies(repository);
  const { findOpponent, startMatch, cancelSearch } = await loadMatchmakingService();
  const matched = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  const originalExpiry = repository.matches.get(MATCH_A).ExpiresAtUtc;

  const started = await startMatch({}, identityA, MATCH_A, { searchId: SEARCH_A }, dependencies);
  const retry = await startMatch({}, identityA, MATCH_A, { searchId: SEARCH_A }, dependencies);
  const cancelled = await cancelSearch({}, identityA, SEARCH_A, dependencies);

  assert.equal(matched.state, 'matched');
  assert.equal(started.status, 200);
  assert.equal(started.state, 'started');
  assert.equal(retry.matchId, MATCH_A);
  assert.equal(repository.matches.get(MATCH_A).Status, 'started');
  assert.equal(repository.matches.get(MATCH_A).ExpiresAtUtc, originalExpiry);
  assert.equal(cancelled.status, 409);
  assert.equal(cancelled.code, 'match-already-started');
});

test('cancelling a matched ticket expires it and releases the stored opponent snapshot', async () => {
  const repository = createPvpRepository();
  const dependencies = createPvpDependencies(repository);
  const { findOpponent, cancelSearch } = await loadMatchmakingService();

  const first = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);
  const cancelled = await cancelSearch({}, identityA, SEARCH_A, dependencies);
  const second = await findOpponent({}, identityA, { searchId: SEARCH_B }, dependencies);

  assert.equal(first.ticket.matchId, MATCH_A);
  assert.deepEqual(cancelled, { status: 200, searchId: SEARCH_A, state: 'cancelled' });
  assert.equal(repository.matches.get(MATCH_A).Status, 'expired');
  assert.equal(second.status, 201);
  assert.equal(second.ticket.matchId, MATCH_B);
});

test('a failed search attachment rolls back the newly issued ticket', async () => {
  const repository = createPvpRepository();
  repository.attachSearchMatch = async () => ({ kind: 'conflict' });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();

  const result = await findOpponent({}, identityA, { searchId: SEARCH_A }, dependencies);

  assert.equal(result.state, 'searching');
  assert.equal(repository.matches.size, 0);
  assert.equal(repository.payloads.size, 0);
  assert.equal(repository.searches.get(SEARCH_A).Status, 'searching');
});
