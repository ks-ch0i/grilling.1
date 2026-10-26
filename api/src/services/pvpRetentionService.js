import * as defaultRepository from '../repositories/pvpRetentionRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';

export const PVP_RETENTION_DEFAULTS = Object.freeze({
  batchSize: 500,
  maxBatches: 10,
});

function asDate(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('PvP retention timestamp is invalid.');
  return date;
}

function validateLimits(batchSize, maxBatches) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > PVP_RETENTION_DEFAULTS.batchSize) {
    throw new RangeError('PvP retention batch size must be between 1 and 500.');
  }
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > PVP_RETENTION_DEFAULTS.maxBatches) {
    throw new RangeError('PvP retention batch limit must be between 1 and 10.');
  }
}

function rowCount(value, batchSize) {
  if (!Number.isSafeInteger(value) || value < 0 || value > batchSize) {
    throw new TypeError('PvP retention repository returned an invalid batch row count.');
  }
  return value;
}

export async function cleanupPvpRetention(pool, {
  clock = () => new Date(),
  withTransaction = defaultWithTransaction,
  repository = defaultRepository,
  batchSize = PVP_RETENTION_DEFAULTS.batchSize,
  maxBatches = PVP_RETENTION_DEFAULTS.maxBatches,
} = {}) {
  validateLimits(batchSize, maxBatches);
  const nowUtc = asDate(clock());
  const summary = { matchesExpired:0, payloadRowsDeleted:0, pairDayRowsDeleted:0, searchRowsDeleted:0, batches:0 };
  let operations = [
    { name:'expireOverdueActiveMatchesBatch', count:'matchesExpired' },
    { name: 'deleteExpiredPayloadBatch', count: 'payloadRowsDeleted' },
    { name: 'deleteOldRatedPairDayBatch', count: 'pairDayRowsDeleted' },
    { name:'deleteExpiredSearchBatch', count:'searchRowsDeleted' },
  ];

  while (operations.length > 0 && summary.batches < maxBatches) {
    const nextRound = [];
    for (const operation of operations) {
      if (summary.batches >= maxBatches) break;
      const affected = rowCount(await withTransaction(pool, (transaction) => repository[operation.name](transaction, {
        nowUtc,
        batchSize,
      })), batchSize);
      summary.batches += 1;
      summary[operation.count] += affected;
      if (affected > 0) nextRound.push(operation);
    }
    operations = nextRound;
  }

  return summary;
}
