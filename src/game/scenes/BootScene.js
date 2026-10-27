import Phaser from 'phaser';
import { createInitialState } from '../domain/stateFactory.js';
import { stageId } from '../domain/progression.js';
import { ENEMY_FRAME_SIZE, ENEMY_SPRITE_SHEETS } from '../ui/enemyAnimations.js';
import { KNIGHT_FRAME_HEIGHT, KNIGHT_FRAME_WIDTH } from '../ui/knightAnimations.js';
import { preloadWholeBodyWalks } from '../ui/WholeBodyWalk.js';
import { hasValidEquipmentAppearanceAssets, preloadEquipmentAppearanceAssets } from '../ui/equipmentAppearanceAssets.js';
import { preloadSceneBackgroundAssets } from '../ui/sceneBackgroundAssets.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    this.load.spritesheet('knight', '/assets/walk/knight-actions.png', {
      frameWidth:KNIGHT_FRAME_WIDTH,
      frameHeight:KNIGHT_FRAME_HEIGHT,
    });
    this.load.json('knight-actions-meta','/assets/walk/knight-actions.json');
    preloadWholeBodyWalks(this);
    preloadEquipmentAppearanceAssets(this.load);
    preloadSceneBackgroundAssets(this.load);
    for (const spriteSheet of Object.values(ENEMY_SPRITE_SHEETS)) {
      this.load.spritesheet(spriteSheet.key, spriteSheet.path, {
        frameWidth:ENEMY_FRAME_SIZE,
        frameHeight:ENEMY_FRAME_SIZE,
      });
      this.load.json(`${spriteSheet.key}-meta`,spriteSheet.path.replace('.png','.json'));
    }
  }

  create() {
    if (!this.hasValidKnightTexture() || !this.hasValidEquipmentAppearanceAssets()) {
      this.add.rectangle(640, 360, 1280, 720, 0x121a23);
      this.add.text(640, 320, '게임 이미지 리소스를 불러오지 못했습니다.', {
        fontFamily:'sans-serif', fontSize:'24px', color:'#ffb6ad', align:'center',
      }).setOrigin(0.5);
      this.add.text(640, 370, '기사 또는 장비 이미지 파일을 확인한 뒤 새로고침해 주세요.', {
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
      hasUnverifiedShadow: bootstrap?.hasUnverifiedShadow,
      selectLocalShadow: bootstrap?.selectLocalShadow,
      recoverLegacySave: bootstrap?.recoverLegacySave,
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
    return source?.width === 512 && source?.height === 768 &&
      texture.getFrameNames().length === 6 && texture.has('5');
  }

  hasValidEquipmentAppearanceAssets() {
    return hasValidEquipmentAppearanceAssets(this.textures);
  }
}
