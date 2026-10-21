import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadMe() {
  try {
    return await import('../../src/functions/me.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the /api/me function module to exist: ${error.message}`);
    }
    throw error;
  }
}

const env = {
  ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};
const authContext = {
  tenantId: env.ENTRA_TENANT_ID,
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Knight Runner',
};

function parseBody(response) {
  return JSON.parse(response.body);
}

test('GET /api/me returns only the authenticated account fields after SQL connects', async () => {
  const { createMeHandler } = await loadMe();
  let sqlConfig;
  const credential = { getToken: async () => ({ token: 'never-log-this' }) };
  const handler = createMeHandler({
    env,
    credential,
    authenticate: async () => authContext,
    sqlPoolProvider: async (config) => { sqlConfig = config; return {}; },
  });
  const response = await handler(new Request('https://game.internal/api/me'), { invocationId: 'invocation-1' });

  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response), authContext);
  assert.deepEqual(sqlConfig, {
    server: env.SQL_SERVER_FQDN,
    database: env.SQL_DATABASE,
    credential,
  });
});

test('GET /api/me preserves 401 and 403 authentication responses', async () => {
  const { createMeHandler } = await loadMe();
  for (const statusCode of [401, 403]) {
    const handler = createMeHandler({
      env,
      credential: {},
      authenticate: async () => { throw Object.assign(new Error('safe'), { statusCode, code: 'auth_failed' }); },
      sqlPoolProvider: async () => assert.fail('SQL must not be touched before authentication succeeds'),
    });
    const response = await handler(new Request('https://game.internal/api/me'), { invocationId: 'invocation-auth' });
    assert.equal(response.status, statusCode);
  }
});

test('registerMeFunction binds the protected handler to the /api/me route', async () => {
  const { registerMeFunction } = await loadMe();
  let registration;
  registerMeFunction({ http: (name, options) => { registration = { name, options }; } }, {
    env,
    credential: {},
    authenticate: async () => authContext,
    sqlPoolProvider: async () => ({}),
  });
  assert.equal(registration.name, 'me');
  assert.deepEqual(registration.options.methods, ['GET']);
  assert.equal(registration.options.route, 'me');
  assert.equal(registration.options.authLevel, 'anonymous');
  assert.equal(typeof registration.options.handler, 'function');
});

test('configuration or SQL connection failures return a safe 500 with an error id', async () => {
  const { createMeHandler } = await loadMe();
  const logs = [];
  const context = { invocationId: 'safe-error-17', error: (message) => logs.push(message) };
  const missingConfig = createMeHandler({
    env: {},
    credential: {},
    authenticate: async (_request, config) => {
      assert.equal(config.tenantId, undefined);
      throw Object.assign(new Error('missing tenant'), { statusCode: 500, code: 'auth_configuration_missing' });
    },
    sqlPoolProvider: async () => assert.fail('SQL must not run when settings are missing'),
  });
  const missingResponse = await missingConfig(new Request('https://game.internal/api/me'), context);
  assert.equal(missingResponse.status, 500);
  assert.equal(parseBody(missingResponse).errorId, 'safe-error-17');

  const secretMarker = 'sql-token-secret-marker';
  const sqlFailure = createMeHandler({
    env,
    credential: {},
    authenticate: async () => authContext,
    sqlPoolProvider: async () => { throw new Error(secretMarker); },
  });
  const failedResponse = await sqlFailure(new Request('https://game.internal/api/me', {
    headers: { authorization: `Bearer ${secretMarker}` },
  }), context);
  assert.equal(failedResponse.status, 500);
  assert.equal(parseBody(failedResponse).errorId, 'safe-error-17');
  assert.equal(JSON.stringify(failedResponse).includes(secretMarker), false);
  assert.equal(logs.join('\n').includes(secretMarker), false);
});
