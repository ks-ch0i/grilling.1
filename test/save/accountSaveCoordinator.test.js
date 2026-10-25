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

test('shared legacy v1 data stays local until the user explicitly recovers it', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey, verifiedSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  const legacyRaw = JSON.stringify(legacy);
  const storage = createStorage({ [LEGACY_SAVE_KEY]: legacyRaw });
  const api = makeApi({
    getCurrent: async () => ({ status: 404 }),
    putCurrent: async (_account, body, condition) => ({ status: 201, envelope: envelope(body.state, 1), condition }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T01:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.mode, 'verified-online');
  assert.equal(loaded.state.schemaVersion, 2);
  assert.deepEqual(loaded.state.player.baseStats, BALANCE.basePlayer);
  assert.equal(loaded.state.gold, 0);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(api.calls.put[0].condition.kind, 'create');
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), null);
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.gold, 0);
  const recovered = await coordinator.recoverLegacySave();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.mode, 'offline-unverified');
  assert.equal(coordinator.getCurrentState().player.level, legacy.player.level);
  assert.equal(JSON.parse(storage.getItem(LEGACY_OWNER_KEY)).objectId, accountA.localAccountId);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('offline login does not claim or import another legacy save', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  legacy.player.level = 7;
  const storage = createStorage({ [LEGACY_SAVE_KEY]: JSON.stringify(legacy) });
  const api = makeApi({
    getCurrent: async () => { throw new TypeError('network unavailable'); },
    putCurrent: async () => assert.fail('offline login must not upload local progress'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const first = await coordinator.loadAccountSave(accountA);
  assert.equal(first.status, 'ready');
  assert.equal(first.mode, 'offline-unverified');
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), null);

  const second = await coordinator.loadAccountSave(accountB);
  assert.equal(second.status, 'ready');
  assert.equal(second.mode, 'offline-unverified');
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), null);
  assert.equal(api.calls.put.length, 0);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountB))).player.level, 1);
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
  assert.equal(loaded.mode, 'verified-online');
  assert.equal(api.calls.put[0].body.state.player.level, 1);
  assert.equal(storage.getItem(LEGACY_OWNER_KEY), '{not-json');
  assert.deepEqual(await coordinator.recoverLegacySave(), { ok:false, error:'legacy-recovery-unavailable' });
});

test('explicit shared legacy recovery fails closed when its owner cannot be persisted', async () => {
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
    putCurrent: async (_account, body) => ({ status:201, envelope:envelope(body.state, 1) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });

  const loaded = await coordinator.loadAccountSave(accountA);
  const recovered = await coordinator.recoverLegacySave();

  assert.equal(loaded.mode, 'verified-online');
  assert.deepEqual(recovered, { ok:false, error:'legacy-owner-save-failed' });
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
});

test('ignores a late cloud response after switching to another account', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, verifiedSaveKey } = await loadCoordinator();
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
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountB))).state.player.level, 9);
  assert.equal(storage.getItem(accountSaveKey(accountA)), null);
});

test('ignores a late sync conflict after switching to another account', async () => {
  const { createAccountSaveCoordinator, verifiedSaveKey } = await loadCoordinator();
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
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountB))).state.player.level, 9);
});

test('shared legacy v1 data is imported only after explicit recovery for its owner', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const legacy = legacyState();
  legacy.player.level = 8;
  const legacyRaw = JSON.stringify(legacy);
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
  const recovered = await coordinator.recoverLegacySave();

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.state.schemaVersion, 2);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.mode, 'offline-unverified');
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.level, JSON.parse(legacyRaw).player.level);
  assert.equal(JSON.parse(storage.getItem(LEGACY_OWNER_KEY)).objectId, accountA.localAccountId);
});

test('explicit legacy recovery can replace a shadow only after preserving the current local save', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey, verifiedSaveKey, recoveryKeyPrefix } = await loadCoordinator();
  const local = newState();
  local.player.level = 5;
  const legacy = legacyState();
  legacy.player.level = 8;
  const legacyRaw = JSON.stringify(legacy);
  const canonical = newState();
  canonical.player.level = 3;
  const storage = createStorage({
    [accountSaveKey(accountA)]:JSON.stringify(local),
    [LEGACY_SAVE_KEY]:legacyRaw,
  });
  const api = makeApi({
    getCurrent:async() => ({ status:200, envelope:envelope(canonical, 4) }),
    putCurrent:async() => assert.fail('legacy recovery must never upload a local shadow'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState, now:() => new Date('2026-10-25T00:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.hasUnverifiedShadow, true);
  assert.deepEqual(await coordinator.recoverLegacySave(), { ok:false, error:'shadow-already-exists' });
  const recovered = await coordinator.recoverLegacySave({ replaceShadow:true });

  assert.equal(recovered.ok, true);
  assert.equal(recovered.mode, 'offline-unverified');
  assert.equal(recovered.state.player.level, 8);
  assert.equal(coordinator.getMode(), 'offline-unverified');
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.level, 8);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.player.level, 3);
  assert.equal(JSON.parse(storage.getItem(LEGACY_OWNER_KEY)).objectId, accountA.localAccountId);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  const recoveryKey = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recoveryKey);
  assert.equal(JSON.parse(storage.getItem(recoveryKey)).player.level, 5);
  assert.equal(api.calls.put.length, 0);
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
  assert.equal(loaded.mode, 'offline-unverified');
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
  assert.equal(loaded.mode, 'offline-unverified');
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
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).schemaVersion, 2);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyRaw);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(storage.getItem(recovery), brokenCurrent);
});

test('another account v1 cache is never used as an offline fallback; a new account starts locally', async () => {
  const { createAccountSaveCoordinator, legacyAccountSaveKey, accountSaveKey } = await loadCoordinator();
  const legacyA = JSON.stringify(legacyState());
  const storage = createStorage({ [legacyAccountSaveKey(accountA)]: legacyA });
  const api = makeApi({ getCurrent:async() => { throw new TypeError('network unavailable'); }, putCurrent:async() => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountB);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.mode, 'offline-unverified');
  assert.equal(loaded.state.player.level, 1);
  assert.equal(storage.getItem(legacyAccountSaveKey(accountA)), legacyA);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountB))).player.level, 1);
});

test('cloud wins on load and differing same-account local data is preserved in a recovery key', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, verifiedSaveKey, recoveryKeyPrefix } = await loadCoordinator();
  const local = newState();
  local.player.level = 5;
  const cloud = newState();
  cloud.player.level = 9;
  const storage = createStorage({ [accountSaveKey(accountA)]: JSON.stringify(local) });
  const api = makeApi({ getCurrent: async () => ({ status: 200, envelope: envelope(cloud, 8) }), putCurrent: async () => assert.fail('cloud is already authoritative') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState, now: () => new Date('2026-10-21T02:00:00.000Z') });
  const loaded = await coordinator.loadAccountSave(accountA);

  assert.equal(loaded.state.player.level, 9);
  assert.equal(loaded.hasUnverifiedShadow, true);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.level, 5);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.player.level, 9);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(JSON.parse(storage.getItem(recovery)).player.level, 5);
});

test('offline saves stay unverified and reconnect refreshes without uploading them', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, accountSyncKey, verifiedSaveKey } = await loadCoordinator();
  const cached = newState();
  const storage = createStorage({
    [accountSaveKey(accountA)]: JSON.stringify(cached),
    [accountSyncKey(accountA)]: JSON.stringify({ revision: 4, pending: false }),
  });
  let online = false;
  const api = makeApi({
    getCurrent: async () => { if (!online) throw new TypeError('Failed to fetch'); return { status: 200, envelope: envelope(cached, 4) }; },
    putCurrent: async () => assert.fail('reconnecting must not upload the offline shadow'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });
  const loaded = await coordinator.loadAccountSave(accountA);
  const changed = structuredClone(loaded.state);
  changed.player.xp += 7;
  assert.equal(coordinator.saveLocal(changed).ok, true);
  assert.equal(coordinator.getMode(), 'offline-unverified');
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.xp, changed.player.xp);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, false);
  online = true;
  const refreshed = await coordinator.refreshAccountSave();

  assert.equal(refreshed.status, 'ready');
  assert.equal(refreshed.mode, 'offline-unverified');
  assert.equal(api.calls.get.length, 2);
  assert.equal(api.calls.put.length, 0);
  assert.equal(coordinator.getMode(), 'offline-unverified');
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.player.xp, cached.player.xp);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.xp, changed.player.xp);
});

test('guest mode persists locally and never calls authenticated save routes', async () => {
  const { createAccountSaveCoordinator, accountSaveKey } = await loadCoordinator();
  const storage = createStorage();
  let apiCalls = 0;
  const api = {
    getCurrent:async() => { apiCalls += 1; assert.fail('guest must not fetch an account profile'); },
    putCurrent:async() => { apiCalls += 1; assert.fail('guest must not upload a save'); },
  };
  const coordinator = createAccountSaveCoordinator({
    storage, api, initialStateFactory:newState, isGuestAccount:() => true,
  });
  const loaded = await coordinator.loadAccountSave({ username:'Local guest' });
  const changed = structuredClone(loaded.state);
  changed.player.currentHp -= 1;
  const saved = coordinator.saveLocal(changed);

  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.mode, 'guest-unverified');
  assert.equal(saved.mode, 'guest-unverified');
  assert.equal(coordinator.getMode(), 'guest-unverified');
  assert.equal((await coordinator.syncPendingSave()).error, 'guest-unverified');
  assert.equal(JSON.parse(storage.getItem(accountSaveKey({
    tenantId:'guest', localAccountId:'guest', idTokenClaims:{ oid:'guest' },
  }))).player.currentHp, changed.player.currentHp);
  assert.equal(apiCalls, 0);
});

test('verified saves upload client-owned fields over the latest canonical profile only', async () => {
  const { createAccountSaveCoordinator, verifiedPendingSaveKey, accountSaveKey } = await loadCoordinator();
  const canonical = newState();
  canonical.player.xp = 37;
  canonical.gold = 120;
  canonical.materials = 9;
  canonical.progression.clearedStageIds = ['1-1'];
  const storage = createStorage();
  const api = makeApi({
    getCurrent:async() => ({ status:200, envelope:envelope(canonical, 5) }),
    putCurrent:async(_account, body) => ({ status:200, envelope:envelope(body.state, 6) }),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountA);
  const changed = structuredClone(loaded.state);
  changed.player.currentHp -= 4;
  changed.player.baseStats.attack += 3;
  changed.player.availableStatPoints += 1;
  changed.player.xp = 5000;
  changed.gold = 99999;
  changed.materials = 999;
  changed.progression.clearedStageIds = [];
  assert.equal(coordinator.saveLocal(changed).ok, true);

  const pending = JSON.parse(storage.getItem(verifiedPendingSaveKey(accountA)));
  assert.equal(pending.trust, 'unverified');
  assert.equal(pending.revision, 5);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))), null);
  const synced = await coordinator.syncPendingSave();
  const uploaded = api.calls.put[0].body.state;

  assert.equal(synced.ok, true);
  assert.equal(uploaded.player.currentHp, changed.player.currentHp);
  assert.equal(uploaded.player.baseStats.attack, changed.player.baseStats.attack);
  assert.equal(uploaded.player.availableStatPoints, changed.player.availableStatPoints);
  assert.equal(uploaded.player.xp, canonical.player.xp);
  assert.equal(uploaded.gold, canonical.gold);
  assert.equal(uploaded.materials, canonical.materials);
  assert.deepEqual(uploaded.progression, canonical.progression);
});

test('browser reconnect refreshes an offline shadow without promoting it', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, verifiedSaveKey } = await loadCoordinator();
  const shadow = newState();
  shadow.player.xp = 60;
  const canonical = newState();
  canonical.player.xp = 12;
  const storage = createStorage({ [accountSaveKey(accountA)]:JSON.stringify(shadow) });
  let online = false;
  const api = makeApi({
    getCurrent:async() => {
      if (!online) throw new TypeError('offline');
      return { status:200, envelope:envelope(canonical, 4) };
    },
    putCurrent:async() => assert.fail('online event must not promote the shadow'),
  });
  let onlineHandler;
  const windowObject = { addEventListener:(name, handler) => { if (name === 'online') onlineHandler = handler; } };
  const reports = [];
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState, windowObject });
  await coordinator.loadAccountSave(accountA);
  coordinator.attachOnlineSync((result) => reports.push(result));
  online = true;
  onlineHandler();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(api.calls.get.length, 2);
  assert.equal(api.calls.put.length, 0);
  assert.equal(coordinator.getMode(), 'offline-unverified');
  assert.equal(coordinator.getCurrentState().player.xp, shadow.player.xp);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountA))).player.xp, shadow.player.xp);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.player.xp, canonical.player.xp);
  assert.equal(reports[0].mode, 'offline-unverified');
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
  assert.equal(coordinator.getMode(), 'verified-online');
});

test('verified stage results install only for the active account and ignore older revisions', async () => {
  const { createAccountSaveCoordinator, verifiedSaveKey, accountSyncKey } = await loadCoordinator();
  const initial = newState();
  const storage = createStorage();
  const api = makeApi({
    getCurrent:async() => ({ status:200, envelope:envelope(initial, 5) }),
    putCurrent:async() => assert.fail('verified stage result installation must not issue a save write'),
  });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  await coordinator.loadAccountSave(accountA);

  const rewarded = structuredClone(initial);
  rewarded.gold = 45;
  const installed = coordinator.installVerifiedState(accountA, envelope(rewarded, 6));
  assert.equal(installed.ok, true);
  assert.equal(coordinator.getSaveRevision(), 6);
  assert.equal(coordinator.getCurrentState().gold, 45);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.gold, 45);
  assert.deepEqual(JSON.parse(storage.getItem(accountSyncKey(accountA))), { revision:6, pending:false, trust:'verified' });

  const stale = structuredClone(initial);
  stale.gold = 900;
  const staleResult = coordinator.installVerifiedState(accountA, envelope(stale, 5));
  assert.equal(staleResult.ok, true);
  assert.equal(staleResult.stale, true);
  assert.equal(coordinator.getCurrentState().gold, 45);
  assert.equal(coordinator.getSaveRevision(), 6);

  const otherAccount = coordinator.installVerifiedState(accountB, envelope(stale, 7));
  assert.deepEqual(otherAccount, { ok:false, error:'stale-account-operation' });
  assert.equal(coordinator.getCurrentState().gold, 45);
  assert.equal(api.calls.put.length, 0);
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

test('profile actions sync pending client state, bind to the current revision, and install canonical response state', async () => {
  const { createAccountSaveCoordinator, verifiedSaveKey, accountSyncKey } = await loadCoordinator();
  const initial = newState();
  const storage = createStorage();
  const api = makeApi({
    getCurrent:async() => ({ status:200, envelope:envelope(initial, 5) }),
    putCurrent:async(_account, body) => ({ status:200, envelope:envelope(body.state, 6) }),
  });
  let actionCall;
  api.applyProfileAction = async (account, body) => {
    actionCall = { account, body };
    const state = structuredClone(api.calls.put[0].body.state);
    state.gold = 75;
    return { status:200, revision:7, appliedRevision:7, state, replayed:false };
  };
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory:newState });
  const loaded = await coordinator.loadAccountSave(accountA);
  const changed = structuredClone(loaded.state);
  changed.player.baseStats.attack += 1;
  coordinator.saveLocal(changed);

  const result = await coordinator.applyProfileAction({ type:'spend-gold', amount:25 });

  assert.equal(api.calls.put.length, 1);
  assert.equal(actionCall.account, accountA);
  assert.equal(actionCall.body.expectedSaveRevision, 6);
  assert.match(actionCall.body.actionId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(actionCall.body.action, { type:'spend-gold', amount:25 });
  assert.equal(result.ok, true);
  assert.equal(coordinator.getSaveRevision(), 7);
  assert.equal(coordinator.getCurrentState().gold, 75);
  assert.equal(coordinator.getCurrentState().player.baseStats.attack, changed.player.baseStats.attack);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, false);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.gold, 75);
});

test('409 conflict backs up pending local state, applies cloud state and never auto-overwrites it', async () => {
  const { createAccountSaveCoordinator, accountSaveKey, verifiedSaveKey, accountSyncKey, recoveryKeyPrefix } = await loadCoordinator();
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
  localPending.player.currentHp = 37;
  const pendingHp = localPending.player.currentHp;
  coordinator.saveLocal(localPending);
  const conflict = await coordinator.syncPendingSave();

  assert.equal(conflict.error, 'save-conflict');
  assert.equal(puts, 1);
  assert.equal(coordinator.getCurrentState().player.level, 13);
  assert.equal(JSON.parse(storage.getItem(verifiedSaveKey(accountA))).state.player.level, 13);
  assert.equal(JSON.parse(storage.getItem(accountSyncKey(accountA))).pending, false);
  const recovery = [...storage.entries.keys()].find((key) => key.startsWith(recoveryKeyPrefix(accountA)));
  assert.ok(recovery);
  assert.equal(JSON.parse(storage.getItem(recovery)).player.currentHp, pendingHp);
});

test('an offline account starts from a fresh local state instead of another account legacy save', async () => {
  const { createAccountSaveCoordinator, LEGACY_OWNER_KEY, accountSaveKey } = await loadCoordinator();
  const storage = createStorage({
    [LEGACY_SAVE_KEY]: JSON.stringify(legacyState()),
    [LEGACY_OWNER_KEY]: JSON.stringify({ tenantId: accountA.tenantId, objectId: accountA.localAccountId }),
  });
  const api = makeApi({ getCurrent: async () => { throw new TypeError('Failed to fetch'); }, putCurrent: async () => assert.fail('offline') });
  const coordinator = createAccountSaveCoordinator({ storage, api, initialStateFactory: newState });
  const loaded = await coordinator.loadAccountSave(accountB);
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.mode, 'offline-unverified');
  assert.equal(loaded.state.player.level, 1);
  assert.equal(JSON.parse(storage.getItem(accountSaveKey(accountB))).player.level, 1);
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
