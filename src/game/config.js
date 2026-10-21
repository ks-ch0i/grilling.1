import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { TownScene } from './scenes/TownScene.js';
import { BattleScene } from './scenes/BattleScene.js';
import { PvpScene } from './scenes/PvpScene.js';

export function createGameConfig(parent) {
  return {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    parent,
    backgroundColor: '#17202b',
    audio: { noAudio:true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, TownScene, BattleScene, PvpScene],
  };
}
