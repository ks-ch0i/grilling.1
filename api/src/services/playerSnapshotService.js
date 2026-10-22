import { createHash, randomUUID } from 'node:crypto';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as pvpRepository from '../repositories/pvpRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { parseCloudSave } from '../domain/cloudSave.js';
import { BALANCE_VERSION } from '../domain/gameVersions.js';
import {
  buildSnapshotContent,
  PvpValidationError,
  stableStringify,
  validateSnapshotRequest,
} from '../domain/pvpRating.js';

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? { ...cloudSaveRepository, ...pvpRepository },
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    clock: dependencies.clock ?? (() => new Date()),
    publishSnapshotChanged: dependencies.publishSnapshotChanged ?? (async () => {}),
  };
}

function fromRow(row) {
  if (!row) return null;
  const snapshot = typeof row.SnapshotJson === 'string' ? JSON.parse(row.SnapshotJson) : row.SnapshotJson;
  return { ...snapshot, revision: Number(row.Revision) };
}

function contentHash(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export async function publishSnapshot(pool, identity, body, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  let request;
  try {
    request = validateSnapshotRequest(body);
  } catch (error) {
    if (error instanceof PvpValidationError) return { status: 400, code: error.code };
    throw error;
  }

  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'save-not-found' };
  const publishedAtUtc = deps.clock();
  if (!(publishedAtUtc instanceof Date) || !Number.isFinite(publishedAtUtc.getTime())) {
    throw new TypeError('PvP snapshot clock returned an invalid timestamp.');
  }

  const write = await deps.withTransaction(pool, async (transaction) => {
    const saveRow = deps.repository.getCloudSaveForUpdate
      ? await deps.repository.getCloudSaveForUpdate(transaction, playerId)
      : await deps.repository.getByPlayerId(pool, playerId);
    if (!saveRow) return { kind: 'missing-save' };
    const save = parseCloudSave(saveRow);
    if (save.revision !== request.expectedSaveRevision) {
      return { kind: 'revision-mismatch', currentRevision: save.revision };
    }

    let content;
    try {
      content = buildSnapshotContent(save.state);
    } catch (error) {
      if (error instanceof PvpValidationError) return { kind: 'invalid-save' };
      throw error;
    }
    const currentRow = await deps.repository.getPlayerSnapshot(transaction, playerId, { lock: true });
    const current = fromRow(currentRow);
    const currentContent = current && {
      character: current.character,
      equipment: current.equipment,
      combat: current.combat,
    };
    if (currentContent && Number(currentRow.BalanceVersion) === BALANCE_VERSION && contentHash(currentContent) === contentHash(content)) {
      return { kind: 'unchanged', snapshot: current };
    }

    const snapshot = {
      ...content,
      revision: current ? current.revision + 1 : 1,
      publishedAtUtc: publishedAtUtc.toISOString(),
    };
    let row;
    if (deps.repository.savePlayerSnapshot) {
      row = await deps.repository.savePlayerSnapshot(transaction, {
        playerId,
        revision: snapshot.revision,
        snapshotJson: JSON.stringify(snapshot),
        updatedAtUtc: publishedAtUtc,
        balanceVersion: BALANCE_VERSION,
      });
    } else {
      const result = await deps.repository.publishSnapshot(transaction, {
        playerId,
        expectedSaveRevision: request.expectedSaveRevision,
        contentJson: stableStringify(content),
        publishedAtUtc,
        balanceVersion: BALANCE_VERSION,
      });
      if (result.kind === 'revision-mismatch') return result;
      if (result.kind === 'unchanged') return { kind: 'unchanged', snapshot: fromRow(result.row) };
      row = result.row;
    }
    return { kind: 'published', snapshot: fromRow(row) ?? snapshot };
  });

  if (write.kind === 'missing-save') return { status: 404, code: 'save-not-found' };
  if (write.kind === 'revision-mismatch') {
    return { status: 409, code: 'save-revision-conflict', currentRevision: write.currentRevision };
  }
  if (write.kind === 'invalid-save') return { status: 422, code: 'invalid-save-snapshot' };
  if (write.kind === 'published') {
    try {
      await deps.publishSnapshotChanged({
        playerId,
        revision: write.snapshot.revision,
        snapshot: write.snapshot,
        generatedAtUtc: publishedAtUtc.toISOString(),
      });
    } catch {
      // Snapshot reads remain authoritative when the event transport is unavailable.
    }
  }
  return { status: 200, changed: write.kind === 'published', snapshot: write.snapshot };
}

export function createPlayerSnapshotService(dependencies = {}) {
  return {
    publishSnapshot: (pool, identity, body) => publishSnapshot(pool, identity, body, dependencies),
  };
}
