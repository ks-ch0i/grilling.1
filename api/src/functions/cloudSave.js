import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { MAX_CLOUD_SAVE_BYTES, CloudSaveValidationError, validateCloudSave } from '../domain/cloudSave.js';
import { getSqlPool } from '../database/sqlConnection.js';
import { createCloudSaveService } from '../services/cloudSaveService.js';

const TRANSIENT_SQL_CODES = new Set([
  'ETIMEOUT', 'ECONNCLOSED', 'ESOCKET', 'ENOCONN', 'EINSTLOOKUP', 'ECANCEL',
]);

function jsonResponse(status, body, headers = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
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

function preconditionFrom(request) {
  const ifNoneMatch = request.headers.get('if-none-match');
  const ifMatch = request.headers.get('if-match');
  if (ifNoneMatch !== null && ifMatch !== null) return { error: 'invalid-precondition' };
  if (ifNoneMatch !== null) return ifNoneMatch.trim() === '*' ? { value: { kind: 'create' } } : { error: 'invalid-precondition' };
  if (ifMatch === null) return { error: 'precondition-required', status: 428 };
  const match = /^"([1-9]\d*)"$/.exec(ifMatch.trim());
  if (!match) return { error: 'invalid-precondition' };
  const expectedRevision = Number(match[1]);
  if (!Number.isSafeInteger(expectedRevision)) return { error: 'invalid-precondition' };
  return { value: { kind: 'update', expectedRevision } };
}

async function readBoundedBody(request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) return { error: 'invalid-content-length' };
    if (length > MAX_CLOUD_SAVE_BYTES) return { error: 'save-too-large', status: 413 };
  }
  if (!request.body) return { text: '' };

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CLOUD_SAVE_BYTES) {
        await reader.cancel();
        return { error: 'save-too-large', status: 413 };
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
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { error: 'invalid-json' };
  }
}

function responseForResult(result) {
  if (result.status === 200 || result.status === 201) {
    return jsonResponse(result.status, result.envelope, { etag: `"${result.envelope.revision}"` });
  }
  if (result.status === 409) {
    const etag = result.current ? { etag: `"${result.current.revision}"` } : {};
    return jsonResponse(409, { code: 'save-conflict', current: result.current }, etag);
  }
  return jsonResponse(result.status, { code: result.code });
}

export function createCloudSaveHandlers({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
  service = createCloudSaveService(),
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
      if (typeof context?.error === 'function') context.error(`Cloud save authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error: 'internal-error', errorId });
    }

    try {
      return await action(identity, () => sqlPoolProvider({
        server: env.SQL_SERVER_FQDN,
        database: env.SQL_DATABASE,
        credential,
      }));
    } catch (error) {
      if (error instanceof CloudSaveValidationError) return jsonResponse(400, { code: 'invalid-save' });
      const errorId = safeInvocationId(context);
      const status = isTransientSqlError(error) ? 503 : 500;
      if (typeof context?.error === 'function') context.error(`Cloud save request failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(status, { error: status === 503 ? 'service-unavailable' : 'internal-error', errorId });
    }
  }

  return {
    get: (request, context = {}) => withUser(request, context, async (identity, getPool) =>
      responseForResult(await service.getCurrent(await getPool(), identity))),
    put: (request, context = {}) => withUser(request, context, async (identity, getPool) => {
      const precondition = preconditionFrom(request);
      if (precondition.error) {
        const status = precondition.status ?? 400;
        return jsonResponse(status, { code: precondition.error });
      }
      const bounded = await readBoundedBody(request);
      if (bounded.error) {
        const status = bounded.status ?? 400;
        return jsonResponse(status, { code: bounded.error });
      }
      let body;
      try {
        body = JSON.parse(bounded.text);
      } catch {
        return jsonResponse(400, { code: 'invalid-json' });
      }
      let validated;
      try {
        validated = validateCloudSave(body);
      } catch (error) {
        if (error instanceof CloudSaveValidationError) return jsonResponse(400, { code: 'invalid-save' });
        throw error;
      }
      const pool = await getPool();
      return responseForResult(await service.putCurrent(pool, identity, validated, precondition.value));
    }),
  };
}

export function registerCloudSaveFunctions(app, dependencies = {}) {
  const handlers = createCloudSaveHandlers(dependencies);
  app.http('cloudSaveCurrentGet', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'saves/current',
    handler: handlers.get,
  });
  app.http('cloudSaveCurrentPut', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'saves/current',
    handler: handlers.put,
  });
}
