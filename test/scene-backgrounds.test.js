import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BACKGROUND_ASSETS } from '../src/game/ui/sceneBackgroundAssets.js';
import * as backgroundAssets from '../src/game/ui/sceneBackgroundAssets.js';

function createSceneStub() {
  const objects = [];
  const makeObject = (type, x, y, width, height, key) => {
    const object = {
      type,
      x,
      y,
      width,
      height,
      key,
      depth: 0,
      scrollFactorX: 1,
      scrollFactorY: 1,
      tilePositionX: 0,
      tilePositionY: 0,
      originX: 0.5,
      originY: 0.5,
      setOrigin(originX, originY = originX) {
        this.originX = originX;
        this.originY = originY;
        return this;
      },
      setScrollFactor(xFactor, yFactor = xFactor) {
        this.scrollFactorX = xFactor;
        this.scrollFactorY = yFactor;
        return this;
      },
      setDepth(depth) {
        this.depth = depth;
        return this;
      },
      setDisplaySize(displayWidth, displayHeight) {
        this.width = displayWidth;
        this.height = displayHeight;
        return this;
      },
      setTilePosition(tileX, tileY = this.tilePositionY) {
        this.tilePositionX = tileX;
        this.tilePositionY = tileY;
        return this;
      },
    };
    objects.push(object);
    return object;
  };
  return {
    objects,
    add: {
      image: (x, y, key) => makeObject('image', x, y, 0, 0, key),
      tileSprite: (x, y, width, height, key) => makeObject('tileSprite', x, y, width, height, key),
    },
  };
}

function readSceneSource(name) {
  return readFileSync(new URL(`../src/game/scenes/${name}.js`, import.meta.url), 'utf8');
}

async function loadSceneBackgrounds() {
  const module = await import('../src/game/ui/sceneBackgrounds.js').catch(() => null);
  assert.ok(module, 'sceneBackgrounds.js should expose the shared scene background helpers');
  return module;
}

test('chapter themes cycle in order and reject invalid chapter numbers', async () => {
  const { getBattleThemeForChapter } = await loadSceneBackgrounds();
  assert.deepEqual(Array.from({ length: 10 }, (_, index) => getBattleThemeForChapter(index + 1)), [
    'forest-trail', 'ruined-village', 'rocky-canyon', 'snowy-fortress', 'volcanic-citadel',
    'forest-trail', 'ruined-village', 'rocky-canyon', 'snowy-fortress', 'volcanic-citadel',
  ]);
  for (const chapter of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => getBattleThemeForChapter(chapter), RangeError);
  }
});

test('battle backgrounds use world panorama and camera-sized parallax tiles', async () => {
  const { createBattleBackgroundLayers, updateBattleBackgroundLayers } = await loadSceneBackgrounds();
  const scene = createSceneStub();
  const layers = createBattleBackgroundLayers(scene, 6);
  assert.deepEqual(Object.keys(layers), ['far', 'mid', 'front']);
  assert.deepEqual(scene.objects.map(({ key, type, x, y, width, height, depth }) => ({ key, type, x, y, width, height, depth })), [
    { key: 'background-forest-trail-far', type: 'image', x: 0, y: 0, width: 4800, height: 560, depth: -30 },
    { key: 'background-forest-trail-mid', type: 'tileSprite', x: 0, y: 0, width: 1280, height: 560, depth: -20 },
    { key: 'background-forest-trail-front', type: 'tileSprite', x: 0, y: 0, width: 1280, height: 560, depth: -10 },
  ]);
  assert.equal(layers.far.scrollFactorX, 0.88);
  assert.equal(layers.mid.scrollFactorX, 0);
  assert.equal(layers.front.scrollFactorX, 0);

  updateBattleBackgroundLayers(layers, 3520);
  assert.equal(layers.mid.tilePositionX, 3344);
  assert.equal(layers.front.tilePositionX, 3520);
  updateBattleBackgroundLayers(layers, -520);
  assert.equal(layers.mid.tilePositionX, -494);
  assert.equal(layers.front.tilePositionX, -520);
  updateBattleBackgroundLayers(layers, 3520);
  assert.equal(layers.mid.tilePositionX, 3344);
  assert.throws(() => createBattleBackgroundLayers(createSceneStub(), 0), RangeError);
  assert.throws(() => updateBattleBackgroundLayers(layers, Number.NaN), RangeError);
});

test('static backgrounds resolve town and PvP assets at fixed 1280x720 depth', async () => {
  const { createStaticSceneBackground } = await loadSceneBackgrounds();
  for (const [kind, key] of [['town', 'background-town-frontier-square'], ['pvp', 'background-pvp-stone-arena']]) {
    const scene = createSceneStub();
    const background = createStaticSceneBackground(scene, kind);
    assert.equal(background.key, key);
    assert.equal(background.x, 0);
    assert.equal(background.y, 0);
    assert.equal(background.width, 1280);
    assert.equal(background.height, 720);
    assert.equal(background.scrollFactorX, 0);
    assert.equal(background.depth, -30);
  }
  assert.throws(() => createStaticSceneBackground(createSceneStub(), 'arena'), RangeError);
});

test('BootScene preloads every manifest background image', () => {
  const { preloadSceneBackgroundAssets } = backgroundAssets;
  assert.equal(typeof preloadSceneBackgroundAssets, 'function');
  const requests = [];
  preloadSceneBackgroundAssets({ image: (key, path) => requests.push({ key, path }) });
  const expected = [
    ...Object.values(BACKGROUND_ASSETS.battle).flatMap((layers) => Object.values(layers)),
    BACKGROUND_ASSETS.town,
    BACKGROUND_ASSETS.pvp,
  ];
  assert.equal(requests.length, 17);
  assert.equal(new Set(requests.map(({ key }) => key)).size, 17);
  assert.deepEqual(requests, expected);
  assert.ok(readSceneSource('BootScene').includes('preloadSceneBackgroundAssets(this.load)'), 'BootScene.preload should load the background manifest');
});

test('Battle, Town, and PvP place backgrounds behind unchanged floor and scene content', () => {
  const battle = readSceneSource('BattleScene');
  const town = readSceneSource('TownScene');
  const pvp = readSceneSource('PvpScene');
  assert.ok(battle.includes('createBattleBackgroundLayers(this, this.chapter)'), 'BattleScene should create chapter-specific layers');
  assert.ok(battle.includes('updateBattleBackgroundLayers(this.backgroundLayers, this.cameras.main.scrollX)'), 'BattleScene should update tile positions from camera scroll');
  assert.ok(battle.includes('const FLOOR_Y = 560'), 'BattleScene floor must remain at y=560');
  assert.ok(battle.includes('FLOOR_Y, WORLD_WIDTH, 4, 0xb19361'), 'BattleScene should retain the floor line');
  assert.ok(!battle.includes('for (let x = 300; x < WORLD_WIDTH; x += 760)'), 'BattleScene should remove the old decorative skyline');

  assert.ok(town.includes("createStaticSceneBackground(this, 'town')"), 'TownScene.renderTown should recreate the static town background');
  assert.ok(!town.includes('add.rectangle(640, 360, 1280, 720, 0x121a23)'), 'TownScene should remove the old flat background');
  assert.ok(pvp.includes("createStaticSceneBackground(this, 'pvp')"), 'PvpScene should show the arena background');
  assert.ok(pvp.includes('FLOOR_Y, 1280, 8, 0xd8ba77'), 'PvpScene should retain the floor line');
  assert.ok(!pvp.includes('add.rectangle(640, 360, 1280, 720, 0x121a23)'), 'PvpScene should remove the old flat background');
});
