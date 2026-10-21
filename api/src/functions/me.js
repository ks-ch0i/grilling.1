import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { getSqlPool } from '../database/sqlConnection.js';

function jsonResponse(status, body) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code)
    ? error.code
    : 'internal_error';
}

function safeInvocationId(context) {
  return typeof context?.invocationId === 'string' && context.invocationId.length <= 128
    ? context.invocationId
    : randomUUID();
}

export function createMeHandler({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  sqlPoolProvider = getSqlPool,
} = {}) {
  return async (request, context = {}) => {
    try {
      const user = await authenticate(request, {
        tenantId: env.ENTRA_TENANT_ID,
        apiAudience: env.ENTRA_API_AUDIENCE,
      });
      await sqlPoolProvider({
        server: env.SQL_SERVER_FQDN,
        database: env.SQL_DATABASE,
        credential,
      });
      return jsonResponse(200, {
        tenantId: user.tenantId,
        objectId: user.objectId,
        displayName: user.displayName ?? null,
      });
    } catch (error) {
      const status = error?.statusCode === 401 || error?.statusCode === 403 ? error.statusCode : 500;
      const errorId = safeInvocationId(context);
      if (status >= 500 && typeof context.error === 'function') {
        context.error(`GET /api/me failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      }
      if (status === 401) return jsonResponse(401, { error: 'unauthorized' });
      if (status === 403) return jsonResponse(403, { error: 'forbidden' });
      return jsonResponse(500, { error: 'internal_error', errorId });
    }
  };
}

export function registerMeFunction(app, dependencies = {}) {
  app.http('me', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'me',
    handler: createMeHandler(dependencies),
  });
}
