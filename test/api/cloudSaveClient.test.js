import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudSaveClient, CloudSaveAuthenticationError } from '../../src/api/cloudSaveClient.js';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', localAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

test('cloud save client sends a bearer token and preserves the server envelope', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl: '/api/',
    getAccessToken: async (user) => { assert.equal(user, account); return 'access-token'; },
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ schemaVersion: 1, revision: 6, state: { player: { level: 4 } } }), { status: 200 });
    },
  });
  const result = await client.getCurrent(account);

  assert.equal(result.status, 200);
  assert.equal(result.envelope.revision, 6);
  assert.equal(calls[0].url, '/api/saves/current');
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-token');
});

test('conditional writes use If-Match or If-None-Match and only send the schema v1 state DTO', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl: '/api',
    getAccessToken: async () => 'access-token',
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ schemaVersion: 1, revision: calls.length, state: {} }), { status: 200 });
    },
  });
  const state = { schemaVersion: 1, player: { level: 3 } };
  await client.putCurrent(account, { state, clientRating: 99999 }, { kind: 'update', expectedRevision: 5 });
  await client.putCurrent(account, { state }, { kind: 'create' });

  assert.equal(calls[0].options.headers['if-match'], '"5"');
  assert.equal(calls[1].options.headers['if-none-match'], '*');
  assert.deepEqual(JSON.parse(calls[0].options.body), { schemaVersion: 1, state });
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-token');
});

test('token acquisition failures stay distinct from network failures', async () => {
  const client = createCloudSaveClient({
    getAccessToken: async () => { throw new TypeError('interaction required'); },
    fetchImplementation: async () => assert.fail('fetch must not run when token acquisition fails'),
  });
  await assert.rejects(() => client.getCurrent(account), CloudSaveAuthenticationError);
});
