import { createInitialState } from './game/domain/stateFactory.js';
import { createAccountSaveCoordinator } from './game/domain/accountSaveCoordinator.js';
import { createRankedRunClient } from './game/domain/rankedRunClient.js';
import { createPvpClient } from './game/domain/pvpClient.js';
import { createRankingClient } from './game/domain/rankingClient.js';
import { stageId } from './game/domain/progression.js';
import { createCloudSaveClient } from './api/cloudSaveClient.js';
import {
  getApiAccessToken,
  initializeAuth,
  selectAccount,
  signInInteractively,
} from './auth/msalClient.js';

const ENTRA_AUTH = { initializeAuth, selectAccount, signInInteractively, getApiAccessToken };
const LOCAL_GUEST_ACCOUNT = Object.freeze({
  tenantId:'local-development',
  localAccountId:'local-guest',
  idTokenClaims:{ oid:'local-guest' },
  username:'로컬 게스트',
});

function createLocalDevelopmentAuth() {
  const signedIn = () => ({ status:'signed-in', account:LOCAL_GUEST_ACCOUNT });
  return {
    initializeAuth:async () => signedIn(),
    selectAccount:() => signedIn(),
    signInInteractively:async () => signedIn(),
    getApiAccessToken:async () => '',
  };
}

function createLocalDevelopmentApiClient() {
  return {
    // The save coordinator uses these responses to initialize and retain a local-only profile.
    async getCurrent() { return { status:404, code:'save-not-found' }; },
    async putCurrent() { return { status:503, code:'local-development-only' }; },
  };
}

function createLocalDevelopmentRankingClient() {
  const snapshot = { stage:null, pvp:null, myRanks:null, connection:'offline', rankNotice:null };
  const listeners = new Set();
  const getSnapshot = () => ({ ...snapshot });
  return {
    connect:async () => false,
    getSnapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('A ranking observer must be a function.');
      listeners.add(listener);
      try { listener(getSnapshot()); } catch { /* Local observers cannot interrupt game startup. */ }
      return () => listeners.delete(listener);
    },
    async dispose() { listeners.clear(); },
  };
}

function showSaveWarning(message = '저장할 수 없습니다') {
  let notice = document.querySelector('#save-warning');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'save-warning';
    notice.setAttribute('role', 'status');
    document.body.append(notice);
  }
  notice.textContent = message;
  notice.classList.add('is-visible');
  window.clearTimeout(showSaveWarning.timer);
  showSaveWarning.timer = window.setTimeout(() => notice.classList.remove('is-visible'), 3600);
}

function showAccountStatus(message = '') {
  const notice = document.querySelector('#account-status');
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

export async function createGame({ gameState, saveState, account, apiClient, applyProfileAction, getSaveMode, hasUnverifiedShadow, selectLocalShadow, recoverLegacySave, rankedRunClient, pvpClient, rankingClient }) {
  const container = document.querySelector('#game');
  if (!container) throw new Error('Game container "#game" was not found.');
  if (!gameState || typeof saveState !== 'function') throw new TypeError('An authenticated account save is required before creating the game.');

  const { default: Phaser } = await import('phaser');
  const { createGameConfig } = await import('./game/config.js');
  const config = createGameConfig(container);
  config.callbacks = {
    ...config.callbacks,
    preBoot: (game) => {
      game.lancerBootstrap = {
        gameState,
        saveState,
        account,
        apiClient,
        applyProfileAction,
        getSaveMode,
        hasUnverifiedShadow,
        selectLocalShadow,
        recoverLegacySave,
        rankedRunClient,
        pvpClient,
        rankingClient,
        unlockedStageId: stageId(gameState.progression.chapter, gameState.progression.currentStage),
      };
    },
  };
  const game = new Phaser.Game(config);
  game.events.once('destroy', () => { void rankingClient?.dispose(); });
  return game;
}

function setupOrientationMessage() {
  const query = window.matchMedia('(orientation: portrait)');
  const update = () => document.body.classList.toggle('is-portrait', query.matches);
  update();
  query.addEventListener('change', update);
}

function setAuthMessage(message, { signIn = false, retry = false } = {}) {
  const messageElement = document.querySelector('#auth-message');
  const signInButton = document.querySelector('#sign-in-button');
  const retryButton = document.querySelector('#retry-auth-button');
  if (messageElement) messageElement.textContent = message;
  if (signInButton) signInButton.hidden = !signIn;
  if (retryButton) retryButton.hidden = !retry;
}

function setAccountChoices(accounts, onChoose) {
  const container = document.querySelector('#account-choices');
  if (!container) return;
  container.replaceChildren();
  for (const account of accounts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = account.username ?? account.name ?? '회사 계정';
    button.addEventListener('click', () => onChoose(account));
    container.append(button);
  }
}

function showAuthGate() {
  const gate = document.querySelector('#auth-gate');
  if (gate) gate.hidden = false;
  document.body.classList.remove('is-authenticated');
}

function hideAuthGate() {
  const gate = document.querySelector('#auth-gate');
  if (gate) gate.hidden = true;
  document.body.classList.add('is-authenticated');
}

function syncMessage(result) {
  if (result?.error === 'save-conflict') {
    showAccountStatus('클라우드 저장을 적용했습니다. 이전 로컬 저장은 이 계정의 복구 저장에 보관했습니다.');
    showSaveWarning('저장 충돌이 발생해 클라우드 저장을 적용하고 로컬 저장을 복구용으로 보관했습니다.');
  } else if (result?.error === 'network-unavailable') {
    showAccountStatus('오프라인 진행은 이 기기에 보관되며 온라인 저장과 자동으로 합쳐지지 않습니다.');
  } else if (result?.error === 'authentication-required') {
    showSaveWarning('클라우드 인증이 필요합니다. 다시 로그인해 주세요.');
  } else if (result?.error) {
    showSaveWarning('클라우드 동기화에 실패했습니다. 로컬 저장은 유지됩니다.');
  } else if (result?.ok) {
    showAccountStatus('');
  }
}

export async function startApplication({ auth, createGameInstance = createGame } = {}) {
  const localDevelopment = import.meta.env?.DEV === true;
  auth ??= localDevelopment ? createLocalDevelopmentAuth() : ENTRA_AUTH;
  setupOrientationMessage();
  showAuthGate();
  const apiClient = localDevelopment
    ? createLocalDevelopmentApiClient()
    : createCloudSaveClient({ getAccessToken: auth.getApiAccessToken });
  const coordinator = createAccountSaveCoordinator({
    api: apiClient,
    initialStateFactory: createInitialState,
    isGuestAccount:() => localDevelopment,
    onConflict: () => syncMessage({ error: 'save-conflict' }),
  });
  let game = null;
  let starting = false;
  let selectedAccount = null;

  async function startForAccount(account) {
    if (starting || game) return;
    starting = true;
    selectedAccount = account;
    setAuthMessage('계정 저장을 확인하고 있습니다...');
    setAccountChoices([]);
    try {
      const loaded = await coordinator.loadAccountSave(account);
      if (loaded.status !== 'ready') {
        const message = loaded.status === 'offline-unavailable'
          ? '연결할 수 없고 이 계정의 오프라인 저장도 없습니다. 연결한 뒤 다시 시도해 주세요.'
          : loaded.code === 'authentication-required'
            ? '클라우드 인증을 완료한 뒤 게임을 시작할 수 있습니다.'
            : '계정 저장을 불러오지 못했습니다. 다시 시도해 주세요.';
        setAuthMessage(message, { signIn: true, retry: true });
        return;
      }

      const saveState = (nextState) => {
        const saved = coordinator.saveLocal(nextState);
        if (!saved.ok) {
          showSaveWarning();
          return saved;
        }
        if (!localDevelopment && coordinator.getMode() === 'verified-online') {
          void coordinator.syncPendingSave().then(syncMessage).catch(() => syncMessage({ error: 'cloud-save-unavailable' }));
        }
        return saved;
      };
      if (!localDevelopment) coordinator.attachOnlineSync(syncMessage);
      const rankedRunClient = localDevelopment ? null : createRankedRunClient({
        apiClient,
        account,
        getSaveRevision: coordinator.getSaveRevision,
        getCurrentState: coordinator.getCurrentState,
        getMode: coordinator.getMode,
        syncPendingSave: coordinator.syncPendingSave,
        refreshAccountSave: coordinator.refreshAccountSave,
        saveState,
        applyVerifiedState: (envelope) => coordinator.applyVerifiedState(envelope, account),
        isOnline: () => window.navigator?.onLine !== false,
      });
      const pvpClient = localDevelopment ? null : createPvpClient({
        apiClient,
        account,
        getSaveRevision: coordinator.getSaveRevision,
        getCurrentState: coordinator.getCurrentState,
        getMode: coordinator.getMode,
        syncPendingSave: coordinator.syncPendingSave,
        refreshAccountSave: coordinator.refreshAccountSave,
        isOnline: () => window.navigator?.onLine !== false,
        reauthenticate: auth.signInInteractively,
      });
      if (pvpClient) coordinator.setCloudSaveCallback(pvpClient.onCloudSaveSynced);
      const rankingClient = localDevelopment ? createLocalDevelopmentRankingClient() : createRankingClient({
        apiClient,
        account,
        getAccessToken:auth.getApiAccessToken,
      });
      try {
        game = await createGameInstance({
          gameState: loaded.state,
          saveState,
          account,
          apiClient,
          applyProfileAction: coordinator.applyProfileAction,
          getSaveMode: coordinator.getMode,
          hasUnverifiedShadow: coordinator.hasUnverifiedShadow,
          selectLocalShadow: coordinator.selectLocalShadow,
          recoverLegacySave: coordinator.recoverLegacySave,
          rankedRunClient,
          pvpClient,
          rankingClient,
        });
      } catch (error) {
        if (localDevelopment) console.error('Local game startup failed.', error);
        try { await rankingClient.dispose(); } catch { /* The failed runtime has no active ranking session to keep. */ }
        const detail = localDevelopment && error instanceof Error ? ` (${error.message})` : '';
        setAuthMessage(`게임 런타임을 불러오지 못했습니다.${detail}`, { retry: true });
        return;
      }
      if (!localDevelopment) rankingClient.connect();
      hideAuthGate();
      window.requestAnimationFrame(() => game?.scale?.refresh?.());
      if (loaded.savedLocally === false) showSaveWarning('이 기기의 저장 공간을 사용할 수 없습니다. 이 브라우저를 닫으면 진행이 저장되지 않을 수 있습니다.');
      if (loaded.legacyOwnerSaved === false) showSaveWarning('기존 저장 소유자를 기록하지 못했습니다. 다른 계정으로 전환하지 말고 저장 공간을 확인해 주세요.');
      if (localDevelopment) {
        showAccountStatus('로컬 게스트 모드 · 저장은 이 브라우저에만 보관되며 랭킹과 PvP는 사용할 수 없습니다.');
      } else if (loaded.recoveredLocal) {
        showAccountStatus('클라우드 저장을 적용했습니다. 이전 로컬 저장은 이 계정의 복구 저장에 보관했습니다.');
        showSaveWarning('클라우드 저장이 달라 이전 로컬 저장을 복구용으로 보관했습니다.');
      } else if (loaded.hasUnverifiedShadow) {
        showAccountStatus('이 계정에 확인되지 않은 기기 진행이 있습니다. 마을에서 선택하거나 이전 저장을 확인할 수 있습니다.');
      } else {
        showAccountStatus(loaded.mode === 'offline-unverified'
          ? '오프라인 진행은 이 기기에 보관되며 온라인 저장과 자동으로 합쳐지지 않습니다.'
          : '');
      }
    } catch {
      setAuthMessage('인증 또는 저장 서비스에 연결하지 못했습니다. 다시 시도해 주세요.', { signIn: true, retry: true });
    } finally {
      starting = false;
    }
  }

  function showAuthState(result) {
    if (result.status === 'signed-in') {
      void startForAccount(result.account);
      return;
    }
    if (result.status === 'choose-account') {
      setAuthMessage('게임에 사용할 회사 계정을 선택해 주세요.');
      setAccountChoices(result.accounts, (account) => {
        try {
          const selected = auth.selectAccount(account.homeAccountId);
          void startForAccount(selected.account);
        } catch {
          setAuthMessage('계정을 선택하지 못했습니다. 다시 로그인해 주세요.', { signIn: true, retry: true });
        }
      });
      return;
    }
    setAuthMessage('회사 계정으로 로그인해 주세요.', { signIn: true });
  }

  document.querySelector('#sign-in-button')?.addEventListener('click', async () => {
    setAuthMessage('회사 계정 로그인 중...');
    try {
      showAuthState(await auth.signInInteractively());
    } catch {
      setAuthMessage('로그인하지 못했습니다. 팝업을 허용하고 다시 시도해 주세요.', { signIn: true, retry: true });
    }
  });

  document.querySelector('#retry-auth-button')?.addEventListener('click', async () => {
    setAuthMessage('다시 연결하고 있습니다...');
    try {
      if (selectedAccount) await startForAccount(selectedAccount);
      else showAuthState(await auth.initializeAuth());
    } catch {
      setAuthMessage('연결하지 못했습니다. 계정과 네트워크를 확인해 주세요.', { signIn: true, retry: true });
    }
  });

  try {
    showAuthState(await auth.initializeAuth());
  } catch {
    setAuthMessage('로그인 설정을 불러오지 못했습니다. 배포 설정을 확인하거나 다시 시도해 주세요.', { retry: true });
  }
  return { coordinator, apiClient, getGame: () => game };
}

document.addEventListener('DOMContentLoaded', () => {
  void startApplication();
});
