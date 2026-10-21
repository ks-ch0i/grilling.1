import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test, after } from 'node:test';
import { SignJWT } from 'jose';

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenantId = '22222222-2222-4222-8222-222222222222';
const audience = 'api://knight-run-test';
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-signing-key', use: 'sig', alg: 'RS256' };
const originalFetch = globalThis.fetch;
let jwksFetchCount = 0;

globalThis.fetch = async (input) => {
  if (String(input).endsWith('/discovery/v2.0/keys')) {
    jwksFetchCount += 1;
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return originalFetch(input);
};

after(() => {
  globalThis.fetch = originalFetch;
});

async function loadAuth() {
  try {
    return await import('../../src/auth/entraBearer.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the Entra bearer verifier module to exist: ${error.message}`);
    }
    throw error;
  }
}

async function token({
  signingKey = privateKey,
  tokenIssuer = issuer,
  tokenAudience = audience,
  tid = tenantId,
  oid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name = 'Knight Runner',
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  alg = 'RS256',
  includeExpiry = true,
} = {}) {
  const claims = { tid, oid, name };
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: 'test-signing-key' })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setIssuedAt();
  if (includeExpiry) jwt.setExpirationTime(expiresAt);
  return jwt.sign(signingKey);
}

function requestWithBearer(value) {
  return new Request('https://game.internal/api/me', {
    headers: value ? { authorization: `Bearer ${value}` } : {},
  });
}

const config = { tenantId, apiAudience: audience };

test('rejects a missing Bearer token with 401', async () => {
  const { requireEntraUser } = await loadAuth();
  await assert.rejects(requireEntraUser(requestWithBearer(), config), (error) => error.statusCode === 401);
});

test('rejects a bad signature with 401 and accepts only RS256', async () => {
  const { requireEntraUser } = await loadAuth();
  const badSignature = await token({ signingKey: wrongPair.privateKey });
  const wrongAlgorithm = await token({ alg: 'PS256' });
  await assert.rejects(requireEntraUser(requestWithBearer(badSignature), config), (error) => error.statusCode === 401);
  await assert.rejects(requireEntraUser(requestWithBearer(wrongAlgorithm), config), (error) => error.statusCode === 401);
});

test('rejects issuer, audience and expired token mismatches', async () => {
  const { requireEntraUser } = await loadAuth();
  const wrongIssuer = await token({ tokenIssuer: 'https://login.microsoftonline.com/common/v2.0' });
  const wrongAudience = await token({ tokenAudience: 'api://another-api' });
  const expired = await token({ expiresAt: Math.floor(Date.now() / 1000) - 30 });
  const missingExpiry = await token({ includeExpiry: false });

  for (const value of [wrongIssuer, wrongAudience, expired, missingExpiry]) {
    await assert.rejects(requireEntraUser(requestWithBearer(value), config), (error) => error.statusCode === 401);
  }
});

test('rejects a token from another tenant with 403', async () => {
  const { requireEntraUser } = await loadAuth();
  const otherTenantToken = await token({ tid: otherTenantId });
  await assert.rejects(requireEntraUser(requestWithBearer(otherTenantToken), config), (error) => error.statusCode === 403);
});

test('requires an object id and maps a valid token to a minimal AuthContext', async () => {
  const { requireEntraUser } = await loadAuth();
  const missingObjectId = await token({ oid: null });
  await assert.rejects(requireEntraUser(requestWithBearer(missingObjectId), config), (error) => error.statusCode === 401);

  const validToken = await token();
  assert.deepEqual(await requireEntraUser(requestWithBearer(validToken), config), {
    tenantId,
    objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    displayName: 'Knight Runner',
  });
  assert.ok(jwksFetchCount >= 1);
});

test('missing tenant or audience configuration is a server error', async () => {
  const { requireEntraUser } = await loadAuth();
  const validToken = await token();
  await assert.rejects(requireEntraUser(requestWithBearer(validToken), {}), (error) => error.statusCode === 500);
});
