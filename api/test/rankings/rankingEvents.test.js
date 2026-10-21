import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRankingSnapshot,
  createRankingEventsService,
  rankingUserId,
} from '../../src/services/rankingEvents.js';
import {
  createCurrentRankingHandler,
  registerRankingFunctions,
} from '../../src/functions/rankings.js';
import { createSignalRNegotiateHandler, registerSignalRFunction } from '../../src/functions/signalr.js';

const identity = {
  tenantId:'11111111-1111-4111-8111-111111111111',
  objectId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const env = {
  ENTRA_TENANT_ID:identity.tenantId,
  ENTRA_API_AUDIENCE:'api://knight-run-test',
  SIGNALR_SERVICE_ENDPOINT:'https://ranking-test.service.signalr.net',
  SIGNALR_HUB_NAME:'rankings',
  SQL_SERVER_FQDN:'knight-run.database.windows.net',
  SQL_DATABASE:'KnightRun',
};

function body(response) {
  return JSON.parse(response.body);
}

test('ranking snapshots have content revisions and expose only public top-five fields', () => {
  const source = [{ PlayerId:'private-guid', rank:4, displayName:'Knight', chapter:2, stage:5, clearTimeMs:12345 }];
  const first = buildRankingSnapshot('stage', source, new Date('2026-10-21T00:00:00.000Z'));
  const second = buildRankingSnapshot('stage', source, new Date('2026-10-22T00:00:00.000Z'));

  assert.equal(first.revision, second.revision);
  assert.deepEqual(first.topFive, [{ rank:1, displayName:'Knight', chapter:2, stage:5, clearTimeMs:12345 }]);
  assert.equal(JSON.stringify(first).includes('private-guid'), false);
  assert.equal(first.generatedAtUtc, '2026-10-21T00:00:00.000Z');
});

test('SignalR negotiation scopes user groups and publishers send only public board payloads', async () => {
  const calls = [];
  const credential = { getToken:async(scope) => { assert.equal(scope, 'https://signalr.azure.com/.default'); return { token:'management-token' }; } };
  const service = createRankingEventsService({
    env,
    credential,
    fetchImplementation:async(url, options) => {
      calls.push({ url:String(url), options });
      if (String(url).includes(':generateToken')) return new Response(JSON.stringify({ token:'client-only-token' }), { status:200 });
      return new Response(null, { status:202 });
    },
  });
  const negotiation = await service.negotiate(identity);
  const stageRows = [{ PlayerId:'private-guid', displayName:'Knight', rank:1, chapter:2, stage:5, clearTimeMs:12345 }];
  await service.publishTopFiveChanged({ board:'stage', topFive:stageRows, generatedAtUtc:'2026-10-21T00:00:00.000Z' });
  await service.publishPlayerRankChanged({ identity, board:'stage', generatedAtUtc:'2026-10-21T00:00:01.000Z' });

  assert.deepEqual(negotiation, {
    url:'https://ranking-test.service.signalr.net/client/?hub=rankings',
    accessToken:'client-only-token',
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(new URL(calls[0].url).searchParams.get('userId'), rankingUserId(identity));
  assert.equal(calls[0].url.includes(identity.objectId), false);
  assert.ok(calls.slice(1, 3).every(({ options, url }) => options.method === 'PUT' && url.includes('/users/') && url.includes('/groups/ranking%3A')));
  const topCall = calls[3];
  const topPayload = JSON.parse(topCall.options.body);
  assert.match(topCall.url, /\/groups\/ranking%3Astage\/:send/);
  assert.equal(topPayload.target, 'stageTopChanged');
  assert.deepEqual(topPayload.arguments[0].topFive, [{ rank:1, displayName:'Knight', chapter:2, stage:5, clearTimeMs:12345 }]);
  assert.equal(JSON.stringify(topPayload).includes('private-guid'), false);
  const playerPayload = JSON.parse(calls[4].options.body);
  assert.equal(playerPayload.target, 'playerRankChanged');
  assert.deepEqual(playerPayload.arguments[0], { board:'stage', generatedAtUtc:'2026-10-21T00:00:01.000Z' });
});

test('GET /rankings/me returns the authenticated account ranks only', async () => {
  const calls = [];
  const handler = createCurrentRankingHandler({
    env,
    authenticate:async() => identity,
    sqlPoolProvider:async(config) => { calls.push(config); return { id:'sql' }; },
    stageService:{ getPlayerRank:async(pool, user) => { assert.equal(pool.id, 'sql'); assert.equal(user, identity); return { rank:8, chapter:2, stage:3, clearTimeMs:32000 }; } },
    pvpService:{ getPlayerRank:async(pool, user) => { assert.equal(pool.id, 'sql'); assert.equal(user, identity); return { rank:12, rating:1042 }; } },
  });
  const response = await handler(new Request('https://game.internal/api/rankings/me'));

  assert.equal(response.status, 200);
  assert.deepEqual(body(response), {
    stage:{ rank:8, chapter:2, stage:3, clearTimeMs:32000 },
    pvp:{ rank:12, rating:1042 },
  });
  assert.equal(calls.length, 1);
});

test('SignalR negotiate authenticates before issuing a per-user token and registers the protected route', async () => {
  const unauthorized = createSignalRNegotiateHandler({
    env,
    authenticate:async() => { throw Object.assign(new Error(), { statusCode:401 }); },
    service:{ negotiate:async() => assert.fail('unauthorized user must not negotiate') },
  });
  assert.equal((await unauthorized(new Request('https://game.internal/api/signalr/negotiate', { method:'POST' }))).status, 401);

  const allowed = createSignalRNegotiateHandler({ env, authenticate:async() => identity,
    service:{ negotiate:async(user) => { assert.equal(user, identity); return { url:'https://signalr/client', accessToken:'user-token' }; } },
  });
  const response = await allowed(new Request('https://game.internal/api/signalr/negotiate', { method:'POST' }));
  assert.equal(response.status, 200);
  assert.deepEqual(body(response), { url:'https://signalr/client', accessToken:'user-token' });

  const routes = [];
  const app = { http:(name, options) => routes.push({ name, options }) };
  registerSignalRFunction(app, {});
  registerRankingFunctions(app, {});
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['signalr/negotiate', 'POST'],
    ['rankings/stage/top', 'GET'],
    ['rankings/me', 'GET'],
  ]);
  assert.ok(routes.every(({ options }) => options.authLevel === 'anonymous'));
});
