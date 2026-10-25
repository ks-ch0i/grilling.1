import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRankedRun, replayRankedRun } from '@knight-run/game-rules/simulation';
import { validateStageInputs } from '../api/src/domain/stageRank.js';
import {
  createFixedStepAccumulator,
  createRankedRunClient,
  createRunInputRecorder,
  deriveRankedPlayerSnapshot,
  requestStageTicket,
} from '../src/game/domain/rankedRunClient.js';

function gameState(overrides = {}) {
  return {
    schemaVersion: 2,
    gold: 0,
    player: {
      level: 1,
      xp: 0,
      xpToNext: 100,
      pendingLevelUps: 0,
      availableStatPoints: 0,
      spentStatPoints: 0,
      statResetCount: 0,
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
    simulatorVersion: 2,
    balanceVersion: 2,
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
    level: 3, xp: 26, xpToNext: 144, pendingLevelUps: 0,
    availableStatPoints: 0, spentStatPoints: 0, replayXpMultiplier: 0.3,
  });
});

test('API-normalized level allocations replay identically to the client input log on a seeded v2 ticket', () => {
  const state = gameState({
    player: {
      ...gameState().player,
      currentHp: 100000,
      pendingLevelUps: 3,
      baseStats: { maxHp: 100000, attack: 1000, defense: 1000, critChance: 0.05, critMultiplier: 2, moveSpeed: 200 },
    },
  });
  const ticket = ticketFor(state);
  const recorder = createRunInputRecorder();
  recorder.recordLevelUp(0, []);
  recorder.recordLevelUp(0, ['attack']);
  recorder.recordLevelUp(0, ['attack', 'defense']);
  recorder.recordMove(0, 1);
  const clientInputs = recorder.getInputs();
  const apiInputs = validateStageInputs({ inputs: clientInputs }).inputs;

  assert.deepEqual(apiInputs, clientInputs);
  const clientReplay = replayRankedRun(ticket, ticket.playerSnapshot, clientInputs);
  const apiReplay = replayRankedRun(ticket, ticket.playerSnapshot, apiInputs);
  assert.deepEqual(apiReplay, clientReplay);
  assert.equal(apiReplay.valid, true);

  const initial = createRankedRun(ticket, ticket.playerSnapshot);
  const repeated = createRankedRun(ticket, ticket.playerSnapshot);
  const enemyCount = initial.enemies.filter((enemy) => !enemy.isBoss).length;
  assert.ok(enemyCount >= 4 && enemyCount <= 10);
  assert.equal(initial.randomState, repeated.randomState);
  assert.deepEqual(initial.enemies, repeated.enemies);
});

test('offline ticket preparation keeps the run local and does not call ranking APIs', async () => {
  let requests = 0;
  const shadow = gameState({ player:{ ...gameState().player, xp:31 } });
  const client = createRankedRunClient({
    apiClient: { startStageRun: async () => { requests += 1; } },
    account: {},
    getSaveRevision: () => 1,
    getCurrentState: () => gameState(),
    getMode: () => 'verified-online',
    syncPendingSave: async () => ({ ok: true }),
    selectLocalShadow:async () => ({ ok:true, state:shadow, mode:'offline-unverified' }),
    isOnline: () => false,
  });

  const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: gameState() });
  assert.equal(result.ranked, false);
  assert.equal(result.reason, 'offline');
  assert.equal(result.gameState, shadow);
  assert.equal(result.shadowSelected, true);
  assert.equal(requests, 0);
});

test('ticket failure after the save becomes unverified starts battle from the selected shadow', async () => {
  const shadow = gameState({ player:{ ...gameState().player, xp:45 } });
  let mode = 'verified-online';
  let tickets = 0;
  const client = createRankedRunClient({
    apiClient:{ startStageRun:async() => { tickets += 1; throw new TypeError('offline'); } },
    account:{}, getSaveRevision:() => 3, getCurrentState:() => gameState(), getMode:() => mode,
    syncPendingSave:async() => ({ ok:true }),
    selectLocalShadow:async(_reason, options) => {
      mode = 'offline-unverified';
      return { ok:options.preferExisting, state:shadow, mode };
    },
    isOnline:() => true,
  });

  const result = await client.prepareStage({ chapter:1, stage:1, gameState:gameState() });
  assert.equal(result.ranked, false);
  assert.equal(result.reason, 'ticket-request-failed');
  assert.equal(result.gameState, shadow);
  assert.equal(result.shadowSelected, true);
  assert.equal(tickets, 1);
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
    getMode: () => 'verified-online',
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

test('a cached unverified save never promotes itself to a ranked ticket after reconnect', async () => {
  const state = gameState();
  let ticketRequests = 0;
  let refreshes = 0;
  const client = createRankedRunClient({
    apiClient: { startStageRun: async () => { ticketRequests += 1; return { status:201, ticket:ticketFor(state) }; } },
    account: {}, getSaveRevision: () => 7, getCurrentState: () => state, getMode: () => 'offline-unverified',
    syncPendingSave: async () => ({ ok: true }),
    refreshAccountSave: async () => { refreshes += 1; return { status:'ready', mode:'verified-online' }; },
    isOnline: () => true, now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const result = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.deepEqual(result, { ranked:false, reason:'unverified-shadow' });
  assert.equal(ticketRequests, 0);
  assert.equal(refreshes, 0);
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
    account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'verified-online',
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
    account: {}, getSaveRevision: () => 9, getCurrentState: () => state, getMode: () => 'verified-online',
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
    { name: 'legacy simulator ticket', response: { status: 201, ticket: ticketFor(state, { simulatorVersion: 1 }) } },
    { name: 'legacy balance ticket', response: { status: 201, ticket: ticketFor(state, { balanceVersion: 1 }) } },
    { name: 'ticket expired', response: { status: 201, ticket: ticketFor(state, { expiresAtUtc: '2026-10-20T23:59:00.000Z' }) } },
    { name: 'snapshot mismatch', response: { status: 201, ticket: ticketFor(state, { playerSnapshot: { ...deriveRankedPlayerSnapshot(state, 1, 1), attack: 999 } }) } },
  ]) {
    await t.test(scenario.name, async () => {
      const client = createRankedRunClient({
        apiClient: {
          startStageRun: async () => scenario.response,
          submitStageResult: async () => ({ status: 422 }),
        },
        account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'verified-online',
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
  recorder.recordLevelUp(8, ['attack', 'attack']);
  recorder.recordMove(8, 0);
  assert.deepEqual(recorder.getInputs(), [
    { tick: 0, kind: 'move', value: 1 },
    { tick: 8, kind: 'levelUp', value: ['attack', 'attack'] },
    { tick: 8, kind: 'move', value: 0 },
  ]);
  assert.throws(() => recorder.recordLevelUp(9, 'attack'), RangeError);
  assert.throws(() => recorder.recordLevelUp(9, ['attack', 'defense', 'maxHp']), RangeError);
});

test('input recorder disables ranking beyond event and encoded payload limits', () => {
  const eventLimited = createRunInputRecorder({ maxEvents: 1 });
  eventLimited.recordMove(0, 1);
  assert.equal(eventLimited.recordLevelUp(1, ['attack']).ok, false);
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
  const verifiedState = gameState({ gold:23 });
  let online = true;
  const calls = [];
  const installs = [];
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async () => ({ status: 201, ticket: ticketFor(state) }),
      submitStageResult: async (...args) => {
        calls.push(args);
        return {
          status:200, outcome:'clear', verified:true, clearTimeMs:61000, revision:9,
          state:verifiedState,
          rewards:{ outcome:'clear', xpGranted:20, goldGranted:23, drops:[] },
        };
      },
    },
    account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'verified-online',
    syncPendingSave: async () => ({ ok: true }), isOnline: () => online,
    installVerifiedState: async (envelope) => {
      installs.push(envelope);
      return { ok:true, ...envelope };
    },
    now: () => new Date('2026-10-21T00:01:00.000Z'),
  });
  const prepared = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  online = false;
  assert.deepEqual(await client.submitResult(prepared.ticket, []), { verified: false, code: 'network-unavailable' });
  assert.equal(calls.length, 0);
  online = true;
  assert.deepEqual(await client.submitResult(prepared.ticket, []), {
    verified:true, clearTimeMs:61000, outcome:'clear', revision:9, state:verifiedState,
    rewards:{ outcome:'clear', xpGranted:20, goldGranted:23, drops:[] }, terminal:true,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(installs, [{ revision:9, state:verifiedState }]);
});

test('verified death installs the canonical reward state without claiming a clear time', async () => {
  const before = gameState();
  const state = gameState({ gold:17 });
  const installs = [];
  const client = createRankedRunClient({
    apiClient: {
      submitStageResult:async () => ({
        status:200, verified:true, outcome:'death', clearTimeMs:null, revision:4, state,
        rewards:{ outcome:'death', xpGranted:12, goldGranted:17, drops:[] },
      }),
    },
    account:{}, isOnline:() => true,
    installVerifiedState:async (envelope) => { installs.push(envelope); return { ok:true, ...envelope }; },
  });

  const result = await client.submitResult(ticketFor(before), [{ tick:0, kind:'move', value:1 }]);

  assert.deepEqual(result, {
    verified:true, outcome:'death', clearTimeMs:null, revision:4, state,
    rewards:{ outcome:'death', xpGranted:12, goldGranted:17, drops:[] }, terminal:true,
  });
  assert.deepEqual(installs, [{ revision:4, state }]);
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
        getSaveRevision: () => 1, getCurrentState: () => state, getMode: () => 'verified-online',
        syncPendingSave: async () => ({ ok: true }), isOnline: () => true,
      });
      assert.deepEqual(await client.submitResult(ticketFor(state), []), {
        verified:false, code:response.code, terminal:true,
      });
    });
  }
});

test('unsupported-version rejection clears a pending ticket before the next ranked request', async () => {
  const state = gameState();
  const calls = [];
  const client = createRankedRunClient({
    apiClient: {
      startStageRun: async () => {
        calls.push('ticket');
        return { status: 201, ticket: ticketFor(state) };
      },
      submitStageResult: async (_account, runId) => {
        calls.push(['result', runId]);
        return { status: 409, code: 'unsupported-simulator-version' };
      },
    },
    account: {}, getSaveRevision: () => 8, getCurrentState: () => state, getMode: () => 'verified-online',
    syncPendingSave: async () => ({ ok: true }), isOnline: () => true,
    now: () => new Date('2026-10-21T00:01:00.000Z'),
  });

  const first = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });
  assert.equal((await client.submitResult(first.ticket, [])).code, 'unsupported-simulator-version');
  const second = await client.prepareStage({ chapter: 1, stage: 1, gameState: state });

  assert.equal(second.ranked, true);
  assert.deepEqual(calls, ['ticket', ['result', first.ticket.runId], 'ticket']);
});
