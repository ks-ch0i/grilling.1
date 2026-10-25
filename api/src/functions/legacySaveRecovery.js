import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { getSqlPool } from '../database/sqlConnection.js';
import { createLegacySaveRecoveryService } from '../services/legacySaveRecoveryService.js';

const TRANSIENT_SQL_CODES = new Set(['ETIMEOUT', 'ECONNCLOSED', 'ESOCKET', 'ENOCONN', 'EINSTLOOKUP', 'ECANCEL']);

function jsonResponse(status, body) {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}

function safeInvocationId(context) {
  return typeof context?.invocationId === 'string' && context.invocationId.length <= 128
    ? context.invocationId
    : randomUUID();
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code)
    ? error.code
    : 'internal_error';
}

function isTransientSqlError(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.originalError ?? current.cause) {
    if (TRANSIENT_SQL_CODES.has(current.code)) return true;
  }
  return false;
}

export function createLegacySaveRecoveryHandlers({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  service = createLegacySaveRecoveryService(),
} = {}) {
  return {
    get: async (request, context = {}) => {
      let identity;
      try {
        identity = await authenticate(request, {
          tenantId: env.ENTRA_TENANT_ID,
          apiAudience: env.ENTRA_API_AUDIENCE,
        });
      } catch (error) {
        if (error?.statusCode === 401) return jsonResponse(401, { error: 'unauthorized' });
        if (error?.statusCode === 403) return jsonResponse(403, { error: 'forbidden' });
        if (error?.statusCode === 503) return jsonResponse(503, { error: 'service-unavailable' });
        const errorId = safeInvocationId(context);
        context?.error?.(`Legacy save authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
        return jsonResponse(500, { error: 'internal-error', errorId });
      }
      try {
        const pool = await sqlPoolProvider({
          server: env.SQL_SERVER_FQDN,
          database: env.SQL_DATABASE,
          credential,
        });
        const result = await service.getLegacySave(pool, identity);
        if (result.status === 200) return jsonResponse(200, { archive: result.archive });
        return jsonResponse(result.status, { code: result.code });
      } catch (error) {
        const errorId = safeInvocationId(context);
        const status = isTransientSqlError(error) ? 503 : 500;
        context?.error?.(`Legacy save recovery failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
        return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
      }
    },
  };
}

export function registerLegacySaveRecoveryFunction(app, dependencies = {}) {
  const handlers = createLegacySaveRecoveryHandlers(dependencies);
  app.http('legacySaveRecoveryGet', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'profile/legacy-save',
    handler: handlers.get,
  });
}
