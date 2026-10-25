import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityA, MATCH_A } from '../../test-support/pvp.js';

const env = {
  ENTRA_TENANT_ID: identityA.tenantId,
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};

async function loadFunctions() {
  const [snapshotModule, matchesModule] = await Promise.all([
    import('../../src/functions/playerSnapshots.js'),
    import('../../src/functions/pvpMatches.js'),
  ]);
  return { ...snapshotModule, ...matchesModule };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

async function makeHandlers(overrides = {}) {
  const calls = { pools: [], snapshots: [], searches: [], results: [], top: [], history: [], errors: [] };
  const dependencies = {
    env,
    credential: { getToken: async () => ({ token: 'unused' }) },
    authenticate: async () => identityA,
    sqlPoolProvider: async () => { calls.pools.push(true); return { id: 'pool' }; },
    clock: () => new Date('2026-10-21T02:01:00.000Z'),
    snapshotService: {
      publishSnapshot: async (_pool, user, body) => {
        calls.snapshots.push({ user, body });
        return { status: 200, changed: true, snapshot: { revision: 1 } };
      },
    },
    matchmakingService: {
      findOpponent: async (_pool, user, body) => {
        calls.searches.push({ user, body });
        return { status: 201, ticket: { matchId: MATCH_A } };
      },
    },
    resultService: {
      submitPvpResult: async (_pool, user, matchId, body, receivedAtUtc) => {
        calls.results.push({ user, matchId, body, receivedAtUtc });
        return { status: 200, outcome: 'win', rated: true };
      },
      getPlayerMatchHistory: async (_pool, user, page) => {
        calls.history.push({ user, page });
        return { status: 200, page, pageSize: 10, hasPrevious: page > 1, hasNext: false, items: [] };
      },
      getPvpTopFive: async () => { calls.top.push(true); return [{ rank: 1, rating: 1016 }]; },
    },
    ...overrides,
  };
  const module = await loadFunctions();
  return {
    snapshot: module.createPlayerSnapshotHandler(dependencies),
    ...module.createPvpMatchHandlers(dependencies),
    calls,
    dependencies,
  };
}

test('PUT snapshot and POST search bind requests to the authenticated account', async () => {
  const handlers = await makeHandlers();
  const snapshot = await handlers.snapshot(new Request('https://game.internal/api/pvp/snapshot', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedSaveRevision: 7 }),
  }));
  const search = await handlers.search(new Request('https://game.internal/api/pvp/matches/search', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  }));

  assert.equal(snapshot.status, 200);
  assert.equal(search.status, 201);
  assert.deepEqual(handlers.calls.snapshots[0], { user: identityA, body: { expectedSaveRevision: 7 } });
  assert.deepEqual(handlers.calls.searches[0], { user: identityA, body: {} });
  assert.equal(handlers.calls.pools.length, 2);
});

test('result endpoint forwards only input events and the server receive time', async () => {
  const handlers = await makeHandlers();
  const response = await handlers.submit(new Request(`https://game.internal/api/pvp/matches/${MATCH_A}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: [{ tick: 0, kind: 'move', value: 1 }] }),
  }), { params: { matchId: MATCH_A } });

  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response), { outcome: 'win', rated: true });
  assert.deepEqual(handlers.calls.results[0], {
    user: identityA,
    matchId: MATCH_A,
    body: { inputs: [{ tick: 0, kind: 'move', value: 1 }] },
    receivedAtUtc: new Date('2026-10-21T02:01:00.000Z'),
  });
});

test('spoofed result claims, oversized bodies and invalid searches stop before opening SQL', async () => {
  const handlers = await makeHandlers({ sqlPoolProvider: async () => assert.fail('invalid input must not open SQL') });
  const spoofed = await handlers.submit(new Request(`https://game.internal/api/pvp/matches/${MATCH_A}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: [], outcome: 'win', playerRatingAfter: 999999 }),
  }));
  const oversized = await handlers.submit(new Request(`https://game.internal/api/pvp/matches/${MATCH_A}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inputs: [], pad: 'x'.repeat(1024 * 1024) }),
  }));
  const invalidSearch = await handlers.search(new Request('https://game.internal/api/pvp/matches/search', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 5000 }),
  }));

  assert.equal(spoofed.status, 400);
  assert.equal(parseBody(spoofed).code, 'invalid-input-log');
  assert.equal(oversized.status, 413);
  assert.equal(parseBody(oversized).code, 'result-too-large');
  assert.equal(invalidSearch.status, 400);
  assert.equal(parseBody(invalidSearch).code, 'invalid-match-search');
});

test('PvP HTTP routes register with the expected methods and paths', async () => {
  const { registerPlayerSnapshotFunction, registerPvpMatchFunctions } = await loadFunctions();
  const routes = [];
  const app = { http: (name, options) => routes.push({ name, options }) };
  registerPlayerSnapshotFunction(app, {});
  registerPvpMatchFunctions(app, {});
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['pvp/snapshot', 'PUT'],
    ['pvp/matches/search', 'POST'],
    ['pvp/matches/{matchId}/result', 'POST'],
    ['pvp/matches/history', 'GET'],
    ['rankings/pvp/top', 'GET'],
  ]);
  assert.ok(routes.every(({ options }) => options.authLevel === 'anonymous'));
});

test('match history authenticates before opening SQL and supports the default and requested pages', async () => {
  const handlers = await makeHandlers();
  const firstPage = await handlers.history(new Request('https://game.internal/api/pvp/matches/history'));
  const secondPage = await handlers.history(new Request('https://game.internal/api/pvp/matches/history?page=2'));

  assert.equal(firstPage.status, 200);
  assert.deepEqual(parseBody(firstPage), {
    page: 1, pageSize: 10, hasPrevious: false, hasNext: false, items: [],
  });
  assert.deepEqual(parseBody(secondPage), {
    page: 2, pageSize: 10, hasPrevious: true, hasNext: false, items: [],
  });
  assert.deepEqual(handlers.calls.history, [
    { user: identityA, page: 1 },
    { user: identityA, page: 2 },
  ]);
  assert.equal(handlers.calls.pools.length, 2);
});

test('invalid match-history pages return 400 before opening SQL', async () => {
  const handlers = await makeHandlers({ sqlPoolProvider: async () => assert.fail('invalid page must not open SQL') });
  for (const query of ['?page=0', '?page=01', '?page=1.0', '?page=100001', '?page=1&page=2']) {
    const response = await handlers.history(new Request(`https://game.internal/api/pvp/matches/history${query}`));
    assert.equal(response.status, 400);
    assert.deepEqual(parseBody(response), { code: 'invalid-history-page' });
  }
  assert.equal(handlers.calls.pools.length, 0);
});

test('match history preserves auth and transient SQL error handling without exposing details', async () => {
  const unauthorized = await makeHandlers({
    authenticate: async () => { throw Object.assign(new Error('invalid token'), { statusCode: 401 }); },
    sqlPoolProvider: async () => assert.fail('unauthenticated history must not open SQL'),
  });
  const unauthorizedResponse = await unauthorized.history(new Request('https://game.internal/api/pvp/matches/history?page=1'));
  assert.equal(unauthorizedResponse.status, 401);
  assert.deepEqual(parseBody(unauthorizedResponse), { error: 'unauthorized' });
  assert.equal(unauthorized.calls.pools.length, 0);

  const transient = await makeHandlers({
    resultService: {
      getPlayerMatchHistory: async () => { throw Object.assign(new Error('database-secret-detail'), { code: 'ETIMEOUT' }); },
    },
  });
  const transientResponse = await transient.history(new Request('https://game.internal/api/pvp/matches/history?page=1'));
  assert.equal(transientResponse.status, 503);
  assert.deepEqual(Object.keys(parseBody(transientResponse)).sort(), ['error', 'errorId']);
  assert.doesNotMatch(transientResponse.body, /database-secret-detail/);
  assert.equal(transient.calls.pools.length, 1);
});

test('PvP top-five returns a revisioned public snapshot envelope', async () => {
  const handlers = await makeHandlers();
  const response = await handlers.topFive(new Request('https://game.internal/api/rankings/pvp/top'));

  assert.equal(response.status, 200);
  const ranking = parseBody(response);
  assert.equal(ranking.board, 'pvp');
  assert.match(ranking.revision, /^[0-9a-f]{64}$/);
  assert.deepEqual(ranking.topFive, [{ rank:1, displayName:null, rating:1016 }]);
  assert.equal(handlers.calls.pools.length, 1);
});
