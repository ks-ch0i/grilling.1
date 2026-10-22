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
      return new Response(JSON.stringify({ schemaVersion: 2, revision: 6, state: { schemaVersion:2, player: { level: 4 } } }), { status: 200 });
    },
  });
  const result = await client.getCurrent(account);

  assert.equal(result.status, 200);
  assert.equal(result.envelope.revision, 6);
  assert.equal(calls[0].url, '/api/saves/current');
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-token');
});

test('conditional writes use If-Match or If-None-Match and only send the schema v2 state DTO', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl: '/api',
    getAccessToken: async () => 'access-token',
    fetchImplementation: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ schemaVersion: 2, revision: calls.length, state: { schemaVersion:2 } }), { status: 200 });
    },
  });
  const state = { schemaVersion: 2, player: { level: 3 } };
  await client.putCurrent(account, { state, clientRating: 99999 }, { kind: 'update', expectedRevision: 5 });
  await client.putCurrent(account, { state }, { kind: 'create' });

  assert.equal(calls[0].options.headers['if-match'], '"5"');
  assert.equal(calls[1].options.headers['if-none-match'], '*');
  assert.deepEqual(JSON.parse(calls[0].options.body), { schemaVersion: 2, state });
  assert.equal(calls[0].options.headers.authorization, 'Bearer access-token');
});

test('cloud save client rejects a legacy nested state before authentication or fetch', async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const client = createCloudSaveClient({
    getAccessToken: async () => { tokenCalls += 1; return 'access-token'; },
    fetchImplementation: async () => { fetchCalls += 1; return new Response('{}', { status: 201 }); },
  });

  await assert.rejects(
    () => client.putCurrent(account, { state: { schemaVersion: 1 } }, { kind: 'create' }),
    /schemaVersion 2/i,
  );
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
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

test('ranking snapshot and account rank reads use authenticated GET requests', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl:'/api/',
    getAccessToken:async() => 'rank-token',
    fetchImplementation:async(url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ board:'stage', revision:'stable-hash', topFive:[] }), { status:200 });
    },
  });
  const stage = await client.getRankingTop(account, 'stage');
  const pvp = await client.getRankingTop(account, 'pvp');
  const me = await client.getMyRanks(account);

  assert.deepEqual(calls.map(({ url }) => url), ['/api/rankings/stage/top', '/api/rankings/pvp/top', '/api/rankings/me']);
  assert.ok(calls.every(({ options }) => options.method === undefined));
  assert.ok(calls.every(({ options }) => options.headers.authorization === 'Bearer rank-token'));
  assert.equal(stage.revision, 'stable-hash');
  assert.equal(pvp.status, 200);
  assert.equal(me.board, 'stage');
  await assert.rejects(() => client.getRankingTop(account, 'private'), TypeError);
});
