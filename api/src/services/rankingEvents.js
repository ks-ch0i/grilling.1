import { createHash } from 'node:crypto';

const SIGNALR_SCOPE = 'https://signalr.azure.com/.default';
const SIGNALR_API_VERSION = '20241201';
const BOARD_EVENTS = Object.freeze({ stage:'stageTopChanged', pvp:'pvpTopChanged' });

export function rankingUserId(identity) {
  const tenantId = String(identity?.tenantId ?? '').trim().toLowerCase();
  const objectId = String(identity?.objectId ?? '').trim().toLowerCase();
  if (!tenantId || !objectId) throw new TypeError('A verified Entra identity is required for SignalR.');
  const digest = createHash('sha256').update(`${tenantId}:${objectId}`).digest('base64url');
  return `player_${digest}`;
}

export function buildRankingSnapshot(board, topFive, generatedAtUtc = new Date()) {
  if (!Object.hasOwn(BOARD_EVENTS, board) || !Array.isArray(topFive)) throw new TypeError('A valid ranking board snapshot is required.');
  const publicRows = topFive.slice(0, 5).map((entry, index) => board === 'stage'
    ? {
      rank:index + 1,
      displayName:entry.displayName ?? null,
      chapter:Number(entry.chapter),
      stage:Number(entry.stage),
      clearTimeMs:Number(entry.clearTimeMs),
    }
    : {
      rank:index + 1,
      displayName:entry.displayName ?? null,
      rating:Number(entry.rating),
    });
  const revision = createHash('sha256')
    .update(JSON.stringify({ board, topFive:publicRows }))
    .digest('hex');
  const time = generatedAtUtc instanceof Date ? generatedAtUtc : new Date(generatedAtUtc);
  if (!Number.isFinite(time.getTime())) throw new TypeError('Ranking snapshot timestamp is invalid.');
  return { board, revision, topFive:publicRows, generatedAtUtc:time.toISOString() };
}

export function createRankingEventsService({
  env = process.env,
  credential,
  fetchImplementation = globalThis.fetch,
} = {}) {
  const endpoint = String(env.SIGNALR_SERVICE_ENDPOINT ?? '').trim().replace(/\/+$/, '');
  const hub = String(env.SIGNALR_HUB_NAME ?? 'rankings').trim();
  if (typeof fetchImplementation !== 'function') throw new TypeError('A fetch implementation is required for SignalR.');

  async function serviceToken() {
    if (!endpoint || !credential || typeof credential.getToken !== 'function') {
      const error = new Error('SignalR serverless connection is not configured.');
      error.code = 'signalr-not-configured';
      throw error;
    }
    const access = await credential.getToken(SIGNALR_SCOPE);
    if (!access?.token) throw new Error('SignalR management token could not be acquired.');
    return access.token;
  }

  async function request(path, method, token, body) {
    const response = await fetchImplementation(`${endpoint}${path}`, {
      method,
      headers:{ authorization:`Bearer ${token}`, ...(body ? { 'content-type':'application/json' } : {}) },
      ...(body ? { body:JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = new Error(`SignalR management request failed with HTTP ${response.status}.`);
      error.code = `signalr-http-${response.status}`;
      throw error;
    }
    if (response.status === 204 || response.status === 202) return {};
    try { return await response.json(); } catch { return {}; }
  }

  function apiPath(path) {
    return `${path}?api-version=${SIGNALR_API_VERSION}`;
  }

  async function negotiate(identity) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(hub)) throw new TypeError('SignalR hub name is invalid.');
    const userId = rankingUserId(identity);
    const token = await serviceToken();
    const tokenUrl = new URL(apiPath(`/api/hubs/${encodeURIComponent(hub)}/:generateToken`), `${endpoint}/`);
    tokenUrl.searchParams.set('userId', userId);
    tokenUrl.searchParams.set('minutesToExpire', '30');
    const generated = await request(`${tokenUrl.pathname}${tokenUrl.search}`, 'POST', token);
    if (typeof generated.token !== 'string' || !generated.token) throw new Error('SignalR returned an invalid client token.');
    await Promise.all(['ranking:stage', 'ranking:pvp'].map((group) => {
      const path = apiPath(`/api/hubs/${encodeURIComponent(hub)}/users/${encodeURIComponent(userId)}/groups/${encodeURIComponent(group)}`) + '&ttl=3600';
      return request(path, 'PUT', token);
    }));
    return {
      url:`${endpoint}/client/?hub=${encodeURIComponent(hub)}`,
      accessToken:generated.token,
    };
  }

  async function send(target, args, destination) {
    const token = await serviceToken();
    const path = destination.kind === 'group'
      ? `/api/hubs/${encodeURIComponent(hub)}/groups/${encodeURIComponent(destination.name)}/:send`
      : `/api/hubs/${encodeURIComponent(hub)}/users/${encodeURIComponent(destination.name)}/:send`;
    await request(apiPath(path), 'POST', token, { target, arguments:[args] });
  }

  async function publishTopFiveChanged({ board, topFive, generatedAtUtc = new Date() } = {}) {
    const snapshot = buildRankingSnapshot(board, topFive, generatedAtUtc);
    await send(BOARD_EVENTS[board], snapshot, { kind:'group', name:`ranking:${board}` });
  }

  async function publishPlayerRankChanged({ identity, board, generatedAtUtc = new Date() } = {}) {
    if (!Object.hasOwn(BOARD_EVENTS, board)) throw new TypeError('Ranking board name is invalid.');
    const payload = { board, generatedAtUtc:new Date(generatedAtUtc).toISOString() };
    await send('playerRankChanged', payload, { kind:'user', name:rankingUserId(identity) });
  }

  return { negotiate, publishTopFiveChanged, publishPlayerRankChanged };
}
