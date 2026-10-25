import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPvpHistoryRow, isCurrentPvpHistoryRequest } from '../src/game/ui/pvpHistory.js';

const item = {
  matchId:'22222222-2222-4222-8222-222222222222',
  completedAtUtc:'2026-10-24T10:00:00.000Z',
  opponentDisplayName:'상대 기사',
  outcome:'win',
  rated:true,
  ratingBefore:1000,
  ratingAfter:1016,
  opponentRatingAfter:984,
};

test('PvP history formatter uses local date, Korean outcome, and the rating delta', () => {
  const row = formatPvpHistoryRow(item);
  const localDate = new Intl.DateTimeFormat('ko-KR', { dateStyle:'short', timeStyle:'short' }).format(new Date(item.completedAtUtc));

  assert.deepEqual(row, {
    completedAt:localDate,
    opponent:'상대 기사',
    outcome:'승리',
    rating:'레이팅 +16',
  });
  assert.equal(JSON.stringify(row).includes(item.matchId), false);
});

test('PvP history formatter labels losses and unrated matches without a delta', () => {
  assert.equal(formatPvpHistoryRow({ ...item, outcome:'loss', rated:true, ratingBefore:1000, ratingAfter:986 }).outcome, '패배');
  assert.equal(formatPvpHistoryRow({ ...item, outcome:'draw', rated:false, ratingBefore:1000, ratingAfter:1000 }).rating, '레이팅 미반영');
});

test('PvP history formatter rejects malformed rows', () => {
  assert.throws(() => formatPvpHistoryRow({ ...item, completedAtUtc:'invalid' }), TypeError);
});

test('history request state rejects stale responses and responses after closing the overlay', () => {
  assert.equal(isCurrentPvpHistoryRequest(4, 4, true), true);
  assert.equal(isCurrentPvpHistoryRequest(3, 4, true), false);
  assert.equal(isCurrentPvpHistoryRequest(4, 4, false), false);
});
