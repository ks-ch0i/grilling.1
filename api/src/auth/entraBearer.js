import { createRemoteJWKSet, jwtVerify } from 'jose';

const tenantGuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const jwksByTenant = new Map();

export class EntraAuthError extends Error {
  constructor(statusCode, code) {
    super(code);
    this.name = 'EntraAuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function jwksForTenant(tenantId) {
  const normalizedTenantId = tenantId.toLowerCase();
  let jwks = jwksByTenant.get(normalizedTenantId);
  if (!jwks) {
    const url = new URL(`https://login.microsoftonline.com/${normalizedTenantId}/discovery/v2.0/keys`);
    jwks = createRemoteJWKSet(url, { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30 * 1000 });
    jwksByTenant.set(normalizedTenantId, jwks);
  }
  return jwks;
}

function bearerTokenFrom(request) {
  const header = request?.headers?.get?.('authorization') ??
    request?.headers?.authorization ?? request?.headers?.Authorization;
  if (typeof header !== 'string') throw new EntraAuthError(401, 'missing_bearer_token');
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) throw new EntraAuthError(401, 'invalid_authorization_header');
  return match[1];
}

function validateConfig(config) {
  const tenantId = typeof config?.tenantId === 'string' ? config.tenantId.trim() : '';
  const apiAudience = typeof config?.apiAudience === 'string' ? config.apiAudience.trim() : '';
  if (!tenantId || !apiAudience) throw new EntraAuthError(500, 'auth_configuration_missing');
  if (!tenantGuidPattern.test(tenantId)) throw new EntraAuthError(500, 'auth_tenant_id_invalid');
  return { tenantId, apiAudience };
}

function verificationFailure(error) {
  if (error?.code === 'ERR_JWKS_TIMEOUT' || error?.code === 'ERR_JWKS_INVALID') {
    return new EntraAuthError(503, 'identity_keys_unavailable');
  }
  return new EntraAuthError(401, 'invalid_token');
}

export async function requireEntraUser(request, config) {
  const token = bearerTokenFrom(request);
  const { tenantId, apiAudience } = validateConfig(config);
  const normalizedTenantId = tenantId.toLowerCase();
  const issuer = `https://login.microsoftonline.com/${normalizedTenantId}/v2.0`;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwksForTenant(normalizedTenantId), {
      algorithms: ['RS256'],
      issuer,
      audience: apiAudience,
    }));
  } catch (error) {
    throw verificationFailure(error);
  }

  if (payload.tid !== normalizedTenantId) throw new EntraAuthError(403, 'tenant_mismatch');
  if (typeof payload.oid !== 'string' || !payload.oid.trim()) throw new EntraAuthError(401, 'object_id_missing');
  if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new EntraAuthError(401, 'token_expired_or_missing_expiry');
  }
  return {
    tenantId: normalizedTenantId,
    objectId: payload.oid,
    displayName: typeof payload.name === 'string' ? payload.name : null,
  };
}
