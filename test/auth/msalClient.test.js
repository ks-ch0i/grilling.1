import assert from 'node:assert/strict';
import { test } from 'node:test';

async function loadAuthClient() {
  try {
    return await import('../../src/auth/msalClient.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected MSAL client module: ${error.message}`);
    throw error;
  }
}

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const accountA = { tenantId, localAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', homeAccountId: 'a.a', username: 'a@company.test' };
const accountB = { tenantId, localAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', homeAccountId: 'b.b', username: 'b@company.test' };
const foreignAccount = { tenantId: otherTenant, localAccountId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', homeAccountId: 'c.c', username: 'c@outside.test' };
const env = { VITE_ENTRA_TENANT_ID: tenantId, VITE_ENTRA_SPA_CLIENT_ID: 'spa-client-id', VITE_ENTRA_API_SCOPE: 'api://api-id/access_as_user' };

function createLibrary(accounts = []) {
  const calls = { config: null, silent: [], acquirePopup: [], loginPopup: [] };
  class InteractionRequiredAuthError extends Error {}
  class PublicClientApplication {
    constructor(config) { calls.config = config; }
    async initialize() { calls.initialized = true; }
    getAllAccounts() { return accounts; }
    async acquireTokenSilent(request) { calls.silent.push(request); return { accessToken: 'silent-token', account: request.account }; }
    async acquireTokenPopup(request) { calls.acquirePopup.push(request); return { accessToken: 'popup-token', account: request.account }; }
    async loginPopup(request) { calls.loginPopup.push(request); return { account: accountA }; }
  }
  return { calls, library: { PublicClientApplication, InteractionRequiredAuthError } };
}

function windowObject() {
  return { location: { origin: 'https://game.internal' } };
}

test('initializes one tenant, localStorage cache and the registered popup bridge URI', async () => {
  const { createAuthClient } = await loadAuthClient();
  const fake = createLibrary([accountA, foreignAccount]);
  const client = createAuthClient({ env, windowObject: windowObject(), loadLibrary: async () => fake.library });
  const result = await client.initializeAuth();

  assert.equal(result.status, 'signed-in');
  assert.equal(result.account, accountA);
  assert.equal(fake.calls.initialized, true);
  assert.equal(fake.calls.config.auth.authority, `https://login.microsoftonline.com/${tenantId}`);
  assert.equal(fake.calls.config.auth.redirectUri, 'https://game.internal/auth-popup.html');
  assert.equal(fake.calls.config.cache.cacheLocation, 'localStorage');
});

test('returns a chooser for multiple cached tenant accounts and rejects other tenants', async () => {
  const { createAuthClient } = await loadAuthClient();
  const fake = createLibrary([accountA, accountB, foreignAccount]);
  const client = createAuthClient({ env, windowObject: windowObject(), loadLibrary: async () => fake.library });
  const result = await client.initializeAuth();
  assert.equal(result.status, 'choose-account');
  assert.deepEqual(result.accounts, [accountA, accountB]);
  assert.equal(client.getSignedInAccount(), null);
  assert.equal(client.selectAccount(accountB.homeAccountId).account, accountB);
});

test('uses silent token first and opens a token popup only for interaction-required errors', async () => {
  const { createAuthClient } = await loadAuthClient();
  const fake = createLibrary([accountA]);
  const client = createAuthClient({ env, windowObject: windowObject(), loadLibrary: async () => fake.library });
  await client.initializeAuth();
  assert.equal(await client.getApiAccessToken(), 'silent-token');
  assert.equal(fake.calls.silent[0].scopes[0], env.VITE_ENTRA_API_SCOPE);
  assert.equal(fake.calls.acquirePopup.length, 0);

  const interaction = new fake.library.InteractionRequiredAuthError('consent required');
  fake.library.PublicClientApplication.prototype.acquireTokenSilent = async (request) => {
    fake.calls.silent.push(request);
    throw interaction;
  };
  assert.equal(await client.getApiAccessToken(), 'popup-token');
  assert.equal(fake.calls.acquirePopup.length, 1);
  assert.equal(fake.calls.acquirePopup[0].account, accountA);
});

test('does not open a popup for ordinary token errors and sign-in uses explicit loginPopup', async () => {
  const { createAuthClient } = await loadAuthClient();
  const fake = createLibrary([]);
  const client = createAuthClient({ env, windowObject: windowObject(), loadLibrary: async () => fake.library });
  await client.initializeAuth();
  await assert.rejects(() => client.getApiAccessToken(), /No signed-in account/);
  await client.signInInteractively();
  assert.equal(fake.calls.loginPopup.length, 1);
  assert.equal(fake.calls.loginPopup[0].scopes[0], 'openid');
  assert.ok(fake.calls.loginPopup[0].scopes.includes(env.VITE_ENTRA_API_SCOPE));
  assert.equal(client.getSignedInAccount(), accountA);
});
