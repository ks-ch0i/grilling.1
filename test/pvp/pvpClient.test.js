import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../../src/game/domain/stateFactory.js';
import { buildPvpSnapshotContent, createPvpClient, stableStringify } from '../../src/game/domain/pvpClient.js';

const account = { tenantId:'11111111-1111-4111-8111-111111111111', localAccountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const now = () => new Date('2026-10-21T00:00:00.000Z');
const ticket = {
  matchId:'11111111-1111-4111-8111-111111111111', seed:23, simulatorVersion:2, balanceVersion:2,
  issuedAtUtc:'2026-10-21T00:00:00.000Z', expiresAtUtc:'2026-10-21T00:05:00.000Z', timeLimitMs:60_000,
  playerSnapshot:{ character:{level:1}, equipment:{}, combat:{} },
  opponentSnapshot:{ character:{level:1}, equipment:{}, combat:{} },
};

function state() {
  return createInitialState(() => 'test-gear-id');
}

function makeClient(overrides = {}) {
  let currentState = overrides.currentState ?? state();
  let revision = overrides.revision ?? 4;
  const calls = [];
  const snapshotResponse = (source = currentState, changed = true) => ({
    status:200,
    changed,
    snapshot:{ ...buildPvpSnapshotContent(source), revision },
  });
  const apiClient = {
    async publishPvpSnapshot(_account, body) {
      calls.push(['publish', body]);
      return overrides.publish ? overrides.publish(body, currentState, calls) : snapshotResponse();
    },
    async searchPvpMatch(_account, body) {
      calls.push(['search', body]);
      return overrides.search ? overrides.search(body, calls) : { status:404, code:'no-opponent' };
    },
    async submitPvpResult(_account, matchId, body) {
      calls.push(['submit', matchId, structuredClone(body)]);
      return overrides.submit ? overrides.submit(matchId, body, calls) : { status:200, outcome:'win', rated:true,
        playerRatingBefore:1000, playerRatingAfter:1016, opponentRatingAfter:984, remainingHpPercent:0.7 };
    },
    async getPvpMatchHistory(_account, page) {
      calls.push(['history', page]);
      return overrides.history ? overrides.history(page, calls) : { status:200, page, pageSize:10, hasPrevious:page > 1, hasNext:false, items:[] };
    },
  };
  const client = createPvpClient({
    apiClient,
    account,
    getCurrentState:() => currentState,
    getSaveRevision:() => revision,
    getMode:() => 'verified-online',
    syncPendingSave:async() => { calls.push(['sync']); return { ok:true, pending:false }; },
    refreshAccountSave:async() => { calls.push(['refresh']); return { status:'ready', mode:'verified-online' }; },
    isOnline:() => overrides.online !== false,
    now,
  });
  return {
    client,
    calls,
    setState(value) { currentState = value; },
    setRevision(value) { revision = value; },
  };
}

test('match search syncs and refreshes cloud save, publishes its snapshot, then sends an empty search DTO', async () => {
  const { client, calls } = makeClient();
  const result = await client.findMatch();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-opponent');
  assert.deepEqual(result.search, { initialWindow:100, maximumWindow:500, windowStep:100, intervalMs:5_000, waitMs:60_000 });
  assert.deepEqual(calls.map(([name]) => name), ['sync', 'refresh', 'publish', 'search']);
  assert.deepEqual(calls.at(-1)[1], {});
  assert.deepEqual(calls.find(([name]) => name === 'publish')[1], { expectedSaveRevision:4 });
});

test('match search accepts v2 tickets and rejects legacy simulator or balance versions', async (t) => {
  for (const [name, overrides] of [
    ['v2 ticket', { ...ticket }],
    ['legacy simulator ticket', { ...ticket, simulatorVersion:1 }],
    ['legacy balance ticket', { ...ticket, balanceVersion:1 }],
  ]) {
    await t.test(name, async () => {
      const harness = makeClient({ search:async () => ({ status:201, ticket:overrides }) });
      const result = await harness.client.findMatch();
      assert.equal(result.ok, name === 'v2 ticket');
      if (name === 'v2 ticket') assert.equal(result.ticket.balanceVersion, 2);
    });
  }
});

test('XP and material changes do not publish a new PvP snapshot, while combat content changes do', async () => {
  const harness = makeClient();
  const initial = state();
  harness.setState(initial);
  assert.equal((await harness.client.publishCurrentSnapshot()).ok, true);
  const xpOnly = structuredClone(initial);
  xpOnly.player.xp += 12;
  xpOnly.materials += 3;
  harness.setState(xpOnly);
  harness.setRevision(5);
  assert.deepEqual(buildPvpSnapshotContent(xpOnly), buildPvpSnapshotContent(initial));
  assert.equal((await harness.client.onCloudSaveSynced({ state:xpOnly, revision:5 })).changed, false);
  const combatChanged = structuredClone(xpOnly);
  combatChanged.player.level += 1;
  harness.setState(combatChanged);
  harness.setRevision(6);
  assert.equal((await harness.client.onCloudSaveSynced({ state:combatChanged, revision:6 })).changed, true);
  assert.equal(harness.calls.filter(([name]) => name === 'publish').length, 2);
});

test('unsynced cloud state and offline mode never publish or search', async () => {
  const harness = makeClient({ online:false });
  const result = await harness.client.findMatch();

  assert.deepEqual(result, { ok:false, reason:'offline' });
  assert.deepEqual(harness.calls, []);
});

test('authentication failures are returned as a reauthentication state', async () => {
  const harness = makeClient({ publish:async() => ({ status:401, code:'authentication-required' }) });
  const result = await harness.client.publishCurrentSnapshot();

  assert.deepEqual(result, { ok:false, reason:'authentication-required' });
  assert.equal(harness.calls.filter(([name]) => name === 'search').length, 0);
});

test('result submission accepts server verified Elo fields, retries identical payloads, and rejects changed retries', async () => {
  let attempts = 0;
  const harness = makeClient({
    submit:async(_matchId, body) => {
      attempts += 1;
      assert.deepEqual(body, { inputs:[{ tick:0, kind:'move', value:1 }] });
      if (attempts === 1) return { status:503, code:'temporary' };
      return { status:200, outcome:'win', rated:true, playerRatingBefore:1000, playerRatingAfter:1016,
        opponentRatingAfter:984, remainingHpPercent:0.7 };
    },
  });
  const inputs = [{ tick:0, kind:'move', value:1 }];
  const result = await harness.client.submitMatch(ticket, inputs);
  const repeated = await harness.client.submitMatch(ticket, inputs);

  assert.deepEqual(result, { ok:true, result:{ outcome:'win', rated:true, playerRatingBefore:1000, playerRatingAfter:1016,
    opponentRatingAfter:984, remainingHpPercent:0.7 } });
  assert.deepEqual(repeated, result);
  assert.equal(attempts, 3);
  assert.deepEqual(stableStringify({ b:2, a:1 }), '{"a":1,"b":2}');
  assert.deepEqual(await harness.client.submitMatch(ticket, [{ tick:1, kind:'move', value:-1 }]), {
    ok:false, reason:'match-payload-changed',
  });
});

test('snapshot publication is serialized so concurrent identical requests publish once', async () => {
  let finish;
  const harness = makeClient({
    publish:async(_body, currentState) => new Promise((resolve) => {
      finish = () => resolve({ status:200, changed:true, snapshot:{ ...buildPvpSnapshotContent(currentState), revision:4 } });
    }),
  });
  const first = harness.client.publishCurrentSnapshot();
  const second = harness.client.publishCurrentSnapshot();
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  const results = await Promise.all([first, second]);

  assert.ok(results.every((result) => result.ok));
  assert.equal(harness.calls.filter(([name]) => name === 'publish').length, 1);
});

test('match history validates the requested page and returns only the safe summary DTO', async () => {
  const match = {
    matchId:'22222222-2222-4222-8222-222222222222',
    completedAtUtc:'2026-10-24T10:00:00.000Z',
    opponentDisplayName:'Opponent',
    outcome:'win',
    rated:true,
    ratingBefore:1000,
    ratingAfter:1016,
    opponentRatingAfter:984,
    inputJson:'must not be copied',
    playerSnapshotJson:'must not be copied',
  };
  const harness = makeClient({ history:async (page) => ({
    status:200, page, pageSize:10, hasPrevious:true, hasNext:true, items:[match],
  }) });

  const result = await harness.client.getMatchHistory(2);
  assert.deepEqual(result, {
    ok:true,
    page:2,
    pageSize:10,
    hasPrevious:true,
    hasNext:true,
    items:[{
      matchId:match.matchId,
      completedAtUtc:match.completedAtUtc,
      opponentDisplayName:'Opponent',
      outcome:'win',
      rated:true,
      ratingBefore:1000,
      ratingAfter:1016,
      opponentRatingAfter:984,
    }],
  });
  assert.deepEqual(harness.calls.at(-1), ['history', 2]);
  assert.deepEqual(await harness.client.getMatchHistory(0), { ok:false, reason:'invalid-history-page' });
});

test('match history maps authentication and network failures and rejects malformed pages', async (t) => {
  for (const [name, overrides, expected] of [
    ['authentication status', { history:async () => ({ status:403 }) }, 'authentication-required'],
    ['server failure', { history:async () => ({ status:503 }) }, 'network-unavailable'],
    ['network exception', { history:async () => { throw new TypeError('offline'); } }, 'network-unavailable'],
    ['wrong page', { history:async () => ({ status:200, page:2, pageSize:10, hasPrevious:true, hasNext:false, items:[] }) }, 'invalid-history-response'],
    ['invalid item', { history:async (page) => ({ status:200, page, pageSize:10, hasPrevious:false, hasNext:false, items:[{ outcome:'invalid' }] }) }, 'invalid-history-response'],
  ]) {
    await t.test(name, async () => {
      const harness = makeClient(overrides);
      assert.deepEqual(await harness.client.getMatchHistory(), { ok:false, reason:expected });
    });
  }
  const offline = makeClient({ online:false });
  assert.deepEqual(await offline.client.getMatchHistory(), { ok:false, reason:'network-unavailable' });
});
