import {
  BACKGROUND_ASSETS,
  BATTLE_BACKGROUND_THEMES,
  getBattleBackgroundAssetKeys,
} from './sceneBackgroundAssets.js';

const WORLD_WIDTH = 4800;
const VIEW_WIDTH = 1280;
const BATTLE_HEIGHT = 560;
const PARALLAX = Object.freeze({ far:0.88, mid:0.95, front:1 });

export function getBattleThemeForChapter(chapter) {
  if (!Number.isSafeInteger(chapter) || chapter < 1) {
    throw new RangeError(`Invalid battle chapter: ${chapter}`);
  }
  return BATTLE_BACKGROUND_THEMES[(chapter - 1) % BATTLE_BACKGROUND_THEMES.length];
}

export function createBattleBackgroundLayers(scene, chapter) {
  const theme = getBattleThemeForChapter(chapter);
  const keys = getBattleBackgroundAssetKeys(theme);
  const far = scene.add.image(0, 0, keys.far)
    .setOrigin(0, 0)
    .setDisplaySize(WORLD_WIDTH, BATTLE_HEIGHT)
    .setScrollFactor(PARALLAX.far, 1)
    .setDepth(-30);
  const mid = scene.add.tileSprite(0, 0, VIEW_WIDTH, BATTLE_HEIGHT, keys.mid)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(-20);
  const front = scene.add.tileSprite(0, 0, VIEW_WIDTH, BATTLE_HEIGHT, keys.front)
    .setOrigin(0, 0)
    .setScrollFactor(0)
    .setDepth(-10);

  return { far, mid, front };
}

export function updateBattleBackgroundLayers(layers, cameraScrollX) {
  if (!Number.isFinite(cameraScrollX)) {
    throw new RangeError(`Invalid battle camera scroll: ${cameraScrollX}`);
  }
  const midPosition = cameraScrollX * PARALLAX.mid;
  const frontPosition = cameraScrollX * PARALLAX.front;
  if (layers.mid.tilePositionX !== midPosition) layers.mid.setTilePosition(midPosition, 0);
  if (layers.front.tilePositionX !== frontPosition) layers.front.setTilePosition(frontPosition, 0);
  return layers;
}

export function createStaticSceneBackground(scene, kind) {
  const asset = BACKGROUND_ASSETS[kind];
  if (!asset) throw new RangeError(`Unsupported static scene background: ${kind}`);
  return scene.add.image(0, 0, asset.key)
    .setOrigin(0, 0)
    .setDisplaySize(1280, 720)
    .setScrollFactor(0)
    .setDepth(-30);
}
