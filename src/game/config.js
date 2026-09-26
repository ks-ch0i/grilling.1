import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';

export function createGameConfig(parent) {
  return {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent,
    backgroundColor: '#17202b',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene],
  };
}
