import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPvpDependencies, createPvpRepository, identityA, MATCH_A, PLAYER_A, PLAYER_B, PLAYER_C,
  makeSnapshot, strongCombat,
} from '../../test-support/pvp.js';

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
  const result = await findOpponent({}, identityA, dependencies);

  assert.equal(result.status, 201);
  assert.equal(result.ticket.matchId, MATCH_A);
  assert.equal(result.ticket.seed, 123456);
  assert.equal(result.ticket.simulatorVersion, 1);
  assert.equal(result.ticket.expiresAtUtc, '2026-10-21T02:10:00.000Z');
  assert.equal(result.ticket.playerSnapshot.combat.attack, strongCombat.attack);
  assert.equal(result.ticket.opponentSnapshot.revision, 1);
  assert.equal(repository.calls.creates[0].player1Id, PLAYER_A);
  assert.equal(repository.calls.creates[0].player2Id, PLAYER_B);
});

test('rating search expands by 100 every five seconds to the 500 point maximum', async () => {
  const repository = createPvpRepository({ ratings: { [PLAYER_A]: 1000, [PLAYER_B]: 1250 } });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();
  const result = await findOpponent({}, identityA, dependencies);
  assert.equal(result.status, 201);
  assert.deepEqual(repository.calls.windows.slice(0, 3), [100, 200, 300]);
});

test('search returns no-opponent after 60 seconds and requires a published own snapshot', async () => {
  const repository = createPvpRepository({ snapshots: { [PLAYER_A]: null, [PLAYER_B]: null, [PLAYER_C]: null } });
  const dependencies = createPvpDependencies(repository);
  const { findOpponent } = await loadMatchmakingService();
  const missingSnapshot = await findOpponent({}, identityA, dependencies);
  assert.equal(missingSnapshot.status, 409);
  assert.equal(missingSnapshot.code, 'snapshot-required');

  const secondRepository = createPvpRepository({ snapshots: { [PLAYER_A]: makeSnapshot(strongCombat), [PLAYER_B]: null, [PLAYER_C]: null } });
  const second = createPvpDependencies(secondRepository);
  const noOpponent = await findOpponent({}, identityA, second);
  assert.equal(noOpponent.status, 404);
  assert.equal(noOpponent.code, 'no-opponent');
});
