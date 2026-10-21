import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFixedStepAccumulator,
  createRankedRunClient,
  createRunInputRecorder,
  deriveRankedPlayerSnapshot,
  requestStageTicket,
} from '../src/game/domain/rankedRunClient.js';

function gameState(overrides = {}) {
  return {
    schemaVersion: 1,
    player: {
      level: 1,
      xp: 0,
      xpToNext: 100,
      pendingLevelUps: 0,
      currentHp: 80,
      baseStats: { maxHp: 100, attack: 10, defense: 5, critChance: 0.05, critMultiplier: 2, moveSpeed: 200 },
    },
    equipment: {},
    progression: { clearedStageIds: [] },
    ...overrides,
  };
}

function ticketFor(state, overrides = {}) {
  return {
    runId: 'aaaaaaaa-1111-4111-8111-111111111111',
    chapter: 1,
    stage: 1,
    seed: 123456,
    simulatorVersion: 1,
    balanceVersion: 1,
    issuedAtUtc: '2026-10-21T00:00:00.000Z',
    expiresAtUtc: '2026-10-21T00:30:00.000Z',
    playerSnapshot: deriveRankedPlayerSnapshot(state, 1, 1),
    ...overrides,
  };
}

test('requestStageTicket sends the cloud revision in the API contract', async () => {
  const calls = [];
  const result = await requestStageTicket({
    startStageRun: async (...args) => { calls.push(args); return { status: 201, ticket: { runId: 'run' } }; },
  }, { chapter: 2, stage: 4, saveRevision: 9, account: { username: 'player' } });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [[{ username: 'player' }, { chapter: 2, stage: 4, expectedSaveRevision: 9 }]]);
});

test('ranked snapshot includes derived combat stats and saved level progression', () => {
  const state = gameState({
    player: { ...gameState().player, level: 3, xp: 26, xpToNext: 144 },
    progression: { clearedStageIds: ['1-2'] },
  });
  assert.deepEqual(deriveRankedPlayerSnapshot(state, 1, 2), {
    maxHp: 100, currentHp: 80, attack: 10, defense: 5,
    critChance: 0.05, critMultiplier: 2, moveSpeed: 200, effects: [],
    level: 3, xp: 26, xpToNext: 144, pendingLevelUps: 0, replayXpMultiplier: 0.3,
  });
});

test('offline ticket preparation keeps the run local and does not call ranking APIs', async () => {
  let requests = 0;
  const client = createRankedRunClient({
    apiClient: { startStageRun: async () => { requests += 1; } },
    account: {},
    getSaveRevision: () => 1,
    getCurrentState: () => gameState(),
    getMode: () => 'online',
    syncPendingSave: async () => ({ ok: true }),
    isOnline: () => false,
  });

  assert.deepEqual(await client.prepareStage({ chapter: 1, stage: 1, gameState: gameState() }), {
    ranked: false, reason: 'offline',
  });
  assert.equal(requests, 0);
});

test('ticket preparation syncs the save before requesting the ranked ticket', async () => {
  const state = gameState();
  const calls = [];
  let synced = false;
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async (...args) => { calls.push(['ticket', ...args]); return { status: 201, ticket: ticketFor(state) }; },
      submitStageResult: async (...args) => { calls.push(['result', ...args]); return { status: 422, code: 'run-not-cleared' }; },
    },
    account: { username: 'player' },
    getSaveRevision: () => 7,
    getCurrentState: () => state,
    getMode: () => 'online',
    syncPendingSave: async () => { calls.push(['sync']); synced = true; return { ok: true }; },
    isOnline: () => true,
    now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal(result.ranked, true);
  assert.equal(synced, true);
  assert.deepEqual(calls, [
    ['sync'],
    ['ticket', { username: 'player' }, { chapter: 1, stage: 1, expectedSaveRevision: 7 }],
  ]);
});

test('a cached offline save refreshes its cloud revision before requesting a ticket after reconnect', async () => {
  const state = gameState();
  let mode = 'offline';
  const client = createRankedRunClient({
    apiClient: { startStageRun: async () => ({ status: 201, ticket: ticketFor(state) }) },
    account: {}, getSaveRevision: () => 7, getCurrentState: () => state, getMode: () => mode,
    syncPendingSave: async () => ({ ok: true }),
    refreshAccountSave: async () => { mode = 'online'; return { status: 'ready', mode }; },
    isOnline: () => true, now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal(result.ranked, true);
});

test('snapshot mismatch closes the first ticket, syncs, and retries once', async () => {
  const state = gameState();
  const badTicket = ticketFor(state, { playerSnapshot: { ...deriveRankedPlayerSnapshot(state, 1, 1), attack: 999 } });
  const calls = [];
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async () => {
        calls.push('ticket');
        return { status: 201, ticket: calls.filter((entry) => entry === 'ticket').length === 1 ? badTicket : ticketFor(state) };
      },
      submitStageResult: async (_account, runId, body) => { calls.push(['abandon', runId, body]); return { status: 422 }; },
    },
    account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'online',
    syncPendingSave: async () => { calls.push('sync'); return { ok: true }; },
    isOnline: () => true, now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal(result.ranked, true);
  assert.deepEqual(calls, [
    'sync', 'ticket',
    ['abandon', badTicket.runId, { inputs: [] }],
    'sync', 'ticket',
  ]);
});

test('a failed attempt closes its ticket before a retry can request a fresh snapshot', async () => {
  const state = gameState();
  const calls = [];
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async () => { calls.push('ticket'); return { status: 201, ticket: ticketFor(state) }; },
      submitStageResult: async (_account, runId, body) => {
        calls.push(['abandon', runId, body]);
        return { status: 422, code: 'run-not-cleared' };
      },
    },
    account: {}, getSaveRevision: () => 9, getCurrentState: () => state, getMode: () => 'online',
    syncPendingSave: async () => ({ ok: true }), isOnline: () => true,
    now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const first = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal(await client.abandonRun(first.ticket), true);
  const second = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal(second.ranked, true);
  assert.deepEqual(calls, [
    'ticket',
    ['abandon', first.ticket.runId, { inputs: [] }],
    'ticket',
  ]);
});

test('ticket request failures, expired tickets, and a second snapshot mismatch stay unranked', async (t) => {
  const state = gameState();
  for (const scenario of [
    { name: 'revision conflict', response: { status: 409, code: 'save-revision-conflict' } },
    { name: 'ticket expired', response: { status: 201, ticket: ticketFor(state, { expiresAtUtc: '2026-10-20T23:59:00.000Z' }) } },
    { name: 'snapshot mismatch', response: { status: 201, ticket: ticketFor(state, { playerSnapshot: { ...deriveRankedPlayerSnapshot(state, 1, 1), attack: 999 } }) } },
  ]) {
    await t.test(scenario.name, async () => {
      const client = createRankedRunClient({
        apiClient: {
          startStageRun: async () => scenario.response,
          submitStageResult: async () => ({ status: 422 }),
        },
        account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'online',
        syncPendingSave: async () => ({ ok: true }), isOnline: () => true,
        now: () => new Date('2026-10-21T00:01:00.000Z'),
      });
      const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
      assert.equal(result.ranked, false);
    });
  }
});

test('input recorder stores direction changes and same-tick level choices within server limits', () => {
  const recorder = createRunInputRecorder();
  assert.equal(recorder.recordMove(0, 0).recorded, false);
  assert.equal(recorder.recordMove(0, 1).recorded, true);
  assert.equal(recorder.recordMove(1, 1).recorded, false);
  recorder.recordLevelUp(8, 'attack');
  recorder.recordMove(8, 0);
  assert.deepEqual(recorder.getInputs(), [
    { tick: 0, kind: 'move', value: 1 },
    { tick: 8, kind: 'levelUp', value: 'attack' },
    { tick: 8, kind: 'move', value: 0 },
  ]);
});

test('input recorder disables ranking beyond event and encoded payload limits', () => {
  const eventLimited = createRunInputRecorder({ maxEvents: 1 });
  eventLimited.recordMove(0, 1);
  assert.equal(eventLimited.recordLevelUp(1, 'attack').ok, false);
  assert.equal(eventLimited.getError(), 'too-many-input-events');

  const byteLimited = createRunInputRecorder({ maxBytes: 20 });
  assert.equal(byteLimited.recordMove(0, 1).ok, false);
  assert.equal(byteLimited.getError(), 'input-payload-too-large');
});

test('fixed step accumulator runs at most five 60 Hz catch-up ticks and drops excess whole ticks', () => {
  const clock = createFixedStepAccumulator();
  assert.deepEqual(clock.push(100), { steps: 5, discardedSteps: 1 });
  assert.deepEqual(clock.push(1000), { steps: 5, discardedSteps: 55 });
  clock.reset();
  assert.deepEqual(clock.push(1000 / 60), { steps: 1, discardedSteps: 0 });
});

test('rank submission is skipped after disconnect and only verified success yields server time', async () => {
  const state = gameState();
  let online = true;
  const calls = [];
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async () => ({ status: 201, ticket: ticketFor(state) }),
      submitStageResult: async (...args) => { calls.push(args); return { status: 200, outcome: 'clear', verified: true, clearTimeMs: 61000 }; },
    },
    account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'online',
    syncPendingSave: async () => ({ ok: true }), isOnline: () => online,
    now: () => new Date('2026-10-21T00:01:00.000Z'),
  });
  const prepared = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  online = false;
  assert.deepEqual(await client.submitResult(prepared.ticket, []), { verified: false, code: 'network-unavailable' });
  assert.equal(calls.length, 0);
  online = true;
  assert.deepEqual(await client.submitResult(prepared.ticket, []), {
    verified: true, clearTimeMs: 61000, outcome: 'clear',
  });
  assert.equal(calls.length, 1);
});

test('409, 410, and 422 result responses never claim a ranked clear', async (t) => {
  const state = gameState();
  for (const response of [
    { status: 409, code: 'run-already-completed' },
    { status: 410, code: 'run-expired' },
    { status: 422, code: 'run-not-cleared' },
  ]) {
    await t.test(String(response.status), async () => {
      const client = createRankedRunClient({
        apiClient: { submitStageResult: async () => response }, account: {},
        getSaveRevision: () => 1, getCurrentState: () => state, getMode: () => 'online',
        syncPendingSave: async () => ({ ok: true }), isOnline: () => true,
      });
      assert.deepEqual(await client.submitResult(ticketFor(state), []), { verified: false, code: response.code });
    });
  }
});
