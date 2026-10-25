import { randomUUID } from 'node:crypto';
import * as defaultRepository from '../repositories/cloudSaveRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { defaultRewardProfile, mergeRewardProfile, parseRewardProfile } from '../domain/playerProfile.js';
import { parseCloudSave, validateCloudSave } from '../domain/cloudSave.js';

function isDuplicateKey(error) {
  return error?.number === 2601 || error?.number === 2627 ||
    error?.originalError?.info?.number === 2601 || error?.originalError?.info?.number === 2627;
}

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? defaultRepository,
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    clock: dependencies.clock ?? (() => new Date()),
  };
}

async function readCurrent(pool, identity, repository) {
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return null;
  const row = await repository.getByPlayerId(pool, playerId);
  return row ? parseCloudSave(row, parseRewardProfile(row.RewardProfile)) : null;
}

export async function getCurrent(pool, identity, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const envelope = await readCurrent(pool, identity, repository);
  return envelope ? { status: 200, envelope } : { status: 404, code: 'save-not-found' };
}

export async function putCurrent(pool, identity, body, precondition, dependencies) {
  const { repository, withTransaction, clock } = dependenciesWithDefaults(dependencies);
  const validated = validateCloudSave(body);
  const timestamp = clock();
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError('Cloud save clock returned an invalid timestamp.');
  }

  if (precondition?.kind === 'create') {
    const playerId = await repository.getOrCreatePlayerId(pool, identity);
    const created = await withTransaction(pool, async (transaction) => {
      const initialProfile = defaultRewardProfile();
      const initialState = mergeRewardProfile(validated.state, initialProfile);
      let row;
      try {
        row = await repository.insertInitial(transaction, {
          playerId,
          schemaVersion: validated.schemaVersion,
          saveJson: JSON.stringify(initialState),
          updatedAtUtc: timestamp,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        return { duplicateSave: true };
      }
      if (!row) throw new Error('Initial cloud save insert returned no row.');
      const profileRow = await repository.createRewardProfile(
        transaction, playerId, initialProfile, timestamp,
      );
      if (!profileRow) throw new Error('Initial reward profile insert returned no row.');
      return { row, profile: parseRewardProfile(profileRow) };
    });
    if (created.duplicateSave) {
      const current = await readCurrent(pool, identity, repository);
      return { status: 409, code: 'save-conflict', current };
    }
    const state = mergeRewardProfile(validated.state, created.profile);
    const envelope = parseCloudSave({ ...created.row, SaveJson: JSON.stringify(state) }, created.profile);
    return { status: 201, envelope };
  }

  if (precondition?.kind !== 'update' || !Number.isSafeInteger(precondition.expectedRevision) || precondition.expectedRevision < 1) {
    throw new TypeError('Cloud save precondition is invalid.');
  }
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'save-not-found' };

  const updated = await withTransaction(pool, async (transaction) => {
    const saveRow = await repository.getSaveForUpdate(transaction, playerId);
    if (!saveRow) return null;
    const profileRow = await repository.getRewardProfileByPlayerId(transaction, playerId, { lock: true });
    const profile = parseRewardProfile(profileRow);
    if (Number(saveRow.Revision) !== precondition.expectedRevision) return null;
    const state = mergeRewardProfile(validated.state, profile);
    const row = await repository.compareAndSwap(transaction, {
      playerId,
      schemaVersion: validated.schemaVersion,
      saveJson: JSON.stringify(state),
      updatedAtUtc: timestamp,
      expectedRevision: precondition.expectedRevision,
    });
    return row ? { row, profile } : null;
  });
  if (updated) return { status: 200, envelope: parseCloudSave(updated.row, updated.profile) };

  const current = await readCurrent(pool, identity, repository);
  return current
    ? { status: 409, code: 'save-conflict', current }
    : { status: 404, code: 'save-not-found' };
}

export function createCloudSaveService(dependencies = {}) {
  return {
    getCurrent: (pool, identity) => getCurrent(pool, identity, dependencies),
    putCurrent: (pool, identity, body, precondition) => putCurrent(pool, identity, body, precondition, dependencies),
  };
}
