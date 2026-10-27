import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import {
  EQUIPMENT_APPEARANCE_ASSETS,
  EQUIPMENT_APPEARANCE_FRAMES,
  EQUIPMENT_RARITIES,
  EQUIPMENT_SLOTS,
  equipmentAppearanceTextureKey,
} from '../src/game/ui/equipmentAppearanceAssets.js';

const FRAME_SIZE = 256;
const ATLAS_WIDTH = FRAME_SIZE * 2;
const ATLAS_HEIGHT = FRAME_SIZE * 6;

function decodeRgbaPng(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let contentLeft;
  let contentTop;
  let contentRight;
  let contentBottom;
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8);
  assert.equal(colorType, 6);
  assert.equal(interlace, 0);

  const stride = width * 4;
  contentLeft = width;
  contentTop = height;
  contentRight = -1;
  contentBottom = -1;
  const raw = inflateSync(Buffer.concat(chunks));
  let previous = Buffer.alloc(stride);
  let paddingIsTransparent = true;
  let hasTransparentPixel = false;
  const frameBounds = Array.from({ length:12 }, () => ({ minX:256, minY:256, maxX:-1, maxY:-1 }));
  for (let y = 0, offset = 0; y < height; y++) {
    const filter = raw[offset++];
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0;
      const up = previous[i];
      const upLeft = i >= 4 ? previous[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported PNG filter ${filter}`);
      row[i] = (row[i] + predictor) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const alpha = row[x * 4 + 3];
      if (alpha < 255) hasTransparentPixel = true;
      if (alpha >= 32) {
        if (width === 512 && height === 1536) {
          const frame = Math.floor(y / 256) * 2 + Math.floor(x / 256);
          const box = frameBounds[frame];
          box.minX = Math.min(box.minX, x % 256); box.maxX = Math.max(box.maxX, x % 256);
          box.minY = Math.min(box.minY, y % 256); box.maxY = Math.max(box.maxY, y % 256);
        }
        contentLeft = Math.min(contentLeft, x);
        contentTop = Math.min(contentTop, y);
        contentRight = Math.max(contentRight, x);
        contentBottom = Math.max(contentBottom, y);
      }
      if (y >= FRAME_SIZE * 5 && x >= FRAME_SIZE && alpha !== 0) paddingIsTransparent = false;
    }
    previous = row;
  }
  return {
    width, height, hasTransparentPixel, paddingIsTransparent, frameBounds,
    contentBounds:contentRight < 0 ? null : {
      x:contentLeft, y:contentTop, width:contentRight-contentLeft+1, height:contentBottom-contentTop+1,
    },
  };
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

test('equipment appearance manifest covers every slot and rarity with stable atlas frames', () => {
  assert.deepEqual(EQUIPMENT_SLOTS, ['helmet', 'armor', 'gloves', 'boots', 'spear', 'horse']);
  assert.deepEqual(EQUIPMENT_RARITIES, ['common', 'uncommon', 'rare', 'unique', 'legendary']);
  assert.deepEqual(EQUIPMENT_APPEARANCE_FRAMES, {
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    frameCount: 12,
    walk: [0, 1, 2, 3],
    action: [4, 5, 6, 7, 8, 9],
    town: 10,
    padding: 11,
  });
  assert.equal(EQUIPMENT_APPEARANCE_ASSETS.length, 30);
  assert.equal(Object.isFrozen(EQUIPMENT_SLOTS), true);
  assert.equal(Object.isFrozen(EQUIPMENT_RARITIES), true);
  assert.equal(Object.isFrozen(EQUIPMENT_APPEARANCE_FRAMES), true);

  const expected = EQUIPMENT_SLOTS.flatMap((slot) => EQUIPMENT_RARITIES.map((rarity) => ({
    slot,
    rarity,
    key: `gear-${slot}-${rarity}`,
    path: `/assets/gear-aligned/${slot}-${rarity}.png`,
  })));
  assert.deepEqual(EQUIPMENT_APPEARANCE_ASSETS, expected);
  assert.equal(Object.isFrozen(EQUIPMENT_APPEARANCE_ASSETS), true);
});

test('equipment texture keys reject unsupported slot or rarity names', () => {
  assert.equal(equipmentAppearanceTextureKey('helmet', 'rare'), 'gear-helmet-rare');
  assert.throws(() => equipmentAppearanceTextureKey('cape', 'rare'), RangeError);
  assert.throws(() => equipmentAppearanceTextureKey('helmet', 'mythic'), RangeError);
});

test('all equipment atlases are RGBA 512x1536 PNGs with a transparent padding frame', () => {
  for (const asset of EQUIPMENT_APPEARANCE_ASSETS) {
    const png = readFileSync(new URL(`../public${asset.path}`, import.meta.url));
    const decoded = decodeRgbaPng(png);
    assert.equal(decoded.width, ATLAS_WIDTH, `${asset.path} width`);
    assert.equal(decoded.height, ATLAS_HEIGHT, `${asset.path} height`);
    assert.equal(decoded.hasTransparentPixel, true, `${asset.path} alpha`);
    assert.equal(decoded.paddingIsTransparent, true, `${asset.path} padding frame`);
    for (let frame=0; frame<11; frame++) assert.ok(decoded.frameBounds[frame].maxX >= 0, `${asset.path} frame ${frame}`);
    if (asset.rarity === 'common') {
      const bounds=decoded.frameBounds[0];
      const width=bounds.maxX-bounds.minX+1;
      const height=bounds.maxY-bounds.minY+1;
      const minimum={
        helmet:[60,60],
        armor:[80,100],
        gloves:[30,50],
        boots:[45,70],
        spear:[100,12],
        horse:[150,100],
      }[asset.slot];
      assert.ok(width >= minimum[0] && height >= minimum[1], `${asset.path} must contain its complete slot silhouette: ${width}x${height}`);
    }
    const walk=decoded.frameBounds[0];
    const centerY=(walk.minY+walk.maxY)/2;
    const expectedY={helmet:[50,90],armor:[135,165],gloves:[95,150],boots:[185,225],spear:[120,155],horse:[125,195]}[asset.slot];
    assert.ok(centerY >= expectedY[0] && centerY <= expectedY[1], `${asset.path} walk body alignment: ${centerY}`);
  }
});

test('the standing knight preview base is a transparent 256x256 RGBA PNG', () => {
  const png = readFileSync(new URL('../public/assets/gear/knight-standing.png', import.meta.url));
  const decoded = decodeRgbaPng(png);
  assert.equal(decoded.width, FRAME_SIZE);
  assert.equal(decoded.height, FRAME_SIZE);
  assert.equal(decoded.hasTransparentPixel, true);
});

test('mounted rider underlay keeps transparent source dimensions for walk and action poses', () => {
  const rider = decodeRgbaPng(readFileSync(new URL('../public/assets/walk/knight-rider.png', import.meta.url)));
  assert.equal(rider.width, 1205);
  assert.equal(rider.height, 1305);
  assert.equal(rider.hasTransparentPixel, true);
  assert.deepEqual(rider.contentBounds, { x:573, y:233, width:437, height:989 });

  const actions = decodeRgbaPng(readFileSync(new URL('../public/assets/walk/knight-actions.png', import.meta.url)));
  assert.equal(actions.width, 512);
  assert.equal(actions.height, 768);
  assert.equal(actions.hasTransparentPixel, true);
});
