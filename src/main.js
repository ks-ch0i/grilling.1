import Phaser from 'phaser';
import { createGameConfig } from './game/config.js';
import './styles.css';

export function createGame() {
  const container = document.querySelector('#game');
  if (!container) {
    throw new Error('Game container "#game" was not found.');
  }

  return new Phaser.Game(createGameConfig(container));
}

function setupOrientationMessage() {
  const query = window.matchMedia('(orientation: portrait)');
  const update = () => {
    document.body.classList.toggle('is-portrait', query.matches);
  };

  update();
  query.addEventListener('change', update);
}

document.addEventListener('DOMContentLoaded', () => {
  setupOrientationMessage();
  createGame();
});
