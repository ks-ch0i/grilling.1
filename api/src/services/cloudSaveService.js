import { randomUUID } from 'node:crypto';
import * as defaultRepository from '../repositories/cloudSaveRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
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
  return row ? parseCloudSave(row) : null;
}

export async function getCurrent(pool, identity, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const envelope = await readCurrent(pool, identity, repository);
  return envelope ? { status: 200, envelope } : { status: 404, code: 'save-not-found' };
}

export async function putCurrent(pool, identity, body, precondition, dependencies) {
  const { repository, withTransaction, clock } = dependenciesWithDefaults(dependencies);
  const validated = validateCloudSave(body);
  const serialized = JSON.stringify(validated.state);
  const timestamp = clock();
  if (!(timestamp instanceof Date) || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError('Cloud save clock returned an invalid timestamp.');
  }

  if (precondition?.kind === 'create') {
    const playerId = await repository.getOrCreatePlayerId(pool, identity);
    try {
      const row = await withTransaction(pool, (transaction) => repository.insertInitial(transaction, {
        playerId,
        schemaVersion: validated.schemaVersion,
        saveJson: serialized,
        updatedAtUtc: timestamp,
      }));
      if (!row) throw new Error('Initial cloud save insert returned no row.');
      return { status: 201, envelope: parseCloudSave(row) };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const current = await readCurrent(pool, identity, repository);
      return { status: 409, code: 'save-conflict', current };
    }
  }

  if (precondition?.kind !== 'update' || !Number.isSafeInteger(precondition.expectedRevision) || precondition.expectedRevision < 1) {
    throw new TypeError('Cloud save precondition is invalid.');
  }
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'save-not-found' };

  const row = await withTransaction(pool, (transaction) => repository.compareAndSwap(transaction, {
    playerId,
    schemaVersion: validated.schemaVersion,
    saveJson: serialized,
    updatedAtUtc: timestamp,
    expectedRevision: precondition.expectedRevision,
  }));
  if (row) return { status: 200, envelope: parseCloudSave(row) };

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
