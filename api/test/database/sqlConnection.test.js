import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadSqlConnection() {
  try {
    return await import('../../src/database/sqlConnection.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the SQL connection module to exist: ${error.message}`);
    }
    throw error;
  }
}

test('SQL pools use a TokenCredential and encrypted connections without passwords', async () => {
  const { getSqlPool } = await loadSqlConnection();
  const credential = { getToken: async () => ({ token: 'sql-access-token', expiresOnTimestamp: Date.now() + 3600000 }) };
  let captured;
  const expectedPool = { connected: true };
  const pool = await getSqlPool({
    server: 'knight-run.database.windows.net',
    database: 'KnightRun',
    credential,
  }, {
    poolFactory: (config) => {
      captured = config;
      return { connect: async () => expectedPool };
    },
  });

  assert.equal(pool, expectedPool);
  assert.equal(captured.server, 'knight-run.database.windows.net');
  assert.equal(captured.database, 'KnightRun');
  assert.equal(captured.authentication.type, 'token-credential');
  assert.equal(captured.authentication.options.credential, credential);
  assert.equal(captured.options.encrypt, true);
  assert.equal(captured.options.trustServerCertificate, false);
  assert.equal(Object.hasOwn(captured, 'user'), false);
  assert.equal(Object.hasOwn(captured, 'password'), false);
});

test('SQL pool connection failures close the pool and can be retried', async () => {
  const { getSqlPool } = await loadSqlConnection();
  const credential = { getToken: async () => ({ token: 'token', expiresOnTimestamp: Date.now() + 3600000 }) };
  let attempt = 0;
  let closed = false;
  const config = { server: 'retry.database.windows.net', database: 'KnightRun', credential };
  const poolFactory = () => ({
    connect: async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('connect failed');
      return { connected: true };
    },
    close: async () => { closed = true; },
  });

  await assert.rejects(getSqlPool(config, { poolFactory }), /connect failed/);
  assert.equal(closed, true);
  assert.equal((await getSqlPool(config, { poolFactory })).connected, true);
});
