import Phaser from 'phaser';
import { createInitialState } from '../domain/stateFactory.js';
import { stageId } from '../domain/progression.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    const bootstrap = this.game.lancerBootstrap;
    const gameState = bootstrap?.gameState ?? createInitialState();
    const selectedStage = bootstrap?.unlockedStageId ??
      stageId(gameState.progression.chapter, gameState.progression.currentStage);
    this.scene.start('TownScene', {
      gameState,
      saveState: bootstrap?.saveState,
      rankedRunClient: bootstrap?.rankedRunClient,
      unlockedStageId: selectedStage,
    });
  }
}
