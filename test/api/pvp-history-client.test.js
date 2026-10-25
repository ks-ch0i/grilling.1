import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCloudSaveClient } from '../../src/api/cloudSaveClient.js';

const account = { tenantId:'11111111-1111-4111-8111-111111111111', localAccountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };

test('PvP match history uses the authenticated GET route and returns the page envelope', async () => {
  const calls = [];
  const client = createCloudSaveClient({
    apiBaseUrl:'/api/',
    getAccessToken:async (user) => { assert.equal(user, account); return 'history-token'; },
    fetchImplementation:async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ page:2, pageSize:10, hasPrevious:true, hasNext:false, items:[] }), { status:200 });
    },
  });
  const result = await client.getPvpMatchHistory(account, 2);

  assert.equal(calls[0].url, '/api/pvp/matches/history?page=2');
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.headers.authorization, 'Bearer history-token');
  assert.deepEqual(result, { status:200, page:2, pageSize:10, hasPrevious:true, hasNext:false, items:[] });
});

test('PvP match history rejects invalid pages before token acquisition or fetch', async () => {
  let tokenCalls = 0;
  let fetchCalls = 0;
  const client = createCloudSaveClient({
    getAccessToken:async () => { tokenCalls += 1; return 'history-token'; },
    fetchImplementation:async () => { fetchCalls += 1; return new Response('{}', { status:200 }); },
  });

  for (const page of [0, 1.5, 100_001, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(() => client.getPvpMatchHistory(account, page), TypeError);
  }
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});
