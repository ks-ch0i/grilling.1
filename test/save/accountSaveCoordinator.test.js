import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../../packages/game-rules/src/balance.js';
import { createInitialState } from '../../src/game/domain/stateFactory.js';
import { LEGACY_SAVE_KEY, SAVE_KEY } from '../../src/game/domain/saveStore.js';

async function loadCoordinator() {
  try {
    return await import('../../src/game/domain/accountSaveCoordinator.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected account save coordinator: ${error.message}`);
    throw error;
  }
}

const accountA = { tenantId: '11111111-1111-4111-8111-111111111111', localAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const accountB = { tenantId: '11111111-1111-4111-8111-111111111111', localAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };

function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

function newState() {
  return createInitialState(() => `test-${Math.random()}`);
}

function legacyState() {
  const state = newState();
  state.schemaVersion = 1;
  delete state.gold;
  state.player.baseStats = { maxHp:100, attack:10, defense:5, critChance:0.05, critMultiplier:2, moveSpeed:200 };
  delete state.player.availableStatPoints;
  delete state.player.spentStatPoints;
  delete state.player.statResetCount;
  return state;
}

function envelope(state, revision) {
  return { schemaVersion: 1, revision, updatedAtUtc: '2026-10-21T00:00:00.000Z', state: structuredClone(state) };
}

function makeApi({ getCurrent, putCurrent }) {
  const calls = { get: [], put: [] };
  return {
    calls,
    async getCurrent(account) { calls.get.push(account); return getCurrent(account); },
    async putCurrent(account, body, condition) { calls.put.push({ account, body, condition }); return putCurrent(account, body, condition); },
  };
}

test('migrates the legacy shared save to its first Entra account and preserves v1 bytes', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  const legacyRaw = JSON.stringify(legacy);
  const storage = createStorage({ [LEGACY_SAVE_KEY]: legacyRaw });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body, condition) => ({ status: 201, envelope: envelope(body.state, 1), condition }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T01:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.mode, 'online');
  assert.equal(loaded.state.schemaVersion, 2);
  assert.deepEqual(loaded.state.player.baseStats, BALANCE.basePlayer);
  assert.equal(loaded.state.gold, 0);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(api.calls.put[0].condition.kind, 'create');
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), JSON.stringify({ tenantId: accountA.tenantId, objectId: accountA.localAccountId }));
  assert.notEqual(storage.getItem(accountSaveKey(accountA)), null);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('claims an ownerless shared v1 save before an offline cloud create can expose it to another account', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY } = await loadCoordinator();
  const legacy = legacyState();
  legacy.player.level = 7;
  const storage = createStorage({ [LEGACY_SAVE_KEY]: JSON.stringify(legacy) });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (account, body) => account.localAccountId === accountA.localAccountId
      ? ({ status: 500 })
      : ({ status: 201, envelope: envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const first = await coordinator.loadAccountSave(accountA);
  assert.equal(first.status, 'ready');
  assert.equal(first.mode, 'offline');
  assert.equal(first.state.player.level, 7);
  assert.equal(JSON.parse(storage.getItem(LEGACY_OWNER_KEY)).objectId, accountA.localAccountId);

  const second = await coordinator.loadAccountSave(accountB);
  assert.equal(second.status, 'ready');
  assert.equal(second.state.player.level, 1);
  assert.equal(api.calls.put.length, 2);
  assert.equal(api.calls.put[1].body.state.player.level, 1);
});

test('a malformed legacy owner record prevents importing the shared v1 save', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY } = await loadCoordinator();
  const legacy = legacyState();
  legacy.player.level = 7;
  const storage = createStorage({
    [LEGACY_SAVE_KEY]: JSON.stringify(legacy),
    [LEGACY_OWNER_KEY]: '{not-json',
  });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body) => ({ status: 201, envelope: envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loaded = await coordinator.loadAccountSave(accountB);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.state.player.level, 1);
  assert.equal(api.calls.put[0].body.state.player.level, 1);
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), '{not-json');
});

test('fails closed when the shared legacy owner cannot be persisted', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacyRaw = JSON.stringify(legacyState());
  const storage = createStorage({ [LEGACY_SAVE_KEY]: legacyRaw });
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === LEGACY_OWNER_KEY) throw new Error('storage is read-only');
    setItem(key, value);
  };
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async () => assert.fail('an unowned shared save must not be imported'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.status, 'error');
  assert.equal(loaded.code, 'legacy-owner-save-failed');
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
});

test('ignores a late cloud response after switching to another account', async () => {
  const { createAccountSaveCoordinator, accountSaveKey } = await loadCoordinator();
  let resolveA;
  const pendingA = new Promise((resolve) => { resolveA = resolve; });
  const stateA = newState();
  stateA.player.level = 7;
  const stateB = newState();
  stateB.player.level = 9;
  const storage = createStorage();
  const api = makeApi({
    getCurrent: async (account) => account.localAccountId === accountA.localAccountId
      ? pendingA
      : ({ status: 200, envelope: envelope(stateB, 4) }),
    putCurrent: async () => assert.fail('existing cloud saves must not be replaced'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loadA = coordinator.loadAccountSave(accountA);
  const loadB = await coordinator.loadAccountSave(accountB);
  resolveA({ status: 200, envelope: envelope(stateA, 3) });
  const staleA = await loadA;

  assert.equal(loadB.state.player.level, 9);
  assert.equal(staleA.status, 'stale-account-operation');
  assert.equal(coordinator.getCurrentState().player.level, 9);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountB))).player.level, 9);
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
});

test('ignores a late sync conflict after switching to another account', async () => {
  const { createAccountSaveCoordinator, accountSaveKey } = await loadCoordinator();
  let resolveSyncA;
  const pendingSyncA = new Promise((resolve) => { resolveSyncA = resolve; });
  const stateA = newState();
  stateA.player.level = 7;
  const stateB = newState();
  stateB.player.level = 9;
  const staleCloudA = newState();
  staleCloudA.player.level = 11;
  const storage = createStorage();
  const api = makeApi({
    getCurrent: async (account) => account.localAccountId === accountA.localAccountId
      ? ({ status: 200, envelope: envelope(stateA, 3) })
      : ({ status: 200, envelope: envelope(stateB, 4) }),
    putCurrent: async (account) => account.localAccountId === accountA.localAccountId
      ? pendingSyncA
      : assert.fail('account B has no pending changes'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loadedA = await coordinator.loadAccountSave(accountA);
  const localA = structuredClone(loadedA.state);
  localA.player.xp += 1;
  coordinator.saveLocal(localA);
  const syncA = coordinator.syncPendingSave();
  const loadedB = await coordinator.loadAccountSave(accountB);
  resolveSyncA({ status: 409, current: envelope(staleCloudA, 5) });
  const staleResult = await syncA;

  assert.equal(staleResult.error, 'stale-account-operation');
  assert.equal(loadedB.state.player.level, 9);
  assert.equal(coordinator.getCurrentState().player.level, 9);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountB))).player.level, 9);
});

test('imports a shared v1 save when the legacy owner matches the active Entra account', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacyRaw = JSON.stringify(legacyState());
  const storage = createStorage({
    [LEGACY_SAVE_KEY]: legacyRaw,
    [LEGACY_OWNER_KEY]: JSON.stringify({ tenantId: accountA.tenantId, objectId: accountA.localAccountId }),
  });
  const api = makeApi({
    getCurrent:async() => ({ status:404 }),
    putCurrent:async(_account, body) => ({ status:201, envelope:envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.state.schemaVersion, 2);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).gold, 0);
});

test('offline loading migrates only the active account v1 cache to its v2 key', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, legacyAccountSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  const legacyRaw = JSON.stringify(legacy);
  const storage = createStorage({ [legacyAccountSaveKey(accountA)]: legacyRaw });
  const api = makeApi({ getCurrent:async() => { throw new TypeError('network unavailable'); }, putCurrent:async() => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.mode, 'offline');
  assert.equal(loaded.state.schemaVersion, 2);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyRaw);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).schemaVersion, 2);
});

test('offline v1 migration reports savedLocally false when writing its v2 cache fails', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, legacyAccountSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  legacy.player.level = 6;
  const legacyRaw = JSON.stringify(legacy);
  const storage = createStorage({ [legacyAccountSaveKey(accountA)]: legacyRaw });
  const setItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === accountSaveKey(accountA)) throw new Error('storage is full');
    setItem(key, value);
  };
  const api = makeApi({
    getCurrent: async () => { throw new TypeError('network unavailable'); },
    putCurrent: async () => assert.fail('offline account migration must not write to cloud'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.mode, 'offline');
  assert.equal(loaded.state.player.level, 6);
  assert.equal(loaded.savedLocally, false);
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyRaw);
});

test('recovery-backs up invalid v2 bytes before importing the matching account v1 cache', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, legacyAccountSaveKey, recoveryKeyPrefix } = await loadCoordinator();
  const brokenCurrent = '{invalid v2 cache';
  const legacyRaw = JSON.stringify(legacyState());
  const storage = createStorage({
    [accountSaveKey(accountA)]: brokenCurrent,
    [legacyAccountSaveKey(accountA)]: legacyRaw,
  });
  const api = makeApi({ getCurrent:async() => { throw new TypeError('network unavailable'); }, putCurrent:async() => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState, now:() => new Date('2026-10-21T01:30:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.status, 'ready');
  assert.equal(storage.getItem(accountSaveKey(accountA)), brokenCurrent);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyRaw);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(storage.getItem(recovery), brokenCurrent);
});

test('another account v1 cache is never used as an offline fallback', async () => {
  const { createAccountSaveCoordinator, legacyAccountSaveKey, accountSaveKey } = await loadCoordinator();
  const legacyA = JSON.stringify(legacyState());
  const storage = createStorage({ [legacyAccountSaveKey(accountA)]: legacyA });
  const api = makeApi({ getCurrent:async() => { throw new TypeError('network unavailable'); }, putCurrent:async() => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountB);

  assert.equal(loaded.status, 'offline-unavailable');
  assert.equal(loaded.state, undefined);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyA);
  assert.equal(storage.getItem(accountSaveKey(accountB)), null);
});

test('cloud wins on load and differing same-account local data is preserved in a recovery key', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, recoveryKeyPrefix } = await loadCoordinator();
  const local = newState();
  local.player.level = 5;
  const cloud = newState();
  cloud.player.level = 9;
  const storage = createStorage({ [accountSaveKey(accountA)]: JSON.stringify(local) });
  const api = makeApi({ getCurrent: async () => ({ status: 200, envelope: envelope(cloud, 8) }), putCurrent: async () => assert.fail('cloud is already authoritative') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T02:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.state.player.level, 9);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.level, 9);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(JSON.parse(storage.getItem(recovery)).player.level, 5);
});

test('offline saves remain local and reconnect with the last cloud revision', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, accountSyncKey } = await loadCoordinator();
  const cached = newState();
  const storage = createStorage({
    [accountSaveKey(accountA)]: JSON.stringify(cached),
    [accountSyncKey(accountA)]: JSON.stringify({ revision: 4, pending: false }),
  });
  let online = false;
  const api = makeApi({
    getCurrent: async () => { if (!online) throw new TypeError('Failed to fetch'); return { status: 200, envelope: envelope(cached, 4) }; },
    putCurrent: async (_account, body, condition) => ({ status: 200, envelope: envelope(body.state, 5), condition }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });
  const loaded = await coordinator.loadAccountSave(accountA);
  const changed = structuredClone(loaded.state);
  changed.player.xp += 7;
  assert.equal(coordinator.saveLocal(changed).ok, true);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, true);
  online = true;
  const synced = await coordinator.syncPendingSave();

  assert.equal(synced.ok, true);
  assert.deepEqual(api.calls.put[0].condition, { kind: 'update', expectedRevision: 4 });
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).revision, 5);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, false);
});

test('the active cloud save revision is exposed for stage ticket requests', async () => {
  const { createAccountSaveCoordinator } = await loadCoordinator();
  const state = newState();
  const api = makeApi({
    getCurrent: async () => ({ status: 200, envelope: envelope(state, 12) }),
    putCurrent: async () => assert.fail('the cloud save already exists'),
  });
  const coordinator = createAccountSaveCoordinator({ storage: createStorage(), api, initialStateFactory: newState });

  assert.equal(coordinator.getSaveRevision(), null);
  await coordinator.loadAccountSave(accountA);
  assert.equal(coordinator.getSaveRevision(), 12);
  assert.equal(coordinator.getMode(), 'online');
});

test('cloud save callback only publishes a state after the matching revision is synced', async () => {
  const { createAccountSaveCoordinator } = await loadCoordinator();
  const initial = newState();
  const callbacks = [];
  const api = makeApi({
    getCurrent:async() => ({ status:200, envelope:envelope(initial, 2) }),
    putCurrent:async(_account, body) => ({ status:200, envelope:envelope(body.state, 3) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage:createStorage(), api, initialStateFactory:newState });
  coordinator.setCloudSaveCallback((entry) => callbacks.push(entry));
  const loaded = await coordinator.loadAccountSave(accountA);
  assert.equal(loaded.status, 'ready');
  assert.equal(callbacks.length, 0);
  const changed = structuredClone(loaded.state);
  changed.player.xp += 5;
  coordinator.saveLocal(changed);
  assert.equal(callbacks.length, 0);

  const synced = await coordinator.syncPendingSave();
  assert.equal(synced.ok, true);
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].revision, 3);
  assert.equal(callbacks[0].state.player.xp, changed.player.xp);
});

test('409 conflict backs up pending local state, applies cloud state and never auto-overwrites it', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, accountSyncKey, recoveryKeyPrefix } = await loadCoordinator();
  const cloud = newState();
  cloud.player.level = 11;
  const storage = createStorage({
    [accountSaveKey(accountA)]: JSON.stringify(cloud),
    [accountSyncKey(accountA)]: JSON.stringify({ revision: 2, pending: false }),
  });
  let puts = 0;
  const api = makeApi({
    getCurrent: async () => ({ status: 200, envelope: envelope(cloud, 2) }),
    putCurrent: async () => { puts += 1; const current = newState(); current.player.level = 13; return { status: 409, current: envelope(current, 3) }; },
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T03:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);
  const localPending = structuredClone(loaded.state);
  localPending.player.level = 12;
  coordinator.saveLocal(localPending);
  const conflict = await coordinator.syncPendingSave();

  assert.equal(conflict.error, 'save-conflict');
  assert.equal(puts, 1);
  assert.equal(coordinator.getCurrentState().player.level, 13);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.level, 13);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, false);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(JSON.parse(storage.getItem(recovery)).player.level, 12);
});

test('an offline account without its own cache cannot start from another account legacy save', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY } = await loadCoordinator();
  const storage = createStorage({
    [LEGACY_SAVE_KEY]: JSON.stringify(legacyState()),
    [LEGACY_OWNER_KEY]: JSON.stringify({ tenantId: accountA.tenantId, objectId: accountA.localAccountId }),
  });
  const api = makeApi({ getCurrent: async () => { throw new TypeError('Failed to fetch'); }, putCurrent: async () => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });
  const loaded = await coordinator.loadAccountSave(accountB);
  assert.equal(loaded.status, 'offline-unavailable');
  assert.equal(loaded.state, undefined);
  assert.equal(api.calls.put.length, 0);
});

test('invalid local JSON is preserved under a recovery key before a missing-cloud save is replaced', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, recoveryKeyPrefix } = await loadCoordinator();
  const raw = '{broken legacy cache';
  const legacyRecoveryKey = `lancer-belt-scroll-game:recovery:v1:${accountA.tenantId}:${accountA.localAccountId}:2026-10-21T04:00:00.000Z`;
  const storage = createStorage({
    [accountSaveKey(accountA)]: raw,
    [legacyRecoveryKey]: '{older backup}',
  });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body) => ({ status: 201, envelope: envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T04:00:00.000Z') });
  await coordinator.loadAccountSave(accountA);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(storage.getItem(recovery), raw);
  assert.equal(storage.getItem(legacyRecoveryKey), '{older backup}');
});

test('token failures do not enter offline mode even when an account cache exists', async () => {
  const { createAccountSaveCoordinator, accountSaveKey } = await loadCoordinator();
  const storage = createStorage({ [accountSaveKey(accountA)]: JSON.stringify(newState()) });
  const error = Object.assign(new Error('consent required'), { name: 'CloudSaveAuthenticationError' });
  const api = makeApi({ getCurrent: async () => { throw error; }, putCurrent: async () => assert.fail('token error must not write') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });
  const loaded = await coordinator.loadAccountSave(accountA);
  assert.equal(loaded.status, 'error');
  assert.equal(loaded.code, 'authentication-required');
});
