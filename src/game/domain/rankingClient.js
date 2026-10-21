const BOARDS = Object.freeze(['stage', 'pvp']);
const RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 30_000]);
const POLL_INTERVAL_MS = 60_000;

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function validSnapshot(snapshot, board) {
  return snapshot?.board === board && typeof snapshot.revision === 'string' &&
    Array.isArray(snapshot.topFive) && snapshot.topFive.length <= 5 &&
    typeof snapshot.generatedAtUtc === 'string' && Number.isFinite(Date.parse(snapshot.generatedAtUtc));
}

function validMyRanks(value) {
  return Boolean(value?.stage && Object.hasOwn(value.stage, 'rank') &&
    value.pvp && Object.hasOwn(value.pvp, 'rank') && Number.isFinite(value.pvp.rating));
}

export function createRankingClient({
  apiClient,
  account,
  getAccessToken = async () => { throw new Error('SignalR API token is unavailable.'); },
  loadSignalR = () => import('@microsoft/signalr'),
  windowObject = globalThis.window,
  now = () => new Date(),
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
} = {}) {
  if (!apiClient || typeof apiClient.getRankingTop !== 'function' || typeof apiClient.getMyRanks !== 'function') {
    throw new TypeError('Ranking API methods are required.');
  }
  if (!account) throw new TypeError('A signed-in account is required for rankings.');

  let snapshot = {
    stage:null,
    pvp:null,
    myRanks:null,
    connection:'connecting',
    rankNotice:null,
  };
  const listeners = new Set();
  const boardRequestIds = { stage:0, pvp:0 };
  let myRankRequestId = 0;
  let refreshEpoch = 0;
  let connection = null;
  let active = false;
  let disposed = false;
  let connecting = false;
  let retryIndex = 0;
  let reconnectTimer = null;
  let pollTimer = null;
  let rankRefreshTimer = null;
  let rankNoticeSequence = 0;

  function getSnapshot() {
    return clone(snapshot);
  }

  function emit() {
    const current = getSnapshot();
    for (const listener of listeners) {
      try { listener(current); } catch { /* A view observer cannot interrupt ranking updates. */ }
    }
  }

  function setConnection(value) {
    if (snapshot.connection === value) return;
    snapshot = { ...snapshot, connection:value };
    emit();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A ranking observer must be a function.');
    listeners.add(listener);
    try { listener(getSnapshot()); } catch { /* Observers are isolated from the data client. */ }
    return () => listeners.delete(listener);
  }

  function isOnline() {
    return windowObject?.navigator?.onLine !== false;
  }

  async function refreshBoard(board, epoch = refreshEpoch) {
    const requestId = ++boardRequestIds[board];
    let result;
    try { result = await apiClient.getRankingTop(account, board); }
    catch { return false; }
    if (disposed || epoch !== refreshEpoch || requestId !== boardRequestIds[board] ||
        result?.status !== 200 || !validSnapshot(result, board)) return false;
    if (snapshot[board]?.revision === result.revision) return true;
    snapshot = { ...snapshot, [board]:clone(result) };
    emit();
    return true;
  }

  async function refreshMyRanks({ notify = true } = {}) {
    if (!isOnline()) return false;
    const requestId = ++myRankRequestId;
    let result;
    try { result = await apiClient.getMyRanks(account); }
    catch { return false; }
    if (disposed || requestId !== myRankRequestId || result?.status !== 200 || !validMyRanks(result)) return false;
    const previous = snapshot.myRanks;
    const next = {
      stage:clone(result.stage),
      pvp:clone(result.pvp),
    };
    let notice = snapshot.rankNotice;
    if (notify && previous) {
      for (const board of BOARDS) {
        const from = previous[board].rank;
        const to = next[board].rank;
        if (from !== to) {
          notice = {
            id:++rankNoticeSequence,
            board,
            from,
            to,
            generatedAtUtc:now().toISOString(),
          };
        }
      }
    }
    snapshot = { ...snapshot, myRanks:next, rankNotice:notice };
    emit();
    return true;
  }

  async function refreshAll({ live = false } = {}) {
    if (!isOnline()) return false;
    const epoch = ++refreshEpoch;
    const results = await Promise.all([
      ...BOARDS.map((board) => refreshBoard(board, epoch)),
      refreshMyRanks(),
    ]);
    const success = results.every(Boolean);
    if (live && success && epoch === refreshEpoch) setConnection('live');
    return success;
  }

  function applyBoardEvent(event, board) {
    if (disposed || !validSnapshot(event, board)) return;
    const current = snapshot[board];
    if (current && Date.parse(event.generatedAtUtc) < Date.parse(current.generatedAtUtc)) return;
    if (current?.revision === event.revision) {
      snapshot = { ...snapshot, [board]:{ ...current, generatedAtUtc:event.generatedAtUtc } };
      scheduleMyRankRefresh();
      return;
    }
    refreshEpoch += 1;
    boardRequestIds[board] += 1;
    myRankRequestId += 1;
    snapshot = { ...snapshot, [board]:clone(event) };
    emit();
    scheduleMyRankRefresh();
  }

  function scheduleMyRankRefresh() {
    if (rankRefreshTimer !== null) clearTimeoutImpl(rankRefreshTimer);
    rankRefreshTimer = setTimeoutImpl(() => {
      rankRefreshTimer = null;
      void refreshMyRanks({ notify:true });
    }, 60);
  }

  function startPolling() {
    if (pollTimer !== null || disposed || !isOnline()) return;
    pollTimer = setIntervalImpl(() => {
      if (isOnline() && snapshot.connection !== 'live') void refreshAll();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer !== null) clearIntervalImpl(pollTimer);
    pollTimer = null;
  }

  function scheduleReconnect() {
    if (disposed || !active || !isOnline() || reconnectTimer !== null) return;
    const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
    retryIndex += 1;
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      void startConnection();
    }, delay);
  }

  async function createConnection() {
    const signalR = await loadSignalR();
    const signalRUrl = `${String(apiClient.apiBaseUrl ?? '/api').replace(/\/+$/, '')}/signalr`;
    const next = new signalR.HubConnectionBuilder()
      .withUrl(signalRUrl, { accessTokenFactory:() => getAccessToken(account) })
      .withAutomaticReconnect([...RETRY_DELAYS_MS])
      .build();
    next.on('stageTopChanged', (event) => applyBoardEvent(event, 'stage'));
    next.on('pvpTopChanged', (event) => applyBoardEvent(event, 'pvp'));
    next.on('playerRankChanged', (event) => {
      if (BOARDS.includes(event?.board)) {
        myRankRequestId += 1;
        scheduleMyRankRefresh();
      }
    });
    next.onreconnecting(() => {
      setConnection('reconnecting');
      startPolling();
    });
    next.onreconnected(async () => {
      setConnection('connecting');
      const ok = await refreshAll({ live:true });
      if (ok) {
        retryIndex = 0;
        stopPolling();
      } else {
        setConnection('disconnected');
        startPolling();
      }
    });
    next.onclose(() => {
      connection = null;
      if (disposed || !active) return;
      setConnection('disconnected');
      startPolling();
      scheduleReconnect();
    });
    return next;
  }

  async function startConnection() {
    if (disposed || !active || connecting || !isOnline()) return false;
    connecting = true;
    setConnection('connecting');
    try {
      if (!connection) connection = await createConnection();
      await connection.start();
      retryIndex = 0;
      const ok = await refreshAll({ live:true });
      if (ok) stopPolling();
      else {
        setConnection('disconnected');
        startPolling();
      }
      return ok;
    } catch {
      const previous = connection;
      connection = null;
      try { await previous?.stop(); } catch { /* The initial connection already failed. */ }
      setConnection('disconnected');
      void refreshAll();
      startPolling();
      scheduleReconnect();
      return false;
    } finally {
      connecting = false;
    }
  }

  function onOffline() {
    stopPolling();
    if (reconnectTimer !== null) clearTimeoutImpl(reconnectTimer);
    reconnectTimer = null;
    setConnection('offline');
  }

  function onOnline() {
    if (disposed || !active) return;
    setConnection('connecting');
    void refreshAll().finally(() => { void startConnection(); });
  }

  function connect() {
    if (disposed || active) return Promise.resolve(false);
    active = true;
    if (windowObject?.addEventListener) {
      windowObject.addEventListener('offline', onOffline);
      windowObject.addEventListener('online', onOnline);
    }
    if (!isOnline()) {
      setConnection('offline');
      return Promise.resolve(false);
    }
    return startConnection();
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    stopPolling();
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (rankRefreshTimer !== null) clearTimeoutImpl(rankRefreshTimer);
    reconnectTimer = null;
    rankRefreshTimer = null;
    if (windowObject?.removeEventListener) {
      windowObject.removeEventListener('offline', onOffline);
      windowObject.removeEventListener('online', onOnline);
    }
    try { await connection?.stop(); } catch { /* Disposal is best-effort. */ }
    connection = null;
    listeners.clear();
  }

  return { connect, subscribe, getSnapshot, refreshAll, dispose };
}

export { POLL_INTERVAL_MS, RETRY_DELAYS_MS };
