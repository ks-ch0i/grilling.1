import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../../src/game/domain/stateFactory.js';
import { SAVE_KEY } from '../../src/game/domain/saveStore.js';

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

test('migrates the legacy save to its first Entra account exactly once and preserves the legacy key', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacy = newState();
  const storage = createStorage({ [SAVE_KEY]: JSON.stringify(legacy) });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body, condition) => ({ status: 201, envelope: envelope(body.state, 1), condition }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T01:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.mode, 'online');
  assert.deepEqual(loaded.state, legacy);
  assert.equal(api.calls.put[0].condition.kind, 'create');
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), JSON.stringify({ tenantId: accountA.tenantId, objectId: accountA.localAccountId }));
  assert.notEqual(storage.getItem(SAVE_KEY), null);
  assert.notEqual(storage.getItem(accountSaveKey(accountA)), null);
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
  const legacy = newState();
  const storage = createStorage({
    [SAVE_KEY]: JSON.stringify(legacy),
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
  const storage = createStorage({ [accountSaveKey(accountA)]: raw });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body) => ({ status: 201, envelope: envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T04:00:00.000Z') });
  await coordinator.loadAccountSave(accountA);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(storage.getItem(recovery), raw);
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
