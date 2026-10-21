import { randomUUID } from 'node:crypto';
import { requireEntraUser } from '../auth/entraBearer.js';
import { createRankingEventsService } from '../services/rankingEvents.js';

function jsonResponse(status, body) {
  return { status, headers:{ 'content-type':'application/json; charset=utf-8' }, body:JSON.stringify(body) };
}

function safeInvocationId(context) {
  return typeof context?.invocationId === 'string' && context.invocationId.length <= 128
    ? context.invocationId
    : randomUUID();
}

function safeErrorCode(error) {
  return typeof error?.code === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(error.code) ? error.code : 'internal_error';
}

export function createSignalRNegotiateHandler({
  env = process.env,
  credential,
  authenticate = requireEntraUser,
  service = createRankingEventsService({ env, credential }),
} = {}) {
  return async (request, context = {}) => {
    let identity;
    try {
      identity = await authenticate(request, { tenantId:env.ENTRA_TENANT_ID, apiAudience:env.ENTRA_API_AUDIENCE });
    } catch (error) {
      if (error?.statusCode === 401) return jsonResponse(401, { error:'unauthorized' });
      if (error?.statusCode === 403) return jsonResponse(403, { error:'forbidden' });
      const errorId = safeInvocationId(context);
      context?.error?.(`SignalR negotiation authentication failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(500, { error:'internal-error', errorId });
    }
    try {
      return jsonResponse(200, await service.negotiate(identity));
    } catch (error) {
      const errorId = safeInvocationId(context);
      context?.error?.(`SignalR negotiation failed; errorId=${errorId}; code=${safeErrorCode(error)}`);
      return jsonResponse(error?.code === 'signalr-not-configured' ? 503 : 502, {
        error:'signalr-unavailable', errorId,
      });
    }
  };
}

export function registerSignalRFunction(app, dependencies = {}) {
  app.http('signalrNegotiate', {
    methods:['POST'],
    authLevel:'anonymous',
    route:'signalr/negotiate',
    handler:createSignalRNegotiateHandler(dependencies),
  });
}
