import assert from 'node:assert/strict';
import { test } from 'node:test';

const env = {
  ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};
const user = { tenantId: env.ENTRA_TENANT_ID, objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const body = {
  actionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  expectedSaveRevision: 3,
  action: { type: 'spend-gold', amount: 50 },
};

async function loadFunction() {
  return import('../../src/functions/profileActions.js');
}

test('POST profile action authenticates, passes the canonical command and returns the result envelope', async () => {
  const { createProfileActionHandlers } = await loadFunction();
  const calls = { pool: [], service: [] };
  const handlers = createProfileActionHandlers({
    env,
    credential: { getToken: async () => ({ token: 'unused' }) },
    authenticate: async (_request, config) => {
      assert.equal(config.tenantId, env.ENTRA_TENANT_ID);
      return user;
    },
    sqlPoolProvider: async (config) => { calls.pool.push(config); return { id: 'pool' }; },
    service: { applyProfileAction: async (pool, identity, request) => {
      calls.service.push({ pool, identity, request });
      return { status: 200, revision: 4, appliedRevision: 4, state: { gold: 0 }, replayed: false };
    } },
  });
  const response = await handlers.post(new Request('https://game.internal/api/profile/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    revision: 4, appliedRevision: 4, state: { gold: 0 }, replayed: false,
  });
  assert.equal(calls.service[0].identity, user);
  assert.deepEqual(calls.service[0].request, body);
  assert.equal(calls.pool.length, 1);
});

test('invalid requests and authentication failures do not open SQL', async () => {
  const { createProfileActionHandlers } = await loadFunction();
  const handlers = createProfileActionHandlers({
    env,
    authenticate: async () => user,
    sqlPoolProvider: async () => assert.fail('invalid action must not open SQL'),
    service: { applyProfileAction: async () => assert.fail('invalid action must not reach the service') },
  });
  const invalid = await handlers.post(new Request('https://game.internal/api/profile/actions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, action: { type: 'grant-gold', amount: 500 } }),
  }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(JSON.parse(invalid.body), { code: 'invalid-action' });

  const unauthorized = createProfileActionHandlers({
    env,
    authenticate: async () => { throw Object.assign(new Error('token'), { statusCode: 401 }); },
    sqlPoolProvider: async () => assert.fail('unauthorized requests must not open SQL'),
  });
  const response = await unauthorized.post(new Request('https://game.internal/api/profile/actions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  assert.equal(response.status, 401);
  assert.deepEqual(JSON.parse(response.body), { error: 'unauthorized' });
});

test('registers POST /profile/actions', async () => {
  const { registerProfileActionFunction } = await loadFunction();
  const routes = [];
  registerProfileActionFunction({ http: (name, options) => routes.push({ name, options }) }, {
    env, credential: {}, authenticate: async () => user, sqlPoolProvider: async () => ({}),
    service: { applyProfileAction: async () => ({ status: 404, code: 'profile-not-found' }) },
  });
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['profile/actions', 'POST'],
  ]);
  assert.equal(routes[0].options.authLevel, 'anonymous');
});
