import Phaser from 'phaser';
import { createInitialState } from '../domain/stateFactory.js';
import { stageId } from '../domain/progression.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.load.spritesheet('knight', '/assets/knight/knight-actions.png', {
      frameWidth:128,
      frameHeight:160,
    });
  }

  create() {
    if (!this.hasValidKnightTexture()) {
      this.add.rectangle(640, 360, 1280, 720, 0x121a23);
      this.add.text(640, 320, '기사 이미지를 불러오지 못했습니다.', {
        fontFamily:'sans-serif', fontSize:'24px', color:'#ffb6ad', align:'center',
      }).setOrigin(0.5);
      this.add.text(640, 370, 'assets/knight/knight-actions.png 파일을 확인한 뒤 새로고침해 주세요.', {
        fontFamily:'sans-serif', fontSize:'16px', color:'#e4ebf1', align:'center',
      }).setOrigin(0.5);
      return;
    }
    const bootstrap = this.game.lancerBootstrap;
    const gameState = bootstrap?.gameState ?? createInitialState();
    const selectedStage = bootstrap?.unlockedStageId ??
      stageId(gameState.progression.chapter, gameState.progression.currentStage);
    this.scene.start('TownScene', {
      gameState,
      saveState: bootstrap?.saveState,
      rankedRunClient: bootstrap?.rankedRunClient,
      pvpClient: bootstrap?.pvpClient,
      rankingClient: bootstrap?.rankingClient,
      unlockedStageId: selectedStage,
    });
  }

  hasValidKnightTexture() {
    if (!this.textures.exists('knight')) return false;
    const texture = this.textures.get('knight');
    const source = texture.getSourceImage();
    return source?.width === 512 && source?.height === 800 &&
      texture.getFrameNames().length === 20 && texture.has('19');
  }
}
