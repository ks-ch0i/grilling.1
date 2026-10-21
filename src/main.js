import Phaser from 'phaser';
import { createGameConfig } from './game/config.js';
import { createInitialState } from './game/domain/stateFactory.js';
import { createAccountSaveCoordinator } from './game/domain/accountSaveCoordinator.js';
import { createRankedRunClient } from './game/domain/rankedRunClient.js';
import { createPvpClient } from './game/domain/pvpClient.js';
import { stageId } from './game/domain/progression.js';
import { createCloudSaveClient } from './api/cloudSaveClient.js';
import {
  getApiAccessToken,
  initializeAuth,
  selectAccount,
  signInInteractively,
} from './auth/msalClient.js';
import './styles.css';

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

export function createGame({ gameState, saveState, account, apiClient, rankedRunClient, pvpClient }) {
  const container = document.querySelector('#game');
  if (!container) throw new Error('Game container "#game" was not found.');
  if (!gameState || typeof saveState !== 'function') throw new TypeError('An authenticated account save is required before creating the game.');

  const config = createGameConfig(container);
  config.callbacks = {
    ...config.callbacks,
    preBoot: (game) => {
      game.lancerBootstrap = {
        gameState,
        saveState,
        account,
        apiClient,
        rankedRunClient,
        pvpClient,
        unlockedStageId: stageId(gameState.progression.chapter, gameState.progression.currentStage),
      };
    },
  };
  return new Phaser.Game(config);
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
    showAccountStatus('오프라인 모드: 저장은 이 기기에 보관되며 연결이 복구되면 동기화됩니다.');
  } else if (result?.error === 'authentication-required') {
    showSaveWarning('클라우드 인증이 필요합니다. 다시 로그인해 주세요.');
  } else if (result?.error) {
    showSaveWarning('클라우드 동기화에 실패했습니다. 로컬 저장은 유지됩니다.');
  } else if (result?.ok) {
    showAccountStatus('');
  }
}

export async function startApplication({
  auth = { initializeAuth, selectAccount, signInInteractively, getApiAccessToken },
  createGameInstance = createGame,
} = {}) {
  setupOrientationMessage();
  showAuthGate();
  const apiClient = createCloudSaveClient({ getAccessToken: auth.getApiAccessToken });
  const coordinator = createAccountSaveCoordinator({
    api: apiClient,
    initialStateFactory: createInitialState,
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
        if (coordinator.getMode() === 'online' || window.navigator?.onLine) {
          void coordinator.syncPendingSave().then(syncMessage).catch(() => syncMessage({ error: 'cloud-save-unavailable' }));
        }
        return saved;
      };
      coordinator.attachOnlineSync(syncMessage);
      const rankedRunClient = createRankedRunClient({
        apiClient,
        account,
        getSaveRevision: coordinator.getSaveRevision,
        getCurrentState: coordinator.getCurrentState,
        getMode: coordinator.getMode,
        syncPendingSave: coordinator.syncPendingSave,
        refreshAccountSave: coordinator.refreshAccountSave,
        saveState,
        isOnline: () => window.navigator?.onLine !== false,
      });
      const pvpClient = createPvpClient({
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
      coordinator.setCloudSaveCallback(pvpClient.onCloudSaveSynced);
      game = createGameInstance({ gameState: loaded.state, saveState, account, apiClient, rankedRunClient, pvpClient });
      hideAuthGate();
      if (loaded.savedLocally === false) showSaveWarning('이 기기의 저장 공간을 사용할 수 없습니다. 이 브라우저를 닫으면 진행이 저장되지 않을 수 있습니다.');
      if (loaded.legacyOwnerSaved === false) showSaveWarning('기존 저장 소유자를 기록하지 못했습니다. 다른 계정으로 전환하지 말고 저장 공간을 확인해 주세요.');
      if (loaded.recoveredLocal) {
        showAccountStatus('클라우드 저장을 적용했습니다. 이전 로컬 저장은 이 계정의 복구 저장에 보관했습니다.');
        showSaveWarning('클라우드 저장이 달라 이전 로컬 저장을 복구용으로 보관했습니다.');
      } else {
        showAccountStatus(loaded.mode === 'offline'
          ? '오프라인 모드: 저장은 이 기기에 보관되며 연결 후 동기화됩니다.'
          : '');
      }
      if (loaded.mode === 'offline' && window.navigator?.onLine) {
        void coordinator.syncPendingSave().then(syncMessage).catch(() => syncMessage({ error: 'cloud-save-unavailable' }));
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
