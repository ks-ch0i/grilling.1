import assert from 'node:assert/strict';
import sql from 'mssql';
import { test } from 'node:test';

async function loadRepository() {
  try {
    return await import('../../src/repositories/pvpRetentionRepository.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP retention repository: ${error.message}`);
    throw error;
  }
}

function mockRequests() {
  const originalRequest = sql.Request;
  const calls = [];
  class FakeRequest {
    constructor(connection) {
      this.connection = connection;
      this.parameters = {};
    }
    input(name, _type, value) {
      this.parameters[name] = value;
      return this;
    }
    async query(statement) {
      calls.push({ statement, parameters: { ...this.parameters } });
      return { recordset: [{ RowsAffected: 7 }] };
    }
  }
  sql.Request = FakeRequest;
  return { calls, restore: () => { sql.Request = originalRequest; } };
}

const nowUtc = new Date('2026-10-25T03:15:00.000Z');

test('expireOverdueIssuedMatchesBatch changes only issued matches whose ticket expired', async () => {
  const mock = mockRequests();
  try {
    const repository = await loadRepository();
    const affected = await repository.expireOverdueIssuedMatchesBatch({}, { nowUtc, batchSize: 125 });

    assert.equal(affected, 7);
    assert.equal(mock.calls[0].parameters.NowUtc, nowUtc);
    assert.equal(mock.calls[0].parameters.BatchSize, 125);
    assert.match(mock.calls[0].statement, /UPDATE TOP \(@BatchSize\) dbo\.PvpMatches/i);
    assert.match(mock.calls[0].statement, /SET Status = N'expired'[\s\S]*?WHERE Status = N'issued' AND ExpiresAtUtc <= @NowUtc/i);
    assert.match(mock.calls[0].statement, /SELECT @@ROWCOUNT AS RowsAffected/i);
  } finally {
    mock.restore();
  }
});

test('deleteExpiredPayloadBatch keeps summaries and uses terminal time plus the 90-day cutoff', async () => {
  const mock = mockRequests();
  try {
    const repository = await loadRepository();
    const affected = await repository.deleteExpiredPayloadBatch({}, { nowUtc, batchSize: 80 });

    assert.equal(affected, 7);
    assert.equal(mock.calls[0].parameters.NowUtc, nowUtc);
    assert.equal(mock.calls[0].parameters.BatchSize, 80);
    assert.match(mock.calls[0].statement, /DELETE TOP \(@BatchSize\) payload[\s\S]*FROM dbo\.PvpMatchPayloads AS payload/i);
    assert.match(mock.calls[0].statement, /match\.Status IN \(N'completed', N'rejected', N'expired'\)/i);
    assert.match(mock.calls[0].statement, /COALESCE\(match\.CompletedAtUtc, match\.ExpiresAtUtc\) <= DATEADD\(day, -90, @NowUtc\)/i);
    assert.doesNotMatch(mock.calls[0].statement, /DELETE TOP \(@BatchSize\)\s+dbo\.PvpMatches/i);
  } finally {
    mock.restore();
  }
});

test('deleteOldRatedPairDayBatch preserves the current UTC date', async () => {
  const mock = mockRequests();
  try {
    const repository = await loadRepository();
    const affected = await repository.deleteOldRatedPairDayBatch({}, { nowUtc, batchSize: 40 });

    assert.equal(affected, 7);
    assert.equal(mock.calls[0].parameters.NowUtc, nowUtc);
    assert.equal(mock.calls[0].parameters.BatchSize, 40);
    assert.match(mock.calls[0].statement, /DELETE TOP \(@BatchSize\) dbo\.PvpRatedPairDays/i);
    assert.match(mock.calls[0].statement, /MatchDateUtc < CONVERT\(date, @NowUtc\)/i);
  } finally {
    mock.restore();
  }
});

test('batch methods reject a response without a row count', async () => {
  const originalRequest = sql.Request;
  class EmptyRequest {
    input() { return this; }
    async query() { return { recordset: [] }; }
  }
  sql.Request = EmptyRequest;
  try {
    const repository = await loadRepository();
    await assert.rejects(
      repository.deleteOldRatedPairDayBatch({}, { nowUtc, batchSize: 1 }),
      /valid row count/,
    );
  } finally {
    sql.Request = originalRequest;
  }
});
