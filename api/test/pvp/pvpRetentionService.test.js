import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadService() {
  try {
    return await import('../../src/services/pvpRetentionService.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP retention service: ${error.message}`);
    throw error;
  }
}

const NOW = new Date('2026-10-25T03:15:00.000Z');

test('cleanup uses one UTC timestamp, short transactions and stops each phase after an empty batch', async () => {
  const { cleanupPvpRetention } = await loadService();
  const calls = [];
  const sequences = {
    expireOverdueActiveMatchesBatch: [3, 0],
    deleteExpiredPayloadBatch: [4, 0],
    deleteOldRatedPairDayBatch: [2, 0],
    deleteExpiredSearchBatch: [1, 0],
  };
  const repository = Object.fromEntries(Object.entries(sequences).map(([name, results]) => [name, async (_transaction, input) => {
    calls.push({ name, input });
    return results.shift();
  }]));
  let transactionNumber = 0;
  const summary = await cleanupPvpRetention({}, {
    clock: () => NOW,
    repository,
    withTransaction: async (_pool, work) => {
      transactionNumber += 1;
      return work({ transactionNumber });
    },
  });

  assert.deepEqual(summary, { matchesExpired:3, payloadRowsDeleted:4, pairDayRowsDeleted:2, searchRowsDeleted:1, batches:8 });
  assert.equal(transactionNumber, 8);
  assert.deepEqual(calls.map(({ name }) => name), [
    'expireOverdueActiveMatchesBatch', 'deleteExpiredPayloadBatch', 'deleteOldRatedPairDayBatch', 'deleteExpiredSearchBatch',
    'expireOverdueActiveMatchesBatch', 'deleteExpiredPayloadBatch', 'deleteOldRatedPairDayBatch', 'deleteExpiredSearchBatch',
  ]);
  assert.ok(calls.every(({ input }) => input.nowUtc.toISOString() === NOW.toISOString()));
  assert.ok(calls.every(({ input }) => input.batchSize === 500));
});

test('payload and UTC pair-day expiry boundaries preserve data before the cutoff and today', async () => {
  const { cleanupPvpRetention } = await loadService();
  const cutoff = new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000);
  const terminalTimes = [
    new Date(cutoff.getTime() + 60 * 60 * 1000),
    cutoff,
    new Date(cutoff.getTime() - 60 * 60 * 1000),
  ];
  const payloads = terminalTimes.map((terminalAtUtc, index) => ({ id: index, terminalAtUtc }));
  const pairDays = ['2026-10-24', '2026-10-25'];
  const searchRows = [
    { status:'searching', retainUntilUtc:null },
    { status:'cancelled', retainUntilUtc:new Date(NOW.getTime() + 1) },
    { status:'expired', retainUntilUtc:NOW },
  ];
  const repository = {
    async expireOverdueActiveMatchesBatch() { return 0; },
    async deleteExpiredPayloadBatch(_transaction, { nowUtc, batchSize }) {
      const boundary = new Date(nowUtc.getTime() - 90 * 24 * 60 * 60 * 1000);
      const expired = payloads.filter(({ terminalAtUtc }) => terminalAtUtc <= boundary).slice(0, batchSize);
      for (const row of expired) payloads.splice(payloads.indexOf(row), 1);
      return expired.length;
    },
    async deleteOldRatedPairDayBatch(_transaction, { nowUtc, batchSize }) {
      const todayUtc = nowUtc.toISOString().slice(0, 10);
      const expired = pairDays.filter((day) => day < todayUtc).slice(0, batchSize);
      for (const day of expired) pairDays.splice(pairDays.indexOf(day), 1);
      return expired.length;
    },
    async deleteExpiredSearchBatch(_transaction, { nowUtc, batchSize }) {
      const expired = searchRows.filter(({ status, retainUntilUtc }) =>
        status !== 'searching' && retainUntilUtc !== null && retainUntilUtc <= nowUtc).slice(0, batchSize);
      for (const row of expired) searchRows.splice(searchRows.indexOf(row), 1);
      return expired.length;
    },
  };

  const summary = await cleanupPvpRetention({}, {
    clock: () => NOW,
    repository,
    withTransaction: async (_pool, work) => work({}),
    batchSize: 1,
  });

  assert.deepEqual(summary, { matchesExpired:0, payloadRowsDeleted:2, pairDayRowsDeleted:1, searchRowsDeleted:1, batches:8 });
  assert.deepEqual(payloads.map(({ id }) => id), [0]);
  assert.deepEqual(pairDays, ['2026-10-25']);
  assert.deepEqual(searchRows.map(({ status }) => status), ['searching', 'cancelled']);
});

test('one invocation caps the shared budget at ten and gives every backlog one batch per round', async () => {
  const { cleanupPvpRetention } = await loadService();
  const calls = [];
  const repository = {
    async expireOverdueActiveMatchesBatch() { calls.push('expire'); return 500; },
    async deleteExpiredPayloadBatch() { calls.push('payload'); return 500; },
    async deleteOldRatedPairDayBatch() { calls.push('pair'); return 500; },
    async deleteExpiredSearchBatch() { calls.push('search'); return 500; },
  };
  const summary = await cleanupPvpRetention({}, {
    clock: () => NOW,
    repository,
    withTransaction: async (_pool, work) => work({}),
  });

  assert.equal(summary.batches, 10);
  assert.equal(calls.length, 10);
  assert.deepEqual(calls.slice(0, 4), ['expire', 'payload', 'pair', 'search']);
  assert.deepEqual(summary, { matchesExpired:1500, payloadRowsDeleted:1500, pairDayRowsDeleted:1000, searchRowsDeleted:1000, batches:10 });
});

test('cleanup rejects unsafe limits, invalid clocks and invalid row counts', async () => {
  const { cleanupPvpRetention } = await loadService();
  await assert.rejects(cleanupPvpRetention({}, { batchSize: 501 }), RangeError);
  await assert.rejects(cleanupPvpRetention({}, { maxBatches: 11 }), RangeError);
  await assert.rejects(cleanupPvpRetention({}, { clock: () => new Date('invalid') }), TypeError);
  await assert.rejects(cleanupPvpRetention({}, {
    clock: () => NOW,
    repository: { expireOverdueActiveMatchesBatch: async () => 501 },
    withTransaction: async (_pool, work) => work({}),
  }), /invalid batch row count/);
});

test('database failures propagate so the timer runtime can retry', async () => {
  const { cleanupPvpRetention } = await loadService();
  const failure = new Error('SQL unavailable');
  await assert.rejects(cleanupPvpRetention({}, {
    clock: () => NOW,
    repository: { expireOverdueActiveMatchesBatch: async () => 0 },
    withTransaction: async () => { throw failure; },
  }), (error) => error === failure);
});
