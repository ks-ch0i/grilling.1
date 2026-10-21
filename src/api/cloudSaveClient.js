export class CloudSaveAuthenticationError extends Error {
  constructor(cause) {
    super('Could not acquire an Entra access token for the cloud save API.', { cause });
    this.name = 'CloudSaveAuthenticationError';
  }
}

export function createCloudSaveClient({
  apiBaseUrl = import.meta.env?.VITE_FUNCTIONS_API_BASE_URL ?? '/api',
  fetchImplementation = globalThis.fetch,
  getAccessToken,
} = {}) {
  if (typeof fetchImplementation !== 'function') throw new TypeError('A fetch implementation is required.');
  if (typeof getAccessToken !== 'function') throw new TypeError('An access-token provider is required.');
  const baseUrl = String(apiBaseUrl).replace(/\/+$/, '');

  async function request(account, path, options = {}) {
    let token;
    try {
      token = await getAccessToken(account);
    } catch (error) {
      throw new CloudSaveAuthenticationError(error);
    }
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      // Preserve HTTP status when an intermediary returns an empty response body.
    }
    return { status: response.status, body };
  }

  return {
    async getCurrent(account) {
      const result = await request(account, '/saves/current');
      if (result.status === 200) return { status: 200, envelope: result.body };
      return { status: result.status, ...result.body };
    },
    async putCurrent(account, body, condition) {
      let precondition;
      if (condition?.kind === 'create') precondition = { 'if-none-match': '*' };
      else if (condition?.kind === 'update' && Number.isSafeInteger(condition.expectedRevision) && condition.expectedRevision > 0) {
        precondition = { 'if-match': `"${condition.expectedRevision}"` };
      } else throw new TypeError('Cloud save precondition is invalid.');
      const result = await request(account, '/saves/current', {
        method: 'PUT',
        headers: precondition,
        body: JSON.stringify({ schemaVersion: 1, state: body.state }),
      });
      if (result.status === 200 || result.status === 201) return { status: result.status, envelope: result.body };
      return { status: result.status, ...result.body };
    },
    async startStageRun(account, body) {
      const result = await request(account, '/stage-runs', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { status: result.status, ...result.body };
    },
    async submitStageResult(account, runId, body) {
      if (typeof runId !== 'string' || !runId) throw new TypeError('A stage run id is required.');
      const result = await request(account, `/stage-runs/${encodeURIComponent(runId)}/result`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { status: result.status, ...result.body };
    },
    async publishPvpSnapshot(account, body) {
      const result = await request(account, '/pvp/snapshot', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return { status: result.status, ...result.body };
    },
    async searchPvpMatch(account, body = {}) {
      const result = await request(account, '/pvp/matches/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { status: result.status, ...result.body };
    },
    async submitPvpResult(account, matchId, body) {
      if (typeof matchId !== 'string' || !matchId) throw new TypeError('A PvP match id is required.');
      const result = await request(account, `/pvp/matches/${encodeURIComponent(matchId)}/result`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      return { status: result.status, ...result.body };
    },
  };
}
