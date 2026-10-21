import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { getSqlPool } from '../database/sqlConnection.js';
import { createStageRunService } from '../services/stageRunService.js';
import { createPvpResultService } from '../services/pvpResultService.js';
import { buildRankingSnapshot } from '../services/rankingEvents.js';

const TRANSIENT_SQL_CODES = new Set(['ETIMEOUT', 'ECONNCLOSED', 'ESOCKET', 'ENOCONN', 'EINSTLOOKUP', 'ECANCEL']);

function jsonResponse(status, body) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
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

export function createStageRankingHandler({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  service = createStageRunService(),
  clock = () => new Date(),
} = {}) {
  return async (request, context = {}) => {
    try {
      await authenticate(request, {
        tenantId: env.ENTRA_TENANT_ID,
        apiAudience: env.ENTRA_API_AUDIENCE,
      });
    } catch (error) {
      if (error?.statusCode === 401) return jsonResponse(401, { error: 'unauthorized' });
      if (error?.statusCode === 403) return jsonResponse(403, { error: 'forbidden' });
      if (error?.statusCode === 503) return jsonResponse(503, { error: 'service-unavailable' });
      const errorId = safeInvocationId(context);
      if (typeof context?.error === 'function') context.error(`Stage ranking authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error: 'internal-error', errorId });
    }

    try {
      const pool = await sqlPoolProvider({ server: env.SQL_SERVER_FQDN, database: env.SQL_DATABASE, credential });
      const topFive = await service.getStageTopFive(pool);
      return jsonResponse(200, buildRankingSnapshot('stage', topFive, clock()));
    } catch (error) {
      const errorId = safeInvocationId(context);
      const status = isTransientSqlError(error) ? 503 : 500;
      if (typeof context?.error === 'function') context.error(`Stage ranking request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
    }
  };
}

export function createCurrentRankingHandler({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  stageService = createStageRunService(),
  pvpService = createPvpResultService(),
} = {}) {
  return async (request, context = {}) => {
    let identity;
    try {
      identity = await authenticate(request, { tenantId:env.ENTRA_TENANT_ID, apiAudience:env.ENTRA_API_AUDIENCE });
    } catch (error) {
      if (error?.statusCode === 401) return jsonResponse(401, { error:'unauthorized' });
      if (error?.statusCode === 403) return jsonResponse(403, { error:'forbidden' });
      if (error?.statusCode === 503) return jsonResponse(503, { error:'service-unavailable' });
      const errorId = safeInvocationId(context);
      context?.error?.(`Current ranking authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error:'internal-error', errorId });
    }
    try {
      const pool = await sqlPoolProvider({ server:env.SQL_SERVER_FQDN, database:env.SQL_DATABASE, credential });
      const [stage, pvp] = await Promise.all([
        stageService.getPlayerRank(pool, identity),
        pvpService.getPlayerRank(pool, identity),
      ]);
      return jsonResponse(200, { stage, pvp });
    } catch (error) {
      const errorId = safeInvocationId(context);
      const status = isTransientSqlError(error) ? 503 : 500;
      context?.error?.(`Current ranking request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(status, { error:status === 503 ? 'service-unavailable' : 'internal-error', errorId });
    }
  };
}

export function registerRankingFunctions(app, dependencies = {}) {
  app.http('stageRankingTop', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'rankings/stage/top',
    handler: createStageRankingHandler(dependencies),
  });
  app.http('currentRanking', {
    methods:['GET'],
    authLevel:'anonymous',
    route:'rankings/me',
    handler:createCurrentRankingHandler(dependencies),
  });
}
