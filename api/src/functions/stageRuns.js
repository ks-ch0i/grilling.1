import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { getSqlPool } from '../database/sqlConnection.js';
import {
  isRunId,
  MAX_STAGE_RESULT_BYTES,
  StageRunValidationError,
  validateStageInputs,
  validateStartRequest,
} from '../domain/stageRank.js';
import { createStageRunService } from '../services/stageRunService.js';

const MAX_START_REQUEST_BYTES = 16 * 1024;
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

async function readBoundedJson(request, maxBytes, tooLargeCode) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalid-content-length', status: 400 };
    if (length > maxBytes) return { error: tooLargeCode, status: 413 };
  }
  if (!request.body) return { error: 'invalid-json', status: 400 };
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
        return { error: tooLargeCode, status: 413 };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
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

function runIdFrom(request, context) {
  const runId = context?.params?.runId;
  if (typeof runId === 'string') return runId;
  const match = /\/stage-runs\/([^/]+)\/result\/?$/.exec(new URL(request.url).pathname);
  return match?.[1] ?? '';
}

export function createStageRunHandlers({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  service = createStageRunService(),
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
      if (typeof context?.error === 'function') context.error(`Stage run authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error: 'internal-error', errorId });
    }
    try {
      return await action(identity, () => sqlPoolProvider({
        server: env.SQL_SERVER_FQDN,
        database: env.SQL_DATABASE,
        credential,
      }));
    } catch (error) {
      if (error instanceof StageRunValidationError) return jsonResponse(400, { code: error.code });
      const errorId = safeInvocationId(context);
      const status = isTransientSqlError(error) ? 503 : 500;
      if (typeof context?.error === 'function') context.error(`Stage run request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
    }
  }

  return {
    start: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const bounded = await readBoundedJson(request, MAX_START_REQUEST_BYTES, 'request-too-large');
      if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
      let body;
      try {
        body = validateStartRequest(bounded.value);
      } catch (error) {
        if (error instanceof StageRunValidationError) return jsonResponse(400, { code: error.code });
        throw error;
      }
      return responseForResult(await service.startStageRun(await getPool(), identity, body));
    }),
    submit: (request, context = {}) => {
      const receivedAtUtc = clock();
      return withUser(request, context, async (identity, getPool) => {
        const runId = runIdFrom(request, context);
        if (!isRunId(runId)) return jsonResponse(404, { code: 'run-not-found' });
        const bounded = await readBoundedJson(request, MAX_STAGE_RESULT_BYTES, 'result-too-large');
        if (bounded.error) return jsonResponse(bounded.status, { code: bounded.error });
        let body;
        try {
          body = validateStageInputs(bounded.value);
        } catch (error) {
          if (error instanceof StageRunValidationError) return jsonResponse(400, { code: error.code });
          throw error;
        }
        return responseForResult(await service.submitStageResult(
          await getPool(), identity, runId, body, receivedAtUtc,
        ));
      });
    },
  };
}

export function registerStageRunFunctions(app, dependencies = {}) {
  const handlers = createStageRunHandlers(dependencies);
  app.http('stageRunsCreate', {
    methods: ['POST'], authLevel: 'anonymous', route: 'stage-runs', handler: handlers.start,
  });
  app.http('stageRunResult', {
    methods: ['POST'], authLevel: 'anonymous', route: 'stage-runs/{runId}/result', handler: handlers.submit,
  });
}
