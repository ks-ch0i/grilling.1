import assert from 'node:assert/strict';
import { createInitialState } from '../../../src/game/domain/gear.js';
import { test } from 'node:test';

let itemId = 0;
const makeState = () => createInitialState(() => `cloud-${++itemId}`);
const makeBody = () => ({ schemaVersion: 1, state: makeState() });
const env = {
  ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};
const userA = {
  tenantId: env.ENTRA_TENANT_ID,
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Player A',
};
const envelope = {
  schemaVersion: 1,
  revision: 2,
  updatedAtUtc: '2026-10-21T02:00:00.000Z',
  state: makeState(),
};

async function loadCloudSaveFunction() {
  try {
    return await import('../../src/functions/cloudSave.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the cloud-save Functions module to exist: ${error.message}`);
    }
    throw error;
  }
}

function parseBody(response) {
  return JSON.parse(response.body);
}

function handlerWith(overrides = {}) {
  const calls = { users: [], poolConfigs: [], service: [] };
  const credential = { getToken: async () => ({ token: 'unused' }) };
  const dependencies = {
    env,
    credential,
    authenticate: async () => userA,
    sqlPoolProvider: async (config) => { calls.poolConfigs.push(config); return { id: 'pool' }; },
    service: {
      getCurrent: async (_pool, user) => {
        calls.users.push(user);
        return { status: 200, envelope };
      },
      putCurrent: async (_pool, user, body, precondition) => {
        calls.service.push({ user, body, precondition });
        return { status: 201, envelope };
      },
    },
    ...overrides,
  };
  return loadCloudSaveFunction().then(({ createCloudSaveHandlers }) => ({
    handlers: createCloudSaveHandlers(dependencies),
    calls,
    credential,
  }));
}

test('GET returns the authenticated account save and a revision ETag', async () => {
  const { handlers, calls, credential } = await handlerWith();
  const response = await handlers.get(new Request('https://game.internal/api/saves/current'));

  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response), envelope);
  assert.equal(response.headers.etag, '"2"');
  assert.equal(calls.users[0], userA);
  assert.deepEqual(calls.poolConfigs[0], {
    server: env.SQL_SERVER_FQDN,
    database: env.SQL_DATABASE,
    credential,
  });
});

test('PUT uses If-None-Match for first save and If-Match for a revision update', async () => {
  const { handlers, calls } = await handlerWith();
  const initial = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-none-match': '*', 'authorization': 'Bearer fake' },
    body: JSON.stringify(makeBody()),
  }));
  const update = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"2"' },
    body: JSON.stringify(makeBody()),
  }));

  assert.equal(initial.status, 201);
  assert.equal(update.status, 201);
  assert.equal(initial.headers.etag, '"2"');
  assert.deepEqual(calls.service[0].precondition, { kind: 'create' });
  assert.deepEqual(calls.service[1].precondition, { kind: 'update', expectedRevision: 2 });
  assert.equal(calls.service[0].user, userA);
  assert.equal(Object.hasOwn(calls.service[0].body, 'playerId'), false);
});

test('missing save, invalid JSON and oversized payload have distinct HTTP results', async () => {
  const missingSave = await handlerWith({
    service: {
      getCurrent: async () => ({ status: 404, code: 'save-not-found' }),
      putCurrent: async () => assert.fail('invalid payload must not reach the service'),
    },
  });
  const missing = await missingSave.handlers.get(new Request('https://game.internal/api/saves/current'));
  const { handlers, calls } = await handlerWith({
    sqlPoolProvider: async () => assert.fail('invalid payload must not open SQL'),
    service: { getCurrent: async () => ({}), putCurrent: async () => assert.fail('invalid payload must not reach the service') },
  });
  const invalidJson = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT', headers: { 'if-none-match': '*', 'content-type': 'application/json' }, body: '{invalid',
  }));
  const oversized = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT',
    headers: { 'if-none-match': '*', 'content-type': 'application/json' },
    body: JSON.stringify({ schemaVersion: 1, state: makeState(), extra: 'x'.repeat(256 * 1024) }),
  }));

  assert.equal(missing.status, 404);
  assert.deepEqual(parseBody(missing), { code: 'save-not-found' });
  assert.equal(invalidJson.status, 400);
  assert.equal(parseBody(invalidJson).code, 'invalid-json');
  assert.equal(oversized.status, 413);
  assert.equal(parseBody(oversized).code, 'save-too-large');
  assert.equal(calls.poolConfigs.length, 0);
});

test('invalid save values and missing preconditions are rejected before SQL', async () => {
  const { handlers } = await handlerWith({
    sqlPoolProvider: async () => assert.fail('invalid save must not open SQL'),
    service: { getCurrent: async () => ({}), putCurrent: async () => assert.fail('invalid save must not reach service') },
  });
  const invalid = makeBody();
  invalid.state.player.currentHp = Infinity;
  const invalidResponse = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT', headers: { 'if-none-match': '*' }, body: JSON.stringify(invalid),
  }));
  const missingCondition = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeBody()),
  }));

  assert.equal(invalidResponse.status, 400);
  assert.equal(parseBody(invalidResponse).code, 'invalid-save');
  assert.equal(missingCondition.status, 428);
  assert.equal(parseBody(missingCondition).code, 'precondition-required');
});

test('invalid ETags are rejected without opening SQL', async () => {
  const { handlers } = await handlerWith({
    sqlPoolProvider: async () => assert.fail('invalid precondition must not open SQL'),
  });
  const response = await handlers.put(new Request('https://game.internal/api/saves/current', {
    method: 'PUT', headers: { 'if-match': 'W/"2"' }, body: JSON.stringify(makeBody()),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(parseBody(response), { code: 'invalid-precondition' });
});

test('auth failures preserve 401/403 and SQL transient failures return a safe 503', async () => {
  const unauthorized = await handlerWith({
    authenticate: async () => { throw Object.assign(new Error('token'), { statusCode: 401 }); },
    sqlPoolProvider: async () => assert.fail('unauthorized request must not open SQL'),
  });
  const forbidden = await handlerWith({
    authenticate: async () => { throw Object.assign(new Error('tenant'), { statusCode: 403 }); },
    sqlPoolProvider: async () => assert.fail('forbidden request must not open SQL'),
  });
  const transient = await handlerWith({
    sqlPoolProvider: async () => { throw Object.assign(new Error('secret token'), { code: 'ETIMEOUT' }); },
  });
  const request = new Request('https://game.internal/api/saves/current');
  assert.equal((await unauthorized.handlers.get(request)).status, 401);
  assert.equal((await forbidden.handlers.get(request)).status, 403);
  const logs = [];
  const unavailable = await transient.handlers.get(request, { invocationId: 'safe-23', error: (message) => logs.push(message) });
  assert.equal(unavailable.status, 503);
  assert.equal(parseBody(unavailable).errorId, 'safe-23');
  assert.equal(JSON.stringify(unavailable).includes('secret token'), false);
  assert.equal(logs.join('\n').includes('secret token'), false);
});

test('registers the current-save GET and PUT routes', async () => {
  const { registerCloudSaveFunctions } = await loadCloudSaveFunction();
  const routes = [];
  registerCloudSaveFunctions({ http: (name, options) => routes.push({ name, options }) }, {
    env,
    credential: {},
    authenticate: async () => userA,
    sqlPoolProvider: async () => ({}),
    service: { getCurrent: async () => ({}), putCurrent: async () => ({}) },
  });
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['saves/current', 'GET'],
    ['saves/current', 'PUT'],
  ]);
  assert.ok(routes.every(({ options }) => options.authLevel === 'anonymous'));
});
