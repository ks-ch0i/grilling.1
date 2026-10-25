import { getSqlPool } from '../database/sqlConnection.js';
import { cleanupPvpRetention } from '../services/pvpRetentionService.js';

export const PVP_RETENTION_CLEANUP_SCHEDULE = '0 15 3 * * *';

export function createPvpRetentionCleanupHandler({
  env = process.env,
  credential,
  sqlPoolProvider = getSqlPool,
  service = cleanupPvpRetention,
  clock = () => new Date(),
} = {}) {
  return async (_timer, context = {}) => {
    const nowUtc = clock();
    const pool = await sqlPoolProvider({
      server: env.SQL_SERVER_FQDN,
      database: env.SQL_DATABASE,
      credential,
    });
    const summary = await service(pool, { clock: () => nowUtc });
    context.info?.(JSON.stringify({ event: 'pvpRetentionCleanupCompleted', ...summary }));
    return summary;
  };
}

export function registerPvpRetentionCleanup(app, dependencies = {}) {
  app.timer('pvpRetentionCleanup', {
    schedule: PVP_RETENTION_CLEANUP_SCHEDULE,
    runOnStartup: false,
    useMonitor: true,
    handler: createPvpRetentionCleanupHandler(dependencies),
  });
}
