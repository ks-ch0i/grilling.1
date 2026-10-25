import {
  LEGACY_SAVE_KEY,
  isValidGameState,
  readOrMigrateSavedGame,
  readSavedGame,
  saveGameState,
} from './saveStore.js';

export const LEGACY_OWNER_KEY = 'lancer-belt-scroll-game:save:v1:legacy-owner';

function accountIdentity(account) {
  const tenantId = String(account?.tenantId ?? '').trim().toLowerCase();
  const objectId = String(account?.idTokenClaims?.oid ?? account?.localAccountId ?? '').trim().toLowerCase();
  if (!tenantId || !objectId) throw new TypeError('The selected account is missing its Entra tenant or object id.');
  return { tenantId, objectId };
}

export function accountSaveKey(account) {
  const { tenantId, objectId } = accountIdentity(account);
  return `lancer-belt-scroll-game:save:v2:${tenantId}:${objectId}`;
}

export function legacyAccountSaveKey(account) {
  const { tenantId, objectId } = accountIdentity(account);
  return `lancer-belt-scroll-game:save:v1:${tenantId}:${objectId}`;
}

export function accountSyncKey(account) {
  return `${accountSaveKey(account)}:sync`;
}

export function verifiedSaveKey(account) {
  return `${accountSaveKey(account)}:verified-backup:v1`;
}

export function verifiedPendingSaveKey(account) {
  return `${accountSaveKey(account)}:verified-pending:v1`;
}

export function recoveryKeyPrefix(account) {
  const { tenantId, objectId } = accountIdentity(account);
  return `lancer-belt-scroll-game:recovery:v2:${tenantId}:${objectId}:`;
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
    return { revision: null, pending: false, trust: 'unverified' };
  }
  return {
    revision:value.revision,
    pending:value.pending,
    trust:value.trust === 'verified' ? 'verified' : 'unverified',
  };
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
  if (saved.invalid) return { tenantId: '__invalid__', objectId: '__invalid__' };
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

function cloneState(state) {
  return structuredClone(state);
}

function readVerifiedEnvelope(storage, account) {
  const saved = readJson(storage, verifiedSaveKey(account));
  const envelope = saved.value;
  const revision = validRevision(envelope?.revision);
  if (!saved.exists || envelope?.trust !== 'verified' || !revision || !isValidGameState(envelope.state)) return null;
  return { trust:'verified', revision, state:envelope.state };
}

function readVerifiedPending(storage, account) {
  const saved = readJson(storage, verifiedPendingSaveKey(account));
  const envelope = saved.value;
  if (!saved.exists || envelope?.trust !== 'unverified' || !isValidGameState(envelope.state)) return null;
  return { trust:'unverified', revision:validRevision(envelope.revision), state:envelope.state };
}

function writeVerifiedEnvelope(storage, account, envelope) {
  if (envelope?.trust !== 'verified' || !validRevision(envelope.revision) || !isValidGameState(envelope.state)) return false;
  try {
    storageFor(storage).setItem(verifiedSaveKey(account), JSON.stringify({
      trust:'verified', revision:envelope.revision, state:envelope.state,
    }));
    return true;
  } catch {
    return false;
  }
}

function writeVerifiedPending(storage, account, state, revision) {
  if (!isValidGameState(state)) return false;
  try {
    storageFor(storage).setItem(verifiedPendingSaveKey(account), JSON.stringify({
      trust:'unverified', revision:validRevision(revision), state,
    }));
    return true;
  } catch {
    return false;
  }
}

function removeStoredValue(storage, key) {
  try {
    storageFor(storage).removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function projectClientOwnedState(state, canonicalState) {
  if (!state || !canonicalState) throw new TypeError('A verified save projection requires a canonical base.');
  return {
    ...cloneState(canonicalState),
    player:{
      ...canonicalState.player,
      currentHp:state.player.currentHp,
      baseStats:{ ...state.player.baseStats },
      availableStatPoints:state.player.availableStatPoints,
      spentStatPoints:state.player.spentStatPoints,
      statResetCount:state.player.statResetCount,
    },
    equipment:cloneState(state.equipment),
  };
}

export function createAccountSaveCoordinator({
  storage,
  api,
  initialStateFactory,
  now = () => new Date(),
  windowObject = globalThis.window,
  onConflict = () => {},
  isGuestAccount = () => false,
} = {}) {
  if (!api || typeof api.getCurrent !== 'function' || typeof api.putCurrent !== 'function') {
    throw new TypeError('Cloud save API methods are required.');
  }
  if (typeof initialStateFactory !== 'function') throw new TypeError('An initial save factory is required.');

  let activeAccount = null;
  let activeIdentity = null;
  let activeState = null;
  let verifiedState = null;
  let activeGeneration = 0;
  let mode = 'offline-unverified';
  let hasUnverifiedShadow = false;
  let unverifiedReason = null;
  let syncPromise = null;
  let syncGeneration = null;
  let onlineListener;
  let onCloudSaveSynced = () => {};

  function notifyCloudSaveSynced(state, revision) {
    try {
      const result = onCloudSaveSynced({ state, revision });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* Snapshot publication cannot change save success. */ }
  }

  function getCurrentState() {
    return activeState;
  }

  function getSaveRevision() {
    if (!activeAccount) return null;
    return readSyncState(storage, accountSyncKey(activeAccount)).revision ??
      readVerifiedEnvelope(storage, activeAccount)?.revision ?? null;
  }

  function getMode() {
    return mode;
  }

  function saveLocally(state) {
    if (!activeAccount) return { ok:false, error:'account-not-ready' };
    if (mode === 'verified-online') {
      const canonical = verifiedState ?? readVerifiedEnvelope(storage, activeAccount)?.state;
      let candidate;
      try { candidate = projectClientOwnedState(state, canonical); }
      catch { return { ok:false, error:'invalid-state' }; }
      const revision = getSaveRevision();
      if (!writeVerifiedPending(storage, activeAccount, candidate, revision)) {
        return { ok:false, error:'storage-unavailable' };
      }
      if (!writeSyncState(storage, accountSyncKey(activeAccount), {
        revision, pending:true, trust:'verified',
      })) return { ok:false, error:'storage-unavailable' };
      activeState = state;
      return { ok:true, pending:true, mode };
    }
    const saved = saveGameState(state, storage, accountSaveKey(activeAccount));
    if (!saved.ok) return saved;
    const previous = readSyncState(storage, accountSyncKey(activeAccount));
    if (!writeSyncState(storage, accountSyncKey(activeAccount), {
      revision: previous.revision ?? readVerifiedEnvelope(storage, activeAccount)?.revision ?? null,
      pending:false,
      trust:'unverified',
    })) return { ok:false, error:'storage-unavailable' };
    activeState = state;
    hasUnverifiedShadow = true;
    return { ok:true, mode };
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

  function installCloudState(envelope, { backup = [], activate = true, clearPending = false } = {}) {
    const cloudState = envelope?.state;
    const revision = validRevision(envelope?.revision);
    if (!cloudState || !revision || !isValidGameState(cloudState)) return { ok: false, error: 'invalid-cloud-save' };
    const previous = activeAccount ? readVerifiedEnvelope(storage, activeAccount) : null;
    if (previous && revision < previous.revision) {
      return {
        ok:true,
        state:activeState ?? previous.state,
        revision:previous.revision,
        savedLocally:true,
        recoveredLocal:false,
        stale:true,
      };
    }
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
    const verifiedSaved = writeVerifiedEnvelope(storage, activeAccount, { trust:'verified', revision, state:cloudState });
    if (!verifiedSaved) return { ok:false, error:'storage-unavailable' };
    if (clearPending && !removeStoredValue(storage, verifiedPendingSaveKey(activeAccount))) {
      return { ok:false, error:'storage-unavailable' };
    }
    const metadataSaved = !activate || writeSyncState(storage, accountSyncKey(activeAccount), {
      revision, pending:false, trust:'verified',
    });
    if (!metadataSaved) return { ok:false, error:'storage-unavailable' };
    verifiedState = cloudState;
    if (activate) {
      activeState = mutateState(activeState, cloudState);
      mode = 'verified-online';
      unverifiedReason = null;
    }
    const shadow = readSavedGame(storage, accountSaveKey(activeAccount));
    hasUnverifiedShadow = Boolean(shadow && !statesEqual(shadow, cloudState)) || Boolean(readVerifiedPending(storage, activeAccount));
    return { ok:true, state:activate ? activeState : cloudState, revision, savedLocally:true, recoveredLocal, hasUnverifiedShadow };
  }

  function activateLocalShadow(state, { savedLocally = true, reason = 'offline' } = {}) {
    if (!state || !isValidGameState(state)) return { status:'offline-unavailable', state:undefined, mode:'offline-unverified' };
    let persisted = savedLocally;
    if (!savedLocally) {
      const saved = saveGameState(state, storage, accountSaveKey(activeAccount));
      persisted = saved.ok;
    }
    const revision = readVerifiedEnvelope(storage, activeAccount)?.revision ?? readSyncState(storage, accountSyncKey(activeAccount)).revision;
    if (!writeSyncState(storage, accountSyncKey(activeAccount), { revision:revision ?? null, pending:false, trust:'unverified' })) {
      return { status:'error', code:'storage-unavailable' };
    }
    activeState = state;
    mode = isGuestAccount(activeAccount) ? 'guest-unverified' : 'offline-unverified';
    hasUnverifiedShadow = true;
    unverifiedReason = reason;
    return {
      status: 'ready',
      state: activeState,
      revision,
      mode,
      savedLocally:persisted,
      storageError:persisted ? undefined : 'storage-unavailable',
      hasUnverifiedShadow,
      reason,
    };
  }

  function offlineResult(localState, fallbackState = null, savedLocally = Boolean(localState), reason = 'offline') {
    const state = localState ?? fallbackState;
    if (!state) return { status:'offline-unavailable', state:undefined, mode:'offline-unverified', hasUnverifiedShadow:false };
    return activateLocalShadow(state, { savedLocally:Boolean(savedLocally), reason });
  }

  function selectLocalShadow(reason = 'local-play-selected', { preferExisting = true } = {}) {
    if (!activeAccount || !activeIdentity) return { ok:false, error:'account-not-ready' };
    const existing = readSavedGame(storage, accountSaveKey(activeAccount));
    let state = preferExisting ? existing : null;
    if (!state) {
      state = readVerifiedPending(storage, activeAccount)?.state ??
        verifiedState ?? readVerifiedEnvelope(storage, activeAccount)?.state ?? activeState;
      if (!state || !isValidGameState(state)) return { ok:false, error:'offline-save-unavailable' };
      if (existing && !statesEqual(existing, state)) {
        const preserved = backupState(existing);
        if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
      }
      const saved = saveGameState(state, storage, accountSaveKey(activeAccount));
      if (!saved.ok) return { ok:false, error:'storage-unavailable' };
    }
    const pending = readVerifiedPending(storage, activeAccount);
    if (pending && !statesEqual(pending.state, state)) {
      const preserved = backupState(pending.state);
      if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
    }
    if (!removeStoredValue(storage, verifiedPendingSaveKey(activeAccount))) {
      return { ok:false, error:'storage-unavailable' };
    }
    const result = activateLocalShadow(state, { savedLocally:true, reason });
    return result.status === 'ready'
      ? { ok:true, state:result.state, revision:result.revision, mode:result.mode, reason, hasUnverifiedShadow:true }
      : { ok:false, error:result.code ?? 'offline-save-unavailable' };
  }

  function selectVerifiedSave() {
    if (!activeAccount || isGuestAccount(activeAccount)) return { ok:false, error:'verified-save-unavailable' };
    const saved = readVerifiedEnvelope(storage, activeAccount);
    if (!saved) return { ok:false, error:'verified-save-unavailable' };
    const installed = installCloudState(saved, { activate:true });
    if (!installed.ok) return { ok:false, error:installed.error };
    notifyCloudSaveSynced(installed.state, installed.revision);
    return { ok:true, state:installed.state, revision:installed.revision, mode:'verified-online' };
  }

  async function recoverLegacySave({ replaceShadow = false } = {}) {
    if (!activeAccount || !activeIdentity) return { ok:false, error:'account-not-ready' };
    const generation = activeGeneration;
    const account = activeAccount;
    const key = accountSaveKey(account);
    const existing = readSavedGame(storage, key);
    if (existing && !replaceShadow) return { ok:false, error:'shadow-already-exists' };
    const probeKey = `${key}:legacy-recovery-probe`;
    const installRecovered = (state, reason, claimOwner = false) => {
      if (!isValidGameState(state)) return { ok:false, error:'legacy-save-not-found' };
      if (claimOwner && !claimLegacyOwner(activeIdentity)) return { ok:false, error:'legacy-owner-save-failed' };
      if (existing) {
        const preserved = backupState(existing);
        if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
      } else {
        const raw = readRaw(storage, key);
        if (raw !== null) {
          const preserved = backupSerialized(raw);
          if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
        }
      }
      const saved = saveGameState(state, storage, key);
      if (!saved.ok) return { ok:false, error:'storage-unavailable' };
      return selectLocalShadow(reason, { preferExisting:true });
    };
    const localLegacy = readOrMigrateSavedGame(storage, probeKey, legacyAccountSaveKey(account), { persistLegacy:false });
    if (localLegacy.state) return installRecovered(localLegacy.state, 'account-legacy-recovery');
    const owner = readLegacyOwner(storage);
    if (ownerCanUseLegacy(owner)) {
      const shared = readOrMigrateSavedGame(storage, probeKey, LEGACY_SAVE_KEY, { persistLegacy:false });
      if (shared.state) return installRecovered(shared.state, 'shared-legacy-recovery', owner === null);
    }
    if (isGuestAccount(account)) return { ok:false, error:'legacy-recovery-unavailable' };
    if (typeof api.getLegacySave !== 'function') return { ok:false, error:'legacy-recovery-unavailable' };
    let response;
    try { response = await api.getLegacySave(account); }
    catch (error) {
      if (generation !== activeGeneration || account !== activeAccount) return { ok:false, error:'stale-account-operation' };
      return { ok:false, error:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable' };
    }
    if (generation !== activeGeneration || account !== activeAccount) return { ok:false, error:'stale-account-operation' };
    if (response?.status !== 200 || !isValidGameState(response.archive?.state)) {
      return { ok:false, error:response?.code ?? 'legacy-save-not-found' };
    }
    return installRecovered(response.archive.state, 'archived-legacy-recovery');
  }

  function ownerCanUseLegacy(owner) {
    return owner === null || isOwner(owner, activeIdentity);
  }

  function claimLegacyOwner(identity = activeIdentity) {
    try {
      const target = storageFor(storage);
      target.setItem(LEGACY_OWNER_KEY, JSON.stringify(identity));
      return isOwner(readLegacyOwner(target), identity);
    } catch {
      return false;
    }
  }

  async function putInitialState(state, generation = activeGeneration, localShadow = null) {
    const account = activeAccount;
    activeState = state;
    let response;
    try {
      response = await api.putCurrent(account, { state }, { kind: 'create' });
    } catch (error) {
      if (generation !== activeGeneration) return { status: 'stale-account-operation' };
      if (error?.name === 'CloudSaveAuthenticationError') return { status: 'error', code: 'authentication-required' };
      if (error instanceof TypeError) return offlineResult(localShadow, state, Boolean(localShadow), 'network-unavailable');
      return { status: 'error', code: 'cloud-save-unavailable', cause: error };
    }
    if (generation !== activeGeneration) return { status: 'stale-account-operation' };
    if (response.status === 200 || response.status === 201) {
      const envelope = envelopeFrom(response);
      const installed = installCloudState(envelope);
      if (installed.ok) notifyCloudSaveSynced(installed.state, installed.revision);
      return installed.ok
        ? { status:'ready', state:activeState, revision:installed.revision, mode:'verified-online', savedLocally:installed.savedLocally, recoveredLocal:installed.recoveredLocal, hasUnverifiedShadow:installed.hasUnverifiedShadow }
        : { status: 'error', code: installed.error };
    }
    if (response.status === 409) {
      const current = envelopeFrom(response);
      const installed = installCloudState(current);
      if (installed.ok) notifyCloudSaveSynced(installed.state, installed.revision);
      return installed.ok
        ? { status:'ready', state:activeState, revision:installed.revision, mode:'verified-online', savedLocally:installed.savedLocally, recoveredLocal:installed.recoveredLocal, hasUnverifiedShadow:installed.hasUnverifiedShadow }
        : { status: 'error', code: installed.error };
    }
    if (response.status >= 500) return offlineResult(localShadow, state, Boolean(localShadow), 'network-unavailable');
    return { status: 'error', code: response.status === 401 || response.status === 403 ? 'authentication-required' : 'cloud-save-rejected' };
  }

  async function loadAccountSave(account) {
    const generation = ++activeGeneration;
    activeAccount = account;
    try {
      activeIdentity = accountIdentity(account);
    } catch (error) {
      if (!isGuestAccount(account)) throw error;
      activeAccount = {
        ...(account && typeof account === 'object' ? account : {}),
        tenantId:'guest',
        localAccountId:'guest',
        idTokenClaims:{ ...(account?.idTokenClaims ?? {}), oid:'guest' },
      };
      activeIdentity = accountIdentity(activeAccount);
    }
    activeState = null;
    verifiedState = readVerifiedEnvelope(storage, activeAccount)?.state ?? null;
    hasUnverifiedShadow = false;
    unverifiedReason = null;
    const localLoad = readOrMigrateSavedGame(storage, accountSaveKey(activeAccount), legacyAccountSaveKey(activeAccount));
    const localState = localLoad.state;
    if (localLoad.source === 'legacy' && localLoad.currentRaw !== null) {
      const preserved = backupSerialized(localLoad.currentRaw);
      if (!preserved.ok) return { status: 'error', code: 'recovery-backup-failed' };
    }
    if (isGuestAccount(account)) {
      return offlineResult(localState, initialStateFactory(), localLoad.savedLocally, 'guest');
    }
    const unfinished = readVerifiedPending(storage, activeAccount);
    if (unfinished) {
      const preserved = backupState(unfinished.state);
      if (!preserved.ok || !removeStoredValue(storage, verifiedPendingSaveKey(activeAccount))) {
        return { status:'error', code:'recovery-backup-failed' };
      }
    }
    let response;
    try {
      response = await api.getCurrent(account);
    } catch (error) {
      if (generation !== activeGeneration) return { status: 'stale-account-operation' };
      if (error?.name === 'CloudSaveAuthenticationError') return { status: 'error', code: 'authentication-required' };
      if (error instanceof TypeError) return offlineResult(localState, verifiedState ?? initialStateFactory(), localLoad.savedLocally, 'network-unavailable');
      return { status: 'error', code: 'cloud-save-unavailable', cause: error };
    }
    if (generation !== activeGeneration) return { status: 'stale-account-operation' };
    if (response.status >= 500) return offlineResult(localState, verifiedState ?? initialStateFactory(), localLoad.savedLocally, 'network-unavailable');
    if (response.status === 401 || response.status === 403) return { status: 'error', code: 'authentication-required' };

    if (response.status === 200) {
      const envelope = envelopeFrom(response);
      const localRaw = readRaw(storage, accountSaveKey(account));
      const backups = localState || localRaw !== null ? [{ state:localState, raw:localState ? null : localRaw }] : [];
      const installed = installCloudState(envelope, { backup: backups });
      return installed.ok
        ? { status:'ready', state:activeState, revision:installed.revision, mode:'verified-online', savedLocally:installed.savedLocally, recoveredLocal:installed.recoveredLocal, hasUnverifiedShadow:installed.hasUnverifiedShadow }
        : { status: 'error', code: installed.error };
    }
    if (response.status !== 404) return { status: 'error', code: 'cloud-save-unavailable', httpStatus: response.status };
    const localRaw = readRaw(storage, accountSaveKey(account));
    if (!localState && localRaw !== null) {
      const preserved = backupSerialized(localRaw);
      if (!preserved.ok) return { status: 'error', code: 'recovery-backup-failed' };
    }
    return putInitialState(initialStateFactory(), generation, localState);
  }

  async function refreshAccountSave({ activate = mode === 'verified-online' } = {}) {
    if (!activeAccount) return { status: 'error', code: 'account-not-ready' };
    if (isGuestAccount(activeAccount)) return { status:'error', code:'guest-unverified', mode };
    const generation = activeGeneration;
    const account = activeAccount;
    let response;
    try { response = await api.getCurrent(account); }
    catch (error) {
      if (generation !== activeGeneration) return { status:'stale-account-operation' };
      return { status:'error', code:error?.name === 'CloudSaveAuthenticationError' ? 'authentication-required' : 'network-unavailable' };
    }
    if (generation !== activeGeneration || account !== activeAccount) return { status:'stale-account-operation' };
    if (response.status === 401 || response.status === 403) return { status:'error', code:'authentication-required' };
    if (response.status !== 200) return { status:'error', code:response.code ?? 'cloud-save-unavailable', httpStatus:response.status };
    const installed = installCloudState(envelopeFrom(response), { activate });
    if (!installed.ok) return { status:'error', code:installed.error };
    if (activate) notifyCloudSaveSynced(installed.state, installed.revision);
    return {
      status:'ready',
      state:installed.state,
      revision:installed.revision,
      mode:activate ? 'verified-online' : mode,
      savedLocally:installed.savedLocally,
      hasUnverifiedShadow,
    };
  }

  function preservePendingAsShadow(state, reason) {
    const key = accountSaveKey(activeAccount);
    const existing = readSavedGame(storage, key);
    if (existing && !statesEqual(existing, state)) {
      const preserved = backupState(existing);
      if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
    }
    const saved = saveGameState(state, storage, key);
    if (!saved.ok) return saved;
    if (!removeStoredValue(storage, verifiedPendingSaveKey(activeAccount))) {
      return { ok:false, error:'storage-unavailable' };
    }
    const activated = activateLocalShadow(state, { savedLocally:true, reason });
    return activated.status === 'ready'
      ? { ok:true, state:activated.state, mode:activated.mode }
      : { ok:false, error:activated.code ?? 'offline-save-unavailable' };
  }

  async function performSync(generation = activeGeneration) {
    if (!activeAccount || !activeIdentity || !activeState) return { ok:false, error:'account-not-ready' };
    if (mode !== 'verified-online') {
      return { ok:false, error:mode === 'guest-unverified' ? 'guest-unverified' : 'unverified-shadow', mode };
    }
    const account = activeAccount;
    const metaKey = accountSyncKey(account);
    const meta = readSyncState(storage, metaKey);
    if (!meta.pending) return { ok:true, synced:false, mode };
    const draft = readVerifiedPending(storage, account);
    const canonical = verifiedState ?? readVerifiedEnvelope(storage, account)?.state;
    if (!draft || !canonical) return { ok:false, error:'local-save-invalid' };
    const serialized = JSON.stringify(draft.state);
    let state;
    try { state = projectClientOwnedState(draft.state, canonical); }
    catch { return { ok:false, error:'local-save-invalid' }; }
    const revision = readVerifiedEnvelope(storage, account)?.revision ?? meta.revision;
    if (!validRevision(revision)) return { ok:false, error:'save-revision-unavailable' };
    let response;
    try {
      response = await api.putCurrent(account, { state }, { kind:'update', expectedRevision:revision });
    } catch (error) {
      if (generation !== activeGeneration) return { ok:false, error:'stale-account-operation' };
      if (error?.name === 'CloudSaveAuthenticationError') return { ok:false, error:'authentication-required' };
      if (error instanceof TypeError) {
        const saved = preservePendingAsShadow(draft.state, 'network-unavailable');
        return saved.ok ? { ok:false, error:'network-unavailable', mode:saved.mode } : saved;
      }
      return { ok:false, error:'cloud-save-unavailable', cause:error };
    }
    if (generation !== activeGeneration) return { ok:false, error:'stale-account-operation' };
    if (response.status >= 500) {
      const saved = preservePendingAsShadow(draft.state, 'network-unavailable');
      return saved.ok ? { ok:false, error:'network-unavailable', status:response.status, mode:saved.mode } : saved;
    }
    if (response.status === 401 || response.status === 403) return { ok:false, error:'authentication-required' };
    if (response.status === 409) {
      const latest = readVerifiedPending(storage, account);
      if (latest) {
        const preserved = backupState(latest.state);
        if (!preserved.ok) return { ok:false, error:'recovery-backup-failed' };
      }
      const installed = installCloudState(envelopeFrom(response), { clearPending:true });
      if (!installed.ok) return { ok:false, error:installed.error };
      try { onConflict({ account, recoverySaved:Boolean(latest), state:activeState }); } catch { /* UI callbacks cannot change save resolution. */ }
      return { ok:false, error:'save-conflict', state:activeState, recoveredLocal:installed.recoveredLocal };
    }
    if (response.status !== 200 && response.status !== 201) {
      return { ok:false, error:'cloud-save-rejected', status:response.status };
    }

    const envelope = envelopeFrom(response);
    const latestDraft = readVerifiedPending(storage, account);
    const changedDuringRequest = Boolean(latestDraft && JSON.stringify(latestDraft.state) !== serialized);
    const installed = installCloudState(envelope, { activate:!changedDuringRequest, clearPending:!changedDuringRequest });
    if (!installed.ok) return { ok:false, error:installed.error };
    if (changedDuringRequest) {
      const nextState = projectClientOwnedState(latestDraft.state, installed.state);
      if (!writeVerifiedPending(storage, account, nextState, installed.revision) ||
          !writeSyncState(storage, metaKey, { revision:installed.revision, pending:true, trust:'verified' })) {
        return { ok:false, error:'storage-unavailable' };
      }
      activeState = nextState;
    } else {
      notifyCloudSaveSynced(installed.state, installed.revision);
    }
    return {
      ok:true,
      synced:true,
      pending:changedDuringRequest,
      revision:installed.revision,
      mode:'verified-online',
    };
  }

  function syncPendingSave() {
    const generation = activeGeneration;
    if (syncPromise && syncGeneration === generation) return syncPromise;
    const currentPromise = performSync(generation).finally(() => {
      if (syncPromise === currentPromise) {
        syncPromise = null;
        syncGeneration = null;
      }
    });
    syncPromise = currentPromise;
    syncGeneration = generation;
    return currentPromise;
  }
  function saveLocal(state) {
    if (!activeAccount) return { ok: false, error: 'account-not-ready' };
    return saveLocally(state);
  }

  function installVerifiedState(account, envelope) {
    if (!activeAccount || !activeIdentity || !envelope) return { ok: false, error: 'account-not-ready' };
    let identity;
    try {
      identity = accountIdentity(account);
    } catch {
      return { ok: false, error: 'stale-account-operation' };
    }
    if (!isOwner(activeIdentity, identity)) return { ok: false, error: 'stale-account-operation' };
    const installed = installCloudState(envelope);
    if (installed.ok) notifyCloudSaveSynced(installed.state, installed.revision);
    return installed;
  }

  function applyVerifiedState(envelope, account = activeAccount) {
    return installVerifiedState(account, envelope);
  }

  function hasUnverifiedShadowState() {
    if (!activeAccount) return false;
    const shadow = readSavedGame(storage, accountSaveKey(activeAccount));
    return hasUnverifiedShadow || Boolean(shadow && (!verifiedState || !statesEqual(shadow, verifiedState))) ||
      Boolean(readVerifiedPending(storage, activeAccount));
  }

  async function applyProfileAction(action, { actionId } = {}) {
    if (typeof api.applyProfileAction !== 'function') return { ok: false, error: 'profile-actions-unavailable' };
    if (!activeAccount || !activeState) return { ok: false, error: 'account-not-ready' };
    if (mode !== 'verified-online') return { ok:false, error:'unverified-shadow', state:activeState };
    if (typeof actionId !== 'string') actionId = globalThis.crypto?.randomUUID?.();
    if (typeof actionId !== 'string') return { ok: false, error: 'action-id-unavailable' };

    const synced = await syncPendingSave();
    if (!synced.ok) return { ok: false, error: synced.error, state: activeState };
    if (mode !== 'verified-online') return { ok: false, error: mode === 'guest-unverified' ? 'guest-unverified' : 'network-unavailable', state: activeState };
    const expectedSaveRevision = getSaveRevision();
    if (!expectedSaveRevision) return { ok: false, error: 'save-revision-unavailable', state: activeState };

    let response;
    try {
      response = await api.applyProfileAction(activeAccount, {
        actionId,
        expectedSaveRevision,
        action,
      });
    } catch (error) {
      if (error?.name === 'CloudSaveAuthenticationError') {
        return { ok: false, error: 'authentication-required', actionId, state: activeState };
      }
      return { ok: false, error: 'network-unavailable', actionId, state: activeState };
    }

    if (response.status === 200) {
      const installed = installCloudState({ revision: response.revision, state: response.state }, { clearPending:true });
      if (!installed.ok) return { ok: false, error: installed.error, actionId, state: activeState };
      return { ...response, ok: true, actionId, state: activeState };
    }
    if (response.status === 409 && response.state && response.revision) {
      const installed = installCloudState({ revision: response.revision, state: response.state });
      return {
        ...response,
        ok: false,
        error: response.code,
        actionId,
        state: installed.ok ? activeState : undefined,
      };
    }
    return {
      ...response,
      ok: false,
      error: response.code ?? (response.status >= 500 ? 'service-unavailable' : 'profile-action-rejected'),
      actionId,
      state: activeState,
    };
  }

  function attachOnlineSync(onSyncResult = () => {}) {
    if (!windowObject?.addEventListener || onlineListener) return;
    onlineListener = () => {
      void refreshAccountSave({ activate:mode === 'verified-online' }).then((result) => onSyncResult({
        ok:result.status === 'ready',
        error:result.code,
        mode:result.mode,
        revision:result.revision,
        hasUnverifiedShadow:result.hasUnverifiedShadow,
      })).catch(() => onSyncResult({ ok:false, error:'cloud-save-unavailable' }));
    };
    windowObject.addEventListener('online', onlineListener);
  }

  function setCloudSaveCallback(callback = () => {}) {
    onCloudSaveSynced = typeof callback === 'function' ? callback : () => {};
  }

  function dispose() {
    if (onlineListener) windowObject?.removeEventListener?.('online', onlineListener);
    onlineListener = undefined;
  }

  return {
    loadAccountSave,
    refreshAccountSave,
    saveLocal,
    applyProfileAction,
    installVerifiedState,
    applyVerifiedState,
    selectLocalShadow,
    selectVerifiedSave,
    recoverLegacySave,
    syncPendingSave,
    attachOnlineSync,
    setCloudSaveCallback,
    dispose,
    getCurrentState,
    getSaveRevision,
    getMode,
    hasUnverifiedShadow:hasUnverifiedShadowState,
  };
}
