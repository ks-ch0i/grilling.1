import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import {
  BACKGROUND_ASSETS,
  BATTLE_BACKGROUND_THEMES,
  getBattleBackgroundAssetKeys,
} from '../src/game/ui/sceneBackgroundAssets.js';

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function inspectRgbaPng(buffer) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
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
  const raw = inflateSync(Buffer.concat(chunks));
  let previous = Buffer.alloc(stride);
  let hasTransparentPixel = false;
  let allPixelsOpaque = true;
  let horizontalEdgesMatch = true;
  let transparentTopPixels = 0;
  const topBandHeight = Math.floor(height * 0.4);
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
      if (alpha !== 255) allPixelsOpaque = false;
      if (y < topBandHeight && alpha < 16) transparentTopPixels++;
    }
    if (!row.subarray(0, 4).equals(row.subarray(stride - 4, stride))) horizontalEdgesMatch = false;
    previous = row;
  }
  return {
    width,
    height,
    hasTransparentPixel,
    allPixelsOpaque,
    horizontalEdgesMatch,
    transparentTopFraction: transparentTopPixels / (width * topBandHeight),
  };
}

test('background manifest covers the approved themes, stable keys, and all 17 files', () => {
  const themes = ['forest-trail', 'ruined-village', 'rocky-canyon', 'snowy-fortress', 'volcanic-citadel'];
  assert.deepEqual(BATTLE_BACKGROUND_THEMES, themes);
  assert.equal(Object.isFrozen(BATTLE_BACKGROUND_THEMES), true);
  assert.equal(Object.isFrozen(BACKGROUND_ASSETS), true);
  assert.equal(Object.isFrozen(BACKGROUND_ASSETS.battle), true);
  assert.equal(Object.keys(BACKGROUND_ASSETS.battle).length, 5);

  const assets = [];
  for (const theme of themes) {
    const layers = BACKGROUND_ASSETS.battle[theme];
    assert.deepEqual(Object.keys(layers), ['far', 'mid', 'front']);
    assert.equal(Object.isFrozen(layers), true);
    for (const layer of ['far', 'mid', 'front']) {
      const asset = layers[layer];
      assert.deepEqual(asset, {
        key: `background-${theme}-${layer}`,
        path: `/assets/backgrounds/battle/${theme}-${layer}.png`,
      });
      assets.push(asset);
    }
  }
  for (const [scene, file] of [['town', 'town-frontier-square'], ['pvp', 'pvp-stone-arena']]) {
    assert.deepEqual(BACKGROUND_ASSETS[scene], {
      key: `background-${file}`,
      path: `/assets/backgrounds/${file}.png`,
    });
    assets.push(BACKGROUND_ASSETS[scene]);
  }

  const keys = assets.map(({ key }) => key);
  assert.equal(new Set(keys).size, 17, 'background keys must be unique');
  assert.equal(assets.length, 17);
  for (const { path } of assets) {
    assert.doesNotThrow(() => readFileSync(new URL(`../public${path}`, import.meta.url)), path);
  }
});

test('battle panorama and tile files have their logical dimensions and alpha contracts', () => {
  for (const theme of BATTLE_BACKGROUND_THEMES) {
    const assets = BACKGROUND_ASSETS.battle[theme];
    const far = inspectRgbaPng(readFileSync(new URL(`../public${assets.far.path}`, import.meta.url)));
    assert.equal(far.width, 4800, `${theme} far width`);
    assert.equal(far.height, 560, `${theme} far height`);
    assert.equal(far.allPixelsOpaque, true, `${theme} far must be opaque`);

    for (const layer of ['mid', 'front']) {
      const tile = inspectRgbaPng(readFileSync(new URL(`../public${assets[layer].path}`, import.meta.url)));
      assert.equal(tile.width, 1280, `${theme} ${layer} width`);
      assert.equal(tile.height, 560, `${theme} ${layer} height`);
      assert.equal(tile.hasTransparentPixel, true, `${theme} ${layer} needs transparent cutouts`);
      assert.ok(tile.transparentTopFraction > 0.5, `${theme} ${layer} needs a transparent upper region`);
      assert.equal(tile.horizontalEdgesMatch, true, `${theme} ${layer} tile edges need matching pixels`);
    }
  }
});

test('static town and PvP backgrounds are opaque 1280x720 scenes', () => {
  for (const scene of ['town', 'pvp']) {
    const asset = BACKGROUND_ASSETS[scene];
    const png = inspectRgbaPng(readFileSync(new URL(`../public${asset.path}`, import.meta.url)));
    assert.equal(png.width, 1280, `${scene} width`);
    assert.equal(png.height, 720, `${scene} height`);
    assert.equal(png.allPixelsOpaque, true, `${scene} background must be opaque`);
  }
});

test('battle theme keys reject unknown themes without fallback', () => {
  assert.deepEqual(getBattleBackgroundAssetKeys('forest-trail'), {
    far: 'background-forest-trail-far',
    mid: 'background-forest-trail-mid',
    front: 'background-forest-trail-front',
  });
  assert.throws(() => getBattleBackgroundAssetKeys('unknown-theme'), RangeError);
});
