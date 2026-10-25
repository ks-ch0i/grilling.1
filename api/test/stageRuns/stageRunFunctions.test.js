import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityA, RUN_ID } from '../../test-support/stageRuns.js';

const env = {
  ENTRA_TENANT_ID: identityA.tenantId,
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};

async function loadStageRunFunctions() {
  try {
    return await import('../../src/functions/stageRuns.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected stage-run Functions module: ${error.message}`);
    throw error;
  }
}

function parseBody(response) {
  return JSON.parse(response.body);
}

async function createHandlers(overrides = {}) {
  const calls = { pools: [], start: [], submit: [], top: [], errors: [] };
  const dependencies = {
    env,
    credential: { getToken: async () => ({ token: 'unused' }) },
    authenticate: async () => identityA,
    sqlPoolProvider: async (config) => { calls.pools.push(config); return { id: 'pool' }; },
    clock: () => new Date('2026-10-21T02:01:00.000Z'),
    service: {
      startStageRun: async (_pool, user, body) => { calls.start.push({ user, body }); return { status: 201, ticket: { runId: RUN_ID } }; },
      submitStageResult: async (_pool, user, runId, body, receivedAtUtc) => {
        calls.submit.push({ user, runId, body, receivedAtUtc });
        return {
          status: 200,
          outcome: 'clear',
          clearTimeMs: 120000,
          bestChanged: true,
          verified: true,
          revision: 8,
          state: { schemaVersion: 2, gold: 25, progression: { unlockedStage: 2 } },
          rewards: { outcome: 'clear', xpGranted: 50, goldGranted: 25, drops: [] },
        };
      },
      getStageTopFive: async () => { calls.top.push(true); return [{ rank: 1, chapter: 1, stage: 1, clearTimeMs: 120000, displayName: 'Player A' }]; },
    },
    ...overrides,
  };
  const module = await loadStageRunFunctions();
  return { ...module.createStageRunHandlers(dependencies), calls, dependencies };
}

test('POST stage-runs issues a ticket for the authenticated account', async () => {
  const handlers = await createHandlers();
  const response = await handlers.start(new Request('https://game.internal/api/stage-runs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chapter: 1, stage: 1, expectedSaveRevision: 7 }),
  }));
  assert.equal(response.status, 201);
  assert.deepEqual(parseBody(response), { ticket: { runId: RUN_ID } });
  assert.equal(handlers.calls.start[0].user, identityA);
  assert.deepEqual(handlers.calls.start[0].body, { chapter: 1, stage: 1, expectedSaveRevision: 7 });
});

test('result endpoint forwards only the input log and server receive time', async () => {
  const handlers = await createHandlers();
  const response = await handlers.submit(new Request(`https://game.internal/api/stage-runs/${RUN_ID}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: [{ tick: 0, kind: 'move', value: 1 }] }),
  }), { params: { runId: RUN_ID } });
  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response), {
    outcome: 'clear', clearTimeMs: 120000, bestChanged: true, verified: true,
    revision: 8,
    state: { schemaVersion: 2, gold: 25, progression: { unlockedStage: 2 } },
    rewards: { outcome: 'clear', xpGranted: 50, goldGranted: 25, drops: [] },
  });
  assert.equal(handlers.calls.submit[0].runId, RUN_ID);
  assert.deepEqual(handlers.calls.submit[0].body, { inputs: [{ tick: 0, kind: 'move', value: 1 }] });
  assert.equal(handlers.calls.submit[0].receivedAtUtc.toISOString(), '2026-10-21T02:01:00.000Z');
});

test('result endpoint accepts zero to two valid level-up allocations and rejects legacy or malformed values before SQL', async () => {
  const handlers = await createHandlers();
  for (const value of [[], ['attack'], ['attack', 'defense']]) {
    const response = await handlers.submit(new Request(`https://game.internal/api/stage-runs/${RUN_ID}/result`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: [{ tick: 0, kind: 'levelUp', value }] }),
    }), { params: { runId: RUN_ID } });
    assert.equal(response.status, 200);
  }

  const invalidHandlers = await createHandlers({ sqlPoolProvider: async () => assert.fail('invalid allocation must not open SQL') });
  for (const value of ['attack', ['unknown'], ['attack', 'defense', 'maxHp']]) {
    const response = await invalidHandlers.submit(new Request(`https://game.internal/api/stage-runs/${RUN_ID}/result`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: [{ tick: 0, kind: 'levelUp', value }] }),
    }), { params: { runId: RUN_ID } });
    assert.equal(response.status, 400);
    assert.equal(parseBody(response).code, 'invalid-input-log');
  }
});

test('client-supplied result claims and oversized traces are rejected before SQL', async () => {
  const handlers = await createHandlers({
    sqlPoolProvider: async () => assert.fail('invalid result body must not open SQL'),
  });
  const spoofed = await handlers.submit(new Request(`https://game.internal/api/stage-runs/${RUN_ID}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: [], outcome: 'clear', elapsedMs: 1 }),
  }), { params: { runId: RUN_ID } });
  const oversized = await handlers.submit(new Request(`https://game.internal/api/stage-runs/${RUN_ID}/result`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ inputs: [], extra: 'x'.repeat(1024 * 1024) }),
  }), { params: { runId: RUN_ID } });
  assert.equal(spoofed.status, 400);
  assert.equal(parseBody(spoofed).code, 'invalid-input-log');
  assert.equal(oversized.status, 413);
  assert.equal(parseBody(oversized).code, 'result-too-large');
});

test('GET stage top-five returns public ranked fields and route registration is authenticated', async () => {
  const handlers = await createHandlers();
  const { createStageRankingHandler, registerRankingFunctions } = await import('../../src/functions/rankings.js');
  const top = createStageRankingHandler(handlers.dependencies);
  const response = await top(new Request('https://game.internal/api/rankings/stage/top'));
  assert.equal(response.status, 200);
  assert.deepEqual(parseBody(response).topFive, [{ rank: 1, chapter: 1, stage: 1, clearTimeMs: 120000, displayName: 'Player A' }]);
  assert.equal(parseBody(response).board, 'stage');
  assert.match(parseBody(response).revision, /^[0-9a-f]{64}$/);

  const { registerStageRunFunctions } = await loadStageRunFunctions();
  const routes = [];
  const app = { http: (name, options) => routes.push({ name, options }) };
  registerStageRunFunctions(app, {});
  registerRankingFunctions(app, {});
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['stage-runs', 'POST'],
    ['stage-runs/{runId}/result', 'POST'],
    ['rankings/stage/top', 'GET'],
    ['rankings/me', 'GET'],
  ]);
  assert.ok(routes.every(({ options }) => options.authLevel === 'anonymous'));
});
