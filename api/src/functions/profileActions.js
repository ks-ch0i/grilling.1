import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { ProfileActionValidationError, validateProfileAction } from '../domain/profileAction.js';
import { getSqlPool } from '../database/sqlConnection.js';
import { createProfileActionService } from '../services/profileActionService.js';

const MAX_REQUEST_BYTES = 16 * 1024;
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

async function readJson(request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalid-action' };
    if (length > MAX_REQUEST_BYTES) return { error: 'request-too-large', status: 413 };
  }
  if (!request.body) return { error: 'invalid-action' };
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { error: 'request-too-large', status: 413 };
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
    return { error: 'invalid-action' };
  }
}

function responseForResult(result) {
  const { status, ...body } = result;
  return jsonResponse(status, body);
}

export function createProfileActionHandlers({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  service = createProfileActionService(),
} = {}) {
  return {
    post: async (request, context = {}) => {
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
        context?.error?.(`Profile action authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
        return jsonResponse(500, { error: 'internal-error', errorId });
      }

      const bounded = await readJson(request);
      if (bounded.error) return jsonResponse(bounded.status ?? 400, { code: bounded.error });
      let body;
      try {
        body = validateProfileAction(bounded.value);
      } catch (error) {
        if (error instanceof ProfileActionValidationError) return jsonResponse(400, { code: 'invalid-action' });
        throw error;
      }

      try {
        const pool = await sqlPoolProvider({
          server: env.SQL_SERVER_FQDN,
          database: env.SQL_DATABASE,
          credential,
        });
        return responseForResult(await service.applyProfileAction(pool, identity, body));
      } catch (error) {
        const errorId = safeInvocationId(context);
        const status = isTransientSqlError(error) ? 503 : 500;
        context?.error?.(`Profile action request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
        return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
      }
    },
  };
}

export function registerProfileActionFunction(app, dependencies = {}) {
  const handlers = createProfileActionHandlers(dependencies);
  app.http('profileActionPost', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'profile/actions',
    handler: handlers.post,
  });
}
