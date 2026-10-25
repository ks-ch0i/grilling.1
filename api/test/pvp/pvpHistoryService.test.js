import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityA, PLAYER_A, PLAYER_B } from '../../test-support/pvp.js';
import { createPvpResultService } from '../../src/services/pvpResultService.js';

const MATCH_IDS = Array.from({ length: 11 }, (_, index) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);

function historyRow(index) {
  return {
    MatchId: MATCH_IDS[index],
    CompletedAtUtc: new Date(`2026-10-${String(21 - index).padStart(2, '0')}T02:00:00.000Z`),
    OpponentDisplayName: index === 0 ? null : `Opponent ${index}`,
    Outcome: index % 2 === 0 ? 'win' : 'draw',
    Rated: index % 2 === 0,
    RatingBefore: 1000 + index,
    RatingAfter: 1010 + index,
    OpponentRatingAfter: 990 - index,
  };
}

test('history service requests 10 plus one row and exposes only summary DTO fields', async () => {
  const calls = [];
  const service = createPvpResultService({
    repository: {
      async findPlayerIdByIdentity(_pool, identity) {
        assert.equal(identity, identityA);
        return PLAYER_A;
      },
      async getMatchHistory(_pool, playerId, paging) {
        calls.push({ playerId, paging });
        return Array.from({ length: 11 }, (_, index) => historyRow(index));
      },
    },
  });

  const result = await service.getPlayerMatchHistory({ id: 'pool' }, identityA, 1);

  assert.deepEqual(calls, [{ playerId: PLAYER_A, paging: { offset: 0, limit: 10 } }]);
  assert.deepEqual({ page: result.page, pageSize: result.pageSize, hasPrevious: result.hasPrevious, hasNext: result.hasNext }, {
    page: 1, pageSize: 10, hasPrevious: false, hasNext: true,
  });
  assert.equal(result.items.length, 10);
  assert.equal(result.items[0].matchId, MATCH_IDS[0]);
  assert.equal(result.items[0].completedAtUtc, '2026-10-21T02:00:00.000Z');
  assert.equal(result.items[0].opponentDisplayName, 'Adventurer');
  assert.deepEqual(Object.keys(result.items[0]), [
    'matchId', 'completedAtUtc', 'opponentDisplayName', 'outcome', 'rated',
    'ratingBefore', 'ratingAfter', 'opponentRatingAfter',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Snapshot|InputJson|Seed|Entra|PlayerId/);
});

test('history service uses the requested offset and reports previous and empty final pages', async () => {
  const calls = [];
  const service = createPvpResultService({
    repository: {
      async findPlayerIdByIdentity() { return PLAYER_B; },
      async getMatchHistory(_pool, playerId, paging) {
        calls.push({ playerId, paging });
        return [];
      },
    },
  });

  const result = await service.getPlayerMatchHistory({}, identityA, 2);

  assert.deepEqual(calls, [{ playerId: PLAYER_B, paging: { offset: 10, limit: 10 } }]);
  assert.deepEqual(result, {
    status: 200, page: 2, pageSize: 10, hasPrevious: true, hasNext: false, items: [],
  });
});

test('history service returns an empty first-page envelope for an unregistered account', async () => {
  let historyRead = false;
  const service = createPvpResultService({
    repository: {
      async findPlayerIdByIdentity() { return null; },
      async getMatchHistory() { historyRead = true; return []; },
    },
  });

  assert.deepEqual(await service.getPlayerMatchHistory({}, identityA, 4), {
    status: 200, page: 4, pageSize: 10, hasPrevious: false, hasNext: false, items: [],
  });
  assert.equal(historyRead, false);
});

test('history service rejects pages outside its one-based safe range', async () => {
  const service = createPvpResultService({ repository: {} });
  assert.deepEqual(await service.getPlayerMatchHistory({}, identityA, 0), { status: 400, code: 'invalid-history-page' });
  assert.deepEqual(await service.getPlayerMatchHistory({}, identityA, 100_001), { status: 400, code: 'invalid-history-page' });
});
