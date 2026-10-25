import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KNIGHT_ANIMATIONS, selectKnightAnimation, selectKnightFacing } from '../src/game/ui/knightAnimations.js';

test('knight animation rows cover exactly frames 0 through 19 without overlap', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(KNIGHT_ANIMATIONS).map(([name, { start, end }]) => [name, [start, end]])), {
    idle:[0, 3],
    run:[4, 7],
    contact:[8, 11],
    hit:[12, 15],
    defeat:[16, 19],
  });
  const frames = Object.values(KNIGHT_ANIMATIONS).flatMap(({ start, end }) => {
    assert.ok(start <= end);
    return Array.from({ length:end - start + 1 }, (_, index) => start + index);
  });

  assert.equal(new Set(frames).size, 20);
  assert.deepEqual(frames.sort((left, right) => left - right), Array.from({ length:20 }, (_, index) => index));
});

test('generated knight PNG has the exact transparent 4x5 frame-sheet dimensions', () => {
  const png = readFileSync(new URL('../public/assets/knight/knight-actions.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 800);
  assert.equal(png[24], 8);
  assert.equal(png[25], 6, 'RGBA PNG preserves alpha transparency');
});

test('knight animation priority is defeat, hit, contact, run, then idle', () => {
  assert.equal(selectKnightAnimation({ moving:true, action:'defeat' }), 'defeat');
  assert.equal(selectKnightAnimation({ moving:true, action:'hit' }), 'hit');
  assert.equal(selectKnightAnimation({ moving:true, action:'contact' }), 'contact');
  assert.equal(selectKnightAnimation({ moving:true }), 'run');
  assert.equal(selectKnightAnimation({ moving:false }), 'idle');
});

test('knight facing changes on left/right movement and persists while idle', () => {
  assert.equal(selectKnightFacing(-1, 1), -1);
  assert.equal(selectKnightFacing(0, -1), -1);
  assert.equal(selectKnightFacing(1, -1), 1);
  assert.equal(selectKnightFacing(0, 1), 1);
});
