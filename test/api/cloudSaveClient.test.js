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

test('stage ticket and result calls use the signed-in account and exact API payloads', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl: '/api/',
    getAccessToken: async (user) => { assert.equal(user, account); return 'rank-token'; },
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ verified: true }), { status: 200 });
    },
  });
  const runId = 'aaaaaaaa-1111-4111-8111-111111111111';
  await client.startStageRun(account, { chapter: 1, stage: 2, expectedSaveRevision: 7 });
  await client.submitStageResult(account, runId, { inputs: [{ tick: 0, kind: 'move', value: 1 }] });

  assert.equal(calls[0].url, '/api/stage-runs');
  assert.equal(calls[1].url, `/api/stage-runs/${runId}/result`);
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { chapter: 1, stage: 2, expectedSaveRevision: 7 });
  assert.deepEqual(JSON.parse(calls[1].options.body), { inputs: [{ tick: 0, kind: 'move', value: 1 }] });
  assert.equal(calls[1].options.headers.authorization, 'Bearer rank-token');
  assert.equal(calls[1].options.headers['content-type'], 'application/json');
});

test('PvP snapshot, search and result calls use their exact API routes and DTOs', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl:'/api/',
    getAccessToken:async() => 'pvp-token',
    fetchImplementation:async(url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ status:'ok' }), { status:200 });
    },
  });
  const matchId = '11111111-1111-4111-8111-111111111111';
  await client.publishPvpSnapshot(account, { expectedSaveRevision:9 });
  await client.searchPvpMatch(account, {});
  await client.submitPvpResult(account, matchId, { inputs:[] });

  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/pvp/snapshot',
    '/api/pvp/matches/search',
    `/api/pvp/matches/${matchId}/result`,
  ]);
  assert.deepEqual(calls.map(({ options }) => options.method), ['PUT', 'POST', 'POST']);
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body)), [
    { expectedSaveRevision:9 }, {}, { inputs:[] },
  ]);
  assert.equal(calls[0].options.headers.authorization, 'Bearer pvp-token');
  await assert.rejects(() => client.submitPvpResult(account, '', { inputs:[] }), TypeError);
});
