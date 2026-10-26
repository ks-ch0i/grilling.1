import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { getSqlPool } from '../database/sqlConnection.js';
import {
  MAX_MATCH_INPUT_EVENTS,
  MAX_MATCH_RESULT_BYTES,
  PvpValidationError,
  isMatchId,
  isSearchId,
  validatePvpInputs,
  validateSearchRequest,
  validateStartSearchRequest,
  validateSnapshotRequest,
} from '../domain/pvpRating.js';
import { createMatchmakingService } from '../services/matchmakingService.js';
import { createPlayerSnapshotService } from '../services/playerSnapshotService.js';
import { createPvpResultService, MAX_PVP_HISTORY_PAGE } from '../services/pvpResultService.js';
import { buildRankingSnapshot } from '../services/rankingEvents.js';

const MAX_SMALL_REQUEST_BYTES = 16 * 1024;
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
  return typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code) ? error.code : 'internal_error';
}

function isTransientSqlError(error) {
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1, current = current.originalError ?? current.cause) {
    if (TRANSIENT_SQL_CODES.has(current.code)) return true;
  }
  return false;
}

async function readBoundedJson(request, maxBytes, { emptyAsObject = false } = {}) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalid-content-length', status: 400 };
    if (length > maxBytes) return { error: 'request-too-large', status: 413 };
  }
  if (!request.body) return emptyAsObject ? { value: {} } : { error: 'invalid-json', status: 400 };
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { error: 'request-too-large', status: 413 };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0 && emptyAsObject) return { value: {} };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { error: 'invalid-json', status: 400 };
  }
}

function responseForResult(result) {
  const { status, ...body } = result;
  return jsonResponse(status, body);
}

function matchIdFrom(request, context) {
  if (typeof context?.params?.matchId === 'string') return context.params.matchId;
  return /\/pvp\/matches\/([^/]+)\/result\/?$/.exec(new URL(request.url).pathname)?.[1] ?? '';
}

function searchIdFrom(request, context, cancel = false) {
  if (typeof context?.params?.searchId === 'string') return context.params.searchId;
  const pattern = cancel
    ? /\/pvp\/matches\/search\/([^/]+)\/cancel\/?$/
    : /\/pvp\/matches\/search\/([^/]+)\/?$/;
  return pattern.exec(new URL(request.url).pathname)?.[1] ?? '';
}

function matchIdFromStart(request, context) {
  if (typeof context?.params?.matchId === 'string') return context.params.matchId;
  return /\/pvp\/matches\/([^/]+)\/start\/?$/.exec(new URL(request.url).pathname)?.[1] ?? '';
}

function historyPageFrom(request) {
  const values = new URL(request.url).searchParams.getAll('page');
  if (values.length === 0) return 1;
  if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0])) return null;
  const page = Number(values[0]);
  return Number.isSafeInteger(page) && page <= MAX_PVP_HISTORY_PAGE ? page : null;
}

export function createPvpHandlers({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  snapshotService = createPlayerSnapshotService(),
  matchmakingService = createMatchmakingService(),
  resultService = createPvpResultService(),
  clock = () => new Date(),
} = {}) {
  async function withUser(request, context, action) {
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
      context?.error?.(`PvP authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error: 'internal-error', errorId });
    }
    try {
      return await action(identity, () => sqlPoolProvider({
        server: env.SQL_SERVER_FQDN,
        database: env.SQL_DATABASE,
        credential,
      }));
    } catch (error) {
      if (error instanceof PvpValidationError) return jsonResponse(400, { code: error.code });
      const errorId = safeInvocationId(context);
      const status = isTransientSqlError(error) ? 503 : 500;
      context?.error?.(`PvP request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
    }
  }

  return {
    publishSnapshot: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const bounded = await readBoundedJson(request, MAX_SMALL_REQUEST_BYTES);
      if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
      let body;
      try {
        body = validateSnapshotRequest(bounded.value);
      } catch (error) {
        if (error instanceof PvpValidationError) return jsonResponse(400, { code: error.code });
        throw error;
      }
      return responseForResult(await snapshotService.publishSnapshot(await getPool(), identity, body));
    }),
    search: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const bounded = await readBoundedJson(request, MAX_SMALL_REQUEST_BYTES, { emptyAsObject: true });
      if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
      let body;
      try {
        body = validateSearchRequest(bounded.value);
      } catch (error) {
        if (error instanceof PvpValidationError) return jsonResponse(400, { code: error.code });
        throw error;
      }
      return responseForResult(await matchmakingService.findOpponent(await getPool(), identity, body));
    }),
    getSearch: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const searchId = searchIdFrom(request, context);
      if (!isSearchId(searchId)) return jsonResponse(404, { code: 'search-not-found' });
      return responseForResult(await matchmakingService.getSearch(await getPool(), identity, searchId));
    }),
    cancelSearch: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const bounded = await readBoundedJson(request, MAX_SMALL_REQUEST_BYTES, { emptyAsObject: true });
      if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
      if (!bounded.value || typeof bounded.value !== 'object' || Array.isArray(bounded.value) ||
          Object.keys(bounded.value).length !== 0) {
        return jsonResponse(400, { code: 'invalid-search-cancel' });
      }
      const searchId = searchIdFrom(request, context, true);
      if (!isSearchId(searchId)) return jsonResponse(404, { code: 'search-not-found' });
      return responseForResult(await matchmakingService.cancelSearch(await getPool(), identity, searchId));
    }),
    startMatch: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const matchId = matchIdFromStart(request, context);
      if (!isMatchId(matchId)) return jsonResponse(404, { code: 'match-not-found' });
      const bounded = await readBoundedJson(request, MAX_SMALL_REQUEST_BYTES);
      if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
      let body;
      try {
        body = validateStartSearchRequest(bounded.value);
      } catch (error) {
        if (error instanceof PvpValidationError) return jsonResponse(400, { code: error.code });
        throw error;
      }
      return responseForResult(await matchmakingService.startMatch(await getPool(), identity, matchId, body));
    }),
    submit: (request, context = {}) => {
      const receivedAtUtc = clock();
      return withUser(request, context, async (identity, getPool) => {
        const matchId = matchIdFrom(request, context);
        if (!isMatchId(matchId)) return jsonResponse(404, { code: 'match-not-found' });
        const bounded = await readBoundedJson(request, MAX_MATCH_RESULT_BYTES);
        if (bounded.error) {
          const code = bounded.status === 413 ? 'result-too-large' : bounded.error;
          return jsonResponse(bounded.status, { code });
        }
        let body;
        try {
          body = validatePvpInputs(bounded.value);
        } catch (error) {
          if (error instanceof PvpValidationError) return jsonResponse(400, { code: error.code });
          throw error;
        }
        if (body.inputs.length > MAX_MATCH_INPUT_EVENTS) return jsonResponse(400, { code: 'invalid-input-log' });
        return responseForResult(await resultService.submitPvpResult(await getPool(), identity, matchId, body, receivedAtUtc));
      });
    },
    topFive: (request, context = {}) => withUser(request, context, async (_identity, getPool) =>
      jsonResponse(200, buildRankingSnapshot('pvp', await resultService.getPvpTopFive(await getPool()), clock()))),
    history: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const page = historyPageFrom(request);
      if (page === null) return jsonResponse(400, { code: 'invalid-history-page' });
      return responseForResult(await resultService.getPlayerMatchHistory(await getPool(), identity, page));
    }),
  };
}
