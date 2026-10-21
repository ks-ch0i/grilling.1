import { SAVE_KEY, isValidGameState, readSavedGame, saveGameState } from './saveStore.js';

export const LEGACY_OWNER_KEY = 'lancer-belt-scroll-game:save:v1:legacy-owner';

function accountIdentity(account) {
  const tenantId = String(account?.tenantId ?? '').trim().toLowerCase();
  const objectId = String(account?.idTokenClaims?.oid ?? account?.localAccountId ?? '').trim().toLowerCase();
  if (!tenantId || !objectId) throw new TypeError('The selected account is missing its Entra tenant or object id.');
  return { tenantId, objectId };
}

export function accountSaveKey(account) {
  const { tenantId, objectId } = accountIdentity(account);
  return `lancer-belt-scroll-game:save:v1:${tenantId}:${objectId}`;
}

export function accountSyncKey(account) {
  return `${accountSaveKey(account)}:sync`;
}

export function recoveryKeyPrefix(account) {
  const { tenantId, objectId } = accountIdentity(account);
  return `lancer-belt-scroll-game:recovery:v1:${tenantId}:${objectId}:`;
}

function storageFor(storage) {
  return storage ?? globalThis.localStorage;
}

function readJson(storage, key) {
  try {
    const value = storageFor(storage).getItem(key);
    return value === null ? { exists: false, value: null } : { exists: true, value: JSON.parse(value) };
  } catch {
    return { exists: false, value: null, invalid: true };
  }
}

function readRaw(storage, key) {
  try { return storageFor(storage).getItem(key); } catch { return null; }
}

function readSyncState(storage, key) {
  const saved = readJson(storage, key);
  const value = saved.value;
  if (!saved.exists || !value || typeof value !== 'object' || typeof value.pending !== 'boolean' ||
      (value.revision !== null && (!Number.isSafeInteger(value.revision) || value.revision < 1))) {
    return { revision: null, pending: false };
  }
  return { revision: value.revision, pending: value.pending };
}

function writeSyncState(storage, key, value) {
  try {
    storageFor(storage).setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readLegacyOwner(storage) {
  const saved = readJson(storage, LEGACY_OWNER_KEY);
  if (!saved.exists) return null;
  if (!saved.value || typeof saved.value.tenantId !== 'string' || typeof saved.value.objectId !== 'string') {
    return { tenantId: '__invalid__', objectId: '__invalid__' };
  }
  return {
    tenantId: saved.value.tenantId.toLowerCase(),
    objectId: saved.value.objectId.toLowerCase(),
  };
}

function isOwner(owner, identity) {
  return owner?.tenantId === identity.tenantId && owner?.objectId === identity.objectId;
}

function envelopeFrom(result) {
  return result?.envelope ?? result?.current ?? result?.cloud ?? null;
}

function validRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mutateState(target, source) {
  if (!target || typeof target !== 'object') return source;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(source));
  return target;
}

export function createAccountSaveCoordinator({
  storage,
  api,
  initialStateFactory,
  now = () => new Date(),
  windowObject = globalThis.window,
  onConflict = () => {},
} = {}) {
  if (!api || typeof api.getCurrent !== 'function' || typeof api.putCurrent !== 'function') {
    throw new TypeError('Cloud save API methods are required.');
  }
  if (typeof initialStateFactory !== 'function') throw new TypeError('An initial save factory is required.');

  let activeAccount = null;
  let activeIdentity = null;
  let activeState = null;
  let mode = 'offline';
  let syncPromise = null;
  let onlineListener;

  function getCurrentState() {
    return activeState;
  }

  function getMode() {
    return mode;
  }

  function saveLocally(state, { pending = true } = {}) {
    const key = accountSaveKey(activeAccount);
    const saved = saveGameState(state, storage, key);
    if (!saved.ok) return saved;
    const previous = readSyncState(storage, accountSyncKey(activeAccount));
    if (!writeSyncState(storage, accountSyncKey(activeAccount), {
      revision: previous.revision,
      pending: pending || previous.pending,
    })) return { ok: false, error: 'storage-unavailable' };
    activeState = state;
    return { ok: true };
  }

  function backupState(state) {
    if (!state) return { ok: true, key: null };
    const prefix = recoveryKeyPrefix(activeAccount);
    const timestamp = now();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new TypeError('Recovery clock returned an invalid time.');
    const baseKey = `${prefix}${timestamp.toISOString()}`;
    try {
      const localStorage = storageFor(storage);
      let key = baseKey;
      let suffix = 1;
      while (localStorage.getItem(key) !== null) key = `${baseKey}:${suffix++}`;
      const saved = saveGameState(state, localStorage, key);
      return saved.ok ? { ok: true, key } : { ok: false, key: null };
    } catch {
      return { ok: false, key: null };
    }
  }

  function backupSerialized(serialized) {
    if (typeof serialized !== 'string') return { ok: false, key: null };
    const prefix = recoveryKeyPrefix(activeAccount);
    const timestamp = now();
    if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) throw new TypeError('Recovery clock returned an invalid time.');
    const baseKey = `${prefix}${timestamp.toISOString()}`;
    try {
      const target = storageFor(storage);
      let key = baseKey;
      let suffix = 1;
      while (target.getItem(key) !== null) key = `${baseKey}:${suffix++}`;
      target.setItem(key, serialized);
      return { ok: true, key };
    } catch {
      return { ok: false, key: null };
    }
  }

  function installCloudState(envelope, { backup = [] } = {}) {
    const cloudState = envelope?.state;
    const revision = validRevision(envelope?.revision);
    if (!cloudState || !revision || !isValidGameState(cloudState)) return { ok: false, error: 'invalid-cloud-save' };
    let recoveredLocal = false;
    for (const entry of backup) {
      const state = entry && Object.hasOwn(entry, 'state') ? entry.state : entry;
      const raw = entry && Object.hasOwn(entry, 'raw') ? entry.raw : null;
      const differs = state ? !statesEqual(state, cloudState) : raw !== null;
      if (differs) {
        const stored = raw !== null ? backupSerialized(raw) : backupState(state);
        if (!stored.ok) return { ok: false, error: 'recovery-backup-failed' };
        recoveredLocal = true;
      }
    }
    const saved = saveGameState(cloudState, storage, accountSaveKey(activeAccount));
    const metadataSaved = writeSyncState(storage, accountSyncKey(activeAccount), { revision, pending: false });
    activeState = mutateState(activeState, cloudState);
    mode = 'online';
    return { ok: true, state: activeState, revision, savedLocally: saved.ok && metadataSaved, recoveredLocal };
  }

  function offlineResult(localState, fallbackState = null) {
    const state = localState ?? fallbackState;
    if (!state) return { status: 'offline-unavailable', state: undefined, mode: 'offline' };
    activeState = state;
    mode = 'offline';
    return {
      status: 'ready',
      state: activeState,
      revision: readSyncState(storage, accountSyncKey(activeAccount)).revision,
      mode,
      savedLocally: Boolean(localState),
    };
  }

  function ownerCanUseLegacy(owner) {
    return owner === null || isOwner(owner, activeIdentity);
  }

  function claimLegacyOwner() {
    try {
      const target = storageFor(storage);
      target.setItem(LEGACY_OWNER_KEY, JSON.stringify(activeIdentity));
      return isOwner(readLegacyOwner(target), activeIdentity);
    } catch {
      return false;
    }
  }

  async function putInitialState(state, legacyMigration) {
    const localResult = saveGameState(state, storage, accountSaveKey(activeAccount));
    const metadataSaved = writeSyncState(storage, accountSyncKey(activeAccount), { revision: null, pending: true });
    activeState = state;
    let response;
    try {
      response = await api.putCurrent(activeAccount, { state }, { kind: 'create' });
    } catch (error) {
      if (error?.name === 'CloudSaveAuthenticationError') return { status: 'error', code: 'authentication-required' };
      if (error instanceof TypeError) return offlineResult(readSavedGame(storage, accountSaveKey(activeAccount)), state);
      return { status: 'error', code: 'cloud-save-unavailable', cause: error };
    }
    if (response.status === 200 || response.status === 201) {
      const envelope = envelopeFrom(response);
      const installed = installCloudState(envelope);
      const ownerSaved = !legacyMigration || !installed.ok || claimLegacyOwner();
      return installed.ok
        ? { status: 'ready', state: activeState, revision: installed.revision, mode: 'online', savedLocally: localResult.ok && metadataSaved && installed.savedLocally, legacyOwnerSaved: ownerSaved, recoveredLocal: installed.recoveredLocal }
        : { status: 'error', code: installed.error };
    }
    if (response.status === 409) {
      const current = envelopeFrom(response);
      const installed = installCloudState(current, { backup: [state] });
      const ownerSaved = !legacyMigration || !installed.ok || claimLegacyOwner();
      return installed.ok
        ? { status: 'ready', state: activeState, revision: installed.revision, mode: 'online', savedLocally: localResult.ok && metadataSaved && installed.savedLocally, legacyOwnerSaved: ownerSaved, recoveredLocal: installed.recoveredLocal }
        : { status: 'error', code: installed.error };
    }
    if (response.status >= 500) return offlineResult(readSavedGame(storage, accountSaveKey(activeAccount)), state);
    return { status: 'error', code: response.status === 401 || response.status === 403 ? 'authentication-required' : 'cloud-save-rejected' };
  }

  async function loadAccountSave(account) {
    activeAccount = account;
    activeIdentity = accountIdentity(account);
    activeState = null;
    const localState = readSavedGame(storage, accountSaveKey(account));
    let response;
    try {
      response = await api.getCurrent(account);
    } catch (error) {
      if (error?.name === 'CloudSaveAuthenticationError') return { status: 'error', code: 'authentication-required' };
      if (error instanceof TypeError) return offlineResult(localState);
      return { status: 'error', code: 'cloud-save-unavailable', cause: error };
    }
    if (response.status >= 500) return offlineResult(localState);
    if (response.status === 401 || response.status === 403) return { status: 'error', code: 'authentication-required' };

    if (response.status === 200) {
      const envelope = envelopeFrom(response);
      const legacyOwner = readLegacyOwner(storage);
      const legacyAllowed = ownerCanUseLegacy(legacyOwner);
      const backups = [
        { state: localState, raw: readRaw(storage, accountSaveKey(account)) },
        ...(legacyAllowed ? [{ state: readSavedGame(storage, SAVE_KEY), raw: readRaw(storage, SAVE_KEY) }] : []),
      ].filter((entry) => entry.state || entry.raw !== null);
      const installed = installCloudState(envelope, { backup: backups });
      return installed.ok
        ? { status: 'ready', state: activeState, revision: installed.revision, mode: 'online', savedLocally: installed.savedLocally, recoveredLocal: installed.recoveredLocal }
        : { status: 'error', code: installed.error };
    }
    if (response.status !== 404) return { status: 'error', code: 'cloud-save-unavailable', httpStatus: response.status };

    const legacyOwner = readLegacyOwner(storage);
    const legacyState = ownerCanUseLegacy(legacyOwner) ? readSavedGame(storage, SAVE_KEY) : null;
    const localRaw = readRaw(storage, accountSaveKey(account));
    if (!localState && localRaw !== null) {
      const preserved = backupSerialized(localRaw);
      if (!preserved.ok) return { status: 'error', code: 'recovery-backup-failed' };
    }
    const source = localState ? 'account' : legacyState ? 'legacy' : 'initial';
    const state = localState ?? legacyState ?? initialStateFactory();
    return putInitialState(state, source === 'legacy' && legacyOwner === null);
  }

  async function performSync() {
    if (!activeAccount || !activeIdentity || !activeState) return { ok: false, error: 'account-not-ready' };
    const key = accountSaveKey(activeAccount);
    const metaKey = accountSyncKey(activeAccount);
    const meta = readSyncState(storage, metaKey);
    const state = readSavedGame(storage, key);
    if (!meta.pending) return { ok: true, synced: false, mode };
    if (!state) return { ok: false, error: 'local-save-invalid' };
    const serialized = JSON.stringify(state);
    const condition = meta.revision === null
      ? { kind: 'create' }
      : { kind: 'update', expectedRevision: meta.revision };
    let response;
    try {
      response = await api.putCurrent(activeAccount, { state }, condition);
    } catch (error) {
      if (error?.name === 'CloudSaveAuthenticationError') return { ok: false, error: 'authentication-required' };
      if (error instanceof TypeError) {
        mode = 'offline';
        return { ok: false, error: 'network-unavailable' };
      }
      return { ok: false, error: 'cloud-save-unavailable', cause: error };
    }
    if (response.status >= 500) {
      mode = 'offline';
      return { ok: false, error: 'network-unavailable', status: response.status };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'authentication-required' };
    if (response.status === 409) {
      const latestState = readSavedGame(storage, key);
      const current = envelopeFrom(response);
      const installed = installCloudState(current, { backup: [latestState] });
      if (!installed.ok) return { ok: false, error: installed.error };
      try { onConflict({ account: activeAccount, recoverySaved: Boolean(latestState), state: activeState }); } catch { /* UI callbacks cannot change save resolution. */ }
      return { ok: false, error: 'save-conflict', state: activeState, recoveredLocal: installed.recoveredLocal };
    }
    if (response.status !== 200 && response.status !== 201) return { ok: false, error: 'cloud-save-rejected', status: response.status };

    const envelope = envelopeFrom(response);
    const revision = validRevision(envelope?.revision);
    if (!revision) return { ok: false, error: 'invalid-cloud-save-response' };
    const latestLocal = readSavedGame(storage, key);
    const changedDuringRequest = !latestLocal || JSON.stringify(latestLocal) !== serialized;
    if (!writeSyncState(storage, metaKey, { revision, pending: changedDuringRequest })) {
      return { ok: false, error: 'storage-unavailable' };
    }
    mode = 'online';
    return { ok: true, synced: true, pending: changedDuringRequest, revision, mode };
  }

  function syncPendingSave() {
    if (syncPromise) return syncPromise;
    let retryAfterSync = false;
    syncPromise = performSync().then((result) => {
      retryAfterSync = result.ok && result.pending;
      return result;
    }).finally(() => {
      syncPromise = null;
      if (retryAfterSync) queueMicrotask(() => { void syncPendingSave(); });
    });
    return syncPromise;
  }

  function saveLocal(state) {
    if (!activeAccount) return { ok: false, error: 'account-not-ready' };
    return saveLocally(state, { pending: true });
  }

  function attachOnlineSync(onSyncResult = () => {}) {
    if (!windowObject?.addEventListener || onlineListener) return;
    onlineListener = () => {
      void syncPendingSave().then(onSyncResult).catch(() => onSyncResult({ ok: false, error: 'cloud-save-unavailable' }));
    };
    windowObject.addEventListener('online', onlineListener);
  }

  function dispose() {
    if (onlineListener) windowObject?.removeEventListener?.('online', onlineListener);
    onlineListener = undefined;
  }

  return {
    loadAccountSave,
    saveLocal,
    syncPendingSave,
    attachOnlineSync,
    dispose,
    getCurrentState,
    getMode,
  };
}
