const TENANT_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function runtimeEnvironment() {
  return import.meta.env ?? {};
}

function configFrom(env, windowObject) {
  const tenantId = String(env.VITE_ENTRA_TENANT_ID ?? '').trim();
  const clientId = String(env.VITE_ENTRA_SPA_CLIENT_ID ?? '').trim();
  const apiScope = String(env.VITE_ENTRA_API_SCOPE ?? '').trim();
  if (!TENANT_ID_PATTERN.test(tenantId) || !clientId || !apiScope) {
    throw new Error('Entra tenant, SPA client and API scope configuration are required.');
  }
  const origin = windowObject?.location?.origin;
  if (typeof origin !== 'string' || !origin) throw new Error('A browser origin is required for Entra authentication.');
  return {
    tenantId,
    apiScope,
    msal: {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        redirectUri: new URL('/auth-popup.html', origin).toString(),
      },
      cache: { cacheLocation: 'localStorage' },
    },
  };
}

function userObjectId(account) {
  const value = account?.idTokenClaims?.oid ?? account?.localAccountId;
  return typeof value === 'string' ? value : null;
}

export function createAuthClient({
  env = runtimeEnvironment(),
  windowObject = globalThis.window,
  loadLibrary = () => import('@azure/msal-browser'),
} = {}) {
  let library;
  let application;
  let configuration;
  let accounts = [];
  let selectedAccount = null;
  let initialization;

  async function getLibrary() {
    if (!library) library = await loadLibrary();
    return library;
  }

  function state() {
    if (selectedAccount) return { status: 'signed-in', account: selectedAccount, accounts };
    if (accounts.length > 1) return { status: 'choose-account', account: null, accounts: [...accounts] };
    return { status: 'signed-out', account: null, accounts: [...accounts] };
  }

  async function initializeAuth() {
    if (initialization) return initialization;
    initialization = (async () => {
      configuration = configFrom(env, windowObject);
      const msal = await getLibrary();
      application = new msal.PublicClientApplication(configuration.msal);
      await application.initialize();
      accounts = application.getAllAccounts().filter((account) =>
        String(account.tenantId ?? '').toLowerCase() === configuration.tenantId.toLowerCase() && userObjectId(account),
      );
      if (accounts.length === 1) selectedAccount = accounts[0];
      return state();
    })();
    try {
      return await initialization;
    } catch (error) {
      initialization = undefined;
      throw error;
    }
  }

  function getSignedInAccount() {
    return selectedAccount;
  }

  function selectAccount(homeAccountId) {
    const account = accounts.find((candidate) => candidate.homeAccountId === homeAccountId);
    if (!account) throw new Error('The selected Entra account is not available in this tenant.');
    selectedAccount = account;
    return state();
  }

  async function signInInteractively() {
    if (!application) await initializeAuth();
    const response = await application.loginPopup({
      scopes: ['openid', 'profile', configuration.apiScope],
      redirectUri: configuration.msal.auth.redirectUri,
      ...(accounts.length > 1 ? { prompt: 'select_account' } : {}),
    });
    const account = response?.account;
    if (!account || String(account.tenantId ?? '').toLowerCase() !== configuration.tenantId.toLowerCase() || !userObjectId(account)) {
      throw new Error('The signed-in account does not belong to the configured Entra tenant.');
    }
    accounts = [...accounts.filter((candidate) => candidate.homeAccountId !== account.homeAccountId), account];
    selectedAccount = account;
    return state();
  }

  async function getApiAccessToken(account = selectedAccount) {
    if (!application) await initializeAuth();
    if (!account) throw new Error('No signed-in account is selected.');
    const msal = await getLibrary();
    const request = {
      account,
      scopes: [configuration.apiScope],
      redirectUri: configuration.msal.auth.redirectUri,
    };
    try {
      const response = await application.acquireTokenSilent(request);
      return response.accessToken;
    } catch (error) {
      if (!(error instanceof msal.InteractionRequiredAuthError)) throw error;
      const response = await application.acquireTokenPopup(request);
      return response.accessToken;
    }
  }

  return { initializeAuth, getSignedInAccount, getApiAccessToken, signInInteractively, selectAccount };
}

const defaultAuthClient = createAuthClient();
export const initializeAuth = (...args) => defaultAuthClient.initializeAuth(...args);
export const getSignedInAccount = (...args) => defaultAuthClient.getSignedInAccount(...args);
export const getApiAccessToken = (...args) => defaultAuthClient.getApiAccessToken(...args);
export const signInInteractively = (...args) => defaultAuthClient.signInInteractively(...args);
export const selectAccount = (...args) => defaultAuthClient.selectAccount(...args);
