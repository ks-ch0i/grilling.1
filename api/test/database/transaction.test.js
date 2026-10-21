import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadTransaction() {
  try {
    return await import('../../src/database/transaction.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the SQL transaction helper to exist: ${error.message}`);
    }
    throw error;
  }
}

test('withTransaction commits successful work and returns its value', async () => {
  const { withTransaction } = await loadTransaction();
  const calls = [];
  const transactionFactory = () => ({
    begin: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
  });
  const result = await withTransaction({}, async () => { calls.push('work'); return 'saved'; }, transactionFactory);
  assert.equal(result, 'saved');
  assert.deepEqual(calls, ['begin', 'work', 'commit']);
});

test('withTransaction rolls back failed work and preserves the original error', async () => {
  const { withTransaction } = await loadTransaction();
  const calls = [];
  const failure = new Error('write failed');
  const transactionFactory = () => ({
    begin: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
  });
  await assert.rejects(withTransaction({}, async () => { throw failure; }, transactionFactory), (error) => error === failure);
  assert.deepEqual(calls, ['begin', 'rollback']);
});
