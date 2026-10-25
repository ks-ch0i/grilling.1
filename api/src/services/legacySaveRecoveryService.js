import * as defaultRepository from '../repositories/cloudSaveRepository.js';
import { parseArchivedSaveState } from '../domain/cloudSave.js';

function dependenciesWithDefaults(dependencies = {}) {
  return { repository: dependencies.repository ?? defaultRepository };
}

export async function getLegacySave(pool, identity, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'legacy-save-not-found' };
  const row = await repository.getLegacySaveArchiveByPlayerId(pool, playerId);
  if (!row) return { status: 404, code: 'legacy-save-not-found' };
  const revision = Number(row.OriginalRevision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Legacy save archive has an invalid revision.');
  }
  return {
    status: 200,
    archive: {
      schemaVersion: 2,
      revision,
      state: parseArchivedSaveState(row.OriginalSaveJson),
      trust: 'unverified',
    },
  };
}

export function createLegacySaveRecoveryService(dependencies = {}) {
  return { getLegacySave: (pool, identity) => getLegacySave(pool, identity, dependencies) };
}
