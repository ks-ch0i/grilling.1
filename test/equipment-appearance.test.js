import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EquipmentAppearance, getEquipmentTextureKey, renderTownEquipmentPreview } from '../src/game/ui/equipmentAppearance.js';
import {
  EQUIPMENT_APPEARANCE_ASSETS,
  EQUIPMENT_SLOTS,
  hasValidEquipmentAppearanceAssets,
  preloadEquipmentAppearanceAssets,
} from '../src/game/ui/equipmentAppearanceAssets.js';

function makeScene() {
  const images = [];
  const containers = [];
  const image = (x, y, key, frame) => {
    const object = {
      x, y, key, frame, visible:true, flipX:false, destroyed:false,
      width:256, height:256,
      setOrigin(...origin) { this.origin=origin; return this; },
      setPosition(x,y) { this.x=x; this.y=y; return this; },
      setScale(scale) { this.scale=scale; return this; },
      setVisible(visible) { this.visible=visible; return this; },
      setTexture(nextKey) { this.key=nextKey; this.frame=0; return this; },
      setFrame(nextFrame) { this.frame=nextFrame; return this; },
      setFlipX(flipX) { this.flipX=flipX; return this; },
      destroy() { this.destroyed=true; },
    };
    images.push(object);
    return object;
  };
  const scene = { add:{
    image,
    container(x, y) {
      const parent = { type:'Container', x, y, children:[], add(child) { this.children.push(child); return this; }, setScale(x,y) { this.scaleX=x; this.scaleY=y; return this; }, destroy() { this.destroyed=true; } };
      containers.push(parent);
      return parent;
    },
  } };
  return { scene, images, containers };
}

function equipment(overrides = {}) {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, overrides[slot] ?? null]));
}

test('equipment appearance validates keys and builds ordered, rarity-based layers without changing gear', () => {
  assert.equal(getEquipmentTextureKey('helmet', 'rare'), 'gear-helmet-rare');
  assert.throws(() => getEquipmentTextureKey('cape', 'rare'), RangeError);
  assert.throws(() => getEquipmentTextureKey('helmet', 'mythic'), RangeError);

  const { scene } = makeScene();
  const parent = { type:'Container', children:[], add(child) { this.children.push(child); } };
  const gear = equipment({
    helmet:{ slot:'helmet', rarity:'rare', id:'helm-1', level:99, stats:{ attack:999 } },
    horse:{ slot:'horse', rarity:'legendary' },
    spear:{ slot:'spear', rarity:'common' },
  });
  const original = structuredClone(gear);
  const appearance = new EquipmentAppearance(scene, parent, gear, { scale:1.25 });

  assert.deepEqual(appearance.layers.map(({ slot,part }) => `${slot}-${part}`), ['horse-back','spear-back','armor-back','boots-back','gloves-back','helmet-back','horse-front','armor-front','boots-front','spear-front','gloves-front','helmet-front']);
  assert.deepEqual(parent.children, [appearance.container]);
  assert.deepEqual(appearance.container.children, appearance.layers.map(({ image }) => image));
  assert.equal(appearance.layers.find(({ slot }) => slot === 'helmet').image.key, 'gear-helmet-rare');
  assert.equal(appearance.container.scaleX, 1.25);
  assert.equal(appearance.layers.find(({ slot }) => slot === 'armor').image.visible, false);
  assert.deepEqual(gear, original);
});

test('mounted layers share an anchor and mirror together while action scale follows the base', () => {
  const { scene } = makeScene();
  const parent = { type:'Container', children:[], add(child) { this.children.push(child); } };
  const appearance = new EquipmentAppearance(scene, parent, equipment({ helmet:{slot:'helmet',rarity:'rare'} }), { scale:1, actionScale:1.2 });
  for (const {image} of appearance.layers) {
    assert.equal(image.x, 0);
    assert.equal(image.y, 0);
    assert.deepEqual(image.origin, [0.5,244/256]);
  }
  appearance.setFacing(1).setFrame(0);
  assert.equal(appearance.container.scaleX, -1);
  assert.equal(appearance.container.scaleY, 1);
  appearance.setFrame(4);
  assert.equal(appearance.container.scaleX, -1.2);
  assert.equal(appearance.container.scaleY, 1.2);
  appearance.setFacing(-1).setFrame(9);
  assert.equal(appearance.container.scaleX, 1.2);
  appearance.setFrame(3);
  assert.equal(appearance.container.scaleX, 1);
});

test('equipment appearance synchronizes frames, facing, and visibility; reserved frames are rejected', () => {
  const { scene } = makeScene();
  const parent = { type:'Container', children:[], add(child) { this.children.push(child); } };
  const appearance = new EquipmentAppearance(scene, parent, equipment({ armor:{slot:'armor',rarity:'uncommon'} }), {
    scale:1,
    initialFrame:4,
    slots:['armor'],
  });
  const armor = appearance.layers[0].image;
  assert.equal(armor.frame, 4);
  appearance.setFrame(9);
  assert.equal(armor.frame, 9);
  assert.throws(() => appearance.setFrame(11), RangeError);
  assert.throws(() => appearance.setFrame(1.5), TypeError);
  appearance.setFacing(-1);
  assert.equal(appearance.container.scaleX, 1);
  appearance.setFacing(0);
  assert.equal(appearance.container.scaleX, 1);
  appearance.setFacing(1);
  assert.equal(appearance.container.scaleX, -1);
  appearance.setEquipment(equipment());
  assert.equal(armor.visible, false);
  appearance.setVisible(false);
  assert.equal(armor.visible, false);
  appearance.setEquipment(equipment({ armor:{slot:'armor',rarity:'legendary'} }));
  assert.equal(armor.key, 'gear-armor-legendary');
  assert.equal(armor.frame, 9);
  assert.equal(armor.visible, false);
  appearance.setVisible(true);
  assert.equal(armor.visible, true);
  appearance.destroy();
  appearance.destroy();
  assert.equal(armor.destroyed, true);
});

test('Town preview places horse and knight equipment side by side without base images', () => {
  const { scene, images, containers } = makeScene();
  const previews = renderTownEquipmentPreview(scene, equipment({
    horse:{slot:'horse',rarity:'rare'},
    helmet:{slot:'helmet',rarity:'unique'},
  }));

  assert.deepEqual(containers.filter(({ x }) => x !== 0).map(({ x,y }) => [x,y]), [[556,118],[628,118]]);
  assert.deepEqual(Object.keys(previews), ['horseAppearance','knightAppearance']);
  assert.equal(images.length, 12);
  assert.ok(images.every(({ key }) => key.startsWith('gear-')));
  assert.ok(!images.some(({ key }) => ['walk-knight','knight-standing'].includes(key)));
  assert.equal(images.find(({ key }) => key === 'gear-horse-rare').frame, 10);
  assert.equal(images.find(({ key }) => key === 'gear-helmet-unique').frame, 10);
  assert.deepEqual(previews.horseAppearance.layers[0].image.origin, [0.5,0.5]);
  assert.equal(previews.knightAppearance.container.scaleX, 0.25);
  assert.deepEqual(previews.horseAppearance.layers.map(({ slot }) => slot), ['horse','horse']);
  assert.deepEqual(previews.knightAppearance.layers.map(({ slot,part }) => `${slot}-${part}`), ['spear-back','armor-back','boots-back','gloves-back','helmet-back','armor-front','boots-front','spear-front','gloves-front','helmet-front']);
});

test('battle appearance frame follows the current walk or knight action frame', async () => {
  const { getKnightEquipmentFrame } = await import('../src/game/ui/knightAnimations.js');
  assert.equal(getKnightEquipmentFrame({ visualAction:null, walkFrame:3, spriteFrameName:'2' }), 3);
  assert.equal(getKnightEquipmentFrame({ visualAction:'hit', walkFrame:1, spriteFrameName:'4' }), 8);
  assert.equal(getKnightEquipmentFrame({ visualAction:'defeat', walkFrame:0, spriteFrameName:'not-a-frame' }), null);
});

test('equipment preload and validation require all 60 twelve-frame gear sheets', () => {
  const sheetLoads = [];
  const imageLoads = [];
  const scene = {
    load:{
      spritesheet(key, path, options) { sheetLoads.push({key,path,options}); },
      image(key,path) { imageLoads.push({key,path}); },
      json() {},
    },
  };
  preloadEquipmentAppearanceAssets(scene.load);
  assert.equal(sheetLoads.filter(({ key }) => key.startsWith('gear-')).length, EQUIPMENT_APPEARANCE_ASSETS.length);
  assert.deepEqual(imageLoads, []);

  const frameNames = Array.from({ length:12 }, (_, index) => String(index));
  const textures = new Map(EQUIPMENT_APPEARANCE_ASSETS.map(({key}) => [key, {
      getFrameNames:() => frameNames,
      has:(frame) => frameNames.includes(frame),
  }]));
  const textureManager = { exists:(key) => textures.has(key), get:(key) => textures.get(key) };
  assert.equal(hasValidEquipmentAppearanceAssets(textureManager), true);
  textures.get(EQUIPMENT_APPEARANCE_ASSETS[0].key).has = (frame) => frame !== '11';
  assert.equal(hasValidEquipmentAppearanceAssets(textureManager), false);
  textures.get(EQUIPMENT_APPEARANCE_ASSETS[0].key).has = (frame) => frameNames.includes(frame);
  textures.delete(EQUIPMENT_APPEARANCE_ASSETS[1].key);
  assert.equal(hasValidEquipmentAppearanceAssets(textureManager), false);
});

test('BattleScene and PvpScene use gear-only player views with hidden base pose drivers', () => {
  const battle = readFileSync(new URL('../src/game/scenes/BattleScene.js', import.meta.url), 'utf8');
  const pvp = readFileSync(new URL('../src/game/scenes/PvpScene.js', import.meta.url), 'utf8');
  assert.ok(battle.includes("new WholeBodyWalk(this, view, 'knight', { renderBase:false })"));
  assert.ok(pvp.includes("new WholeBodyWalk(this, container, 'knight', { renderBase:false })"));
  const playAnimation = battle.slice(battle.indexOf('playKnightAnimation(name)'), battle.indexOf('syncPlayerEquipmentAppearance()'));
  assert.ok(!playAnimation.includes('sprite.setVisible(true)'));
});
