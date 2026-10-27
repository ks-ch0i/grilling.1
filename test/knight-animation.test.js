import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { getKnightEquipmentFrame, KNIGHT_ANIMATIONS, selectKnightAnimation, selectKnightFacing } from '../src/game/ui/knightAnimations.js';

test('knight action animations use distinct valid frames in the action atlas', () => {
  const actionFrames = Object.values(KNIGHT_ANIMATIONS).flatMap(({ start, end }) => {
    assert.ok(start >= 0 && start <= end && end < 6);
    return Array.from({ length:end - start + 1 }, (_, index) => start + index);
  });
  assert.equal(new Set(actionFrames).size, actionFrames.length);
});

test('generated knight PNG has the exact transparent 2x3 action-sheet dimensions', () => {
  const png = readFileSync(new URL('../public/assets/walk/knight-actions.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 768);
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

test('equipment action layers map the six knight atlas frames after the four gait frames', () => {
  assert.equal(getKnightEquipmentFrame({ visualAction:null, walkFrame:0, spriteFrameName:'4' }), 0);
  assert.equal(getKnightEquipmentFrame({ visualAction:null, walkFrame:3, spriteFrameName:'4' }), 3);
  assert.equal(getKnightEquipmentFrame({ visualAction:'contact', walkFrame:1, spriteFrameName:'0' }), 4);
  assert.equal(getKnightEquipmentFrame({ visualAction:'hit', walkFrame:1, spriteFrameName:'5' }), 9);
  assert.equal(getKnightEquipmentFrame({ visualAction:'defeat', walkFrame:1, spriteFrameName:'6' }), null);
});
