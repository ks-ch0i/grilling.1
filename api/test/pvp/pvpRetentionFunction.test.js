import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadFunction() {
  try {
    return await import('../../src/functions/pvpRetentionCleanup.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP retention timer function: ${error.message}`);
    throw error;
  }
}

const env = {
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};
const nowUtc = new Date('2026-10-25T03:15:00.000Z');

test('registers the monitored UTC daily timer without running at startup', async () => {
  const { PVP_RETENTION_CLEANUP_SCHEDULE, registerPvpRetentionCleanup } = await loadFunction();
  const registrations = [];
  registerPvpRetentionCleanup({ timer: (name, options) => registrations.push({ name, options }) }, {
    env,
    credential: {},
    sqlPoolProvider: async () => ({}),
    service: async () => ({ matchesExpired:0, payloadRowsDeleted:0, pairDayRowsDeleted:0, searchRowsDeleted:0, batches:0 }),
    clock: () => nowUtc,
  });

  assert.equal(PVP_RETENTION_CLEANUP_SCHEDULE, '0 15 3 * * *');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, 'pvpRetentionCleanup');
  assert.equal(registrations[0].options.schedule, '0 15 3 * * *');
  assert.equal(registrations[0].options.runOnStartup, false);
  assert.equal(registrations[0].options.useMonitor, true);
  assert.equal(typeof registrations[0].options.handler, 'function');
});

test('handler connects once, passes one fixed clock to cleanup and logs only aggregate counts', async () => {
  const { createPvpRetentionCleanupHandler } = await loadFunction();
  const pool = { id: 'pool' };
  const pools = [];
  const cleanups = [];
  const logs = [];
  let clockCalls = 0;
  const summary = { matchesExpired:5, payloadRowsDeleted:11, pairDayRowsDeleted:4, searchRowsDeleted:7, batches:8 };
  const handler = createPvpRetentionCleanupHandler({
    env,
    credential: { id: 'managed-identity' },
    sqlPoolProvider: async (config) => { pools.push(config); return pool; },
    service: async (actualPool, options) => {
      cleanups.push({ actualPool, nowUtc: options.clock() });
      return summary;
    },
    clock: () => { clockCalls += 1; return nowUtc; },
  });

  const returned = await handler({}, { info: (line) => logs.push(line) });

  assert.equal(returned, summary);
  assert.equal(clockCalls, 1);
  assert.deepEqual(pools, [{
    server: env.SQL_SERVER_FQDN,
    database: env.SQL_DATABASE,
    credential: { id: 'managed-identity' },
  }]);
  assert.deepEqual(cleanups, [{ actualPool: pool, nowUtc }]);
  assert.deepEqual(logs.map((line) => JSON.parse(line)), [{
    event: 'pvpRetentionCleanupCompleted', ...summary,
  }]);
});

test('handler lets SQL failures escape and does not log success counts', async () => {
  const { createPvpRetentionCleanupHandler } = await loadFunction();
  const failure = new Error('database unavailable');
  const logs = [];
  const handler = createPvpRetentionCleanupHandler({
    env,
    sqlPoolProvider: async () => ({}),
    service: async () => { throw failure; },
    clock: () => nowUtc,
  });

  await assert.rejects(handler({}, { info: (line) => logs.push(line) }), (error) => error === failure);
  assert.deepEqual(logs, []);
});
