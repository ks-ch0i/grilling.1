import Phaser from 'phaser';
import { createGameConfig } from './game/config.js';
import { createInitialState } from './game/domain/stateFactory.js';
import { loadGameState, saveGameState } from './game/domain/saveStore.js';
import { stageId } from './game/domain/progression.js';
import './styles.css';

function showSaveWarning() {
  let notice = document.querySelector('#save-warning');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'save-warning';
    notice.setAttribute('role', 'status');
    notice.textContent = '저장할 수 없습니다';
    document.body.append(notice);
  }
  notice.classList.add('is-visible');
  window.clearTimeout(showSaveWarning.timer);
  showSaveWarning.timer = window.setTimeout(() => notice.classList.remove('is-visible'), 2400);
}

export function createGame() {
  const container = document.querySelector('#game');
  if (!container) throw new Error('Game container "#game" was not found.');

  const gameState = loadGameState(createInitialState());
  const saveState = (nextState) => {
    const result = saveGameState(nextState);
    if (!result.ok) showSaveWarning();
    return result;
  };
  saveState(gameState);
  const config = createGameConfig(container);
  config.callbacks = {
    ...config.callbacks,
    preBoot: (game) => {
      game.lancerBootstrap = {
        gameState,
        saveState,
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

document.addEventListener('DOMContentLoaded', () => {
  setupOrientationMessage();
  createGame();
});
