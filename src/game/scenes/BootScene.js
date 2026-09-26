import Phaser from 'phaser';
import { createInitialState } from '../domain/stateFactory.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    this.scene.start('TownScene', { gameState: createInitialState() });
  }
}
