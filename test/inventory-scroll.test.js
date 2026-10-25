import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canSelectInventoryItem,
  clampInventoryScrollRow,
  getDragScrollRow,
  getMaxInventoryScrollRow,
  hasInventoryDragExceededThreshold,
} from '../src/game/ui/inventoryScroll.js';

test('inventory scroll maximum uses two columns and five visible rows', () => {
  assert.equal(getMaxInventoryScrollRow(0), 0);
  assert.equal(getMaxInventoryScrollRow(10), 0);
  assert.equal(getMaxInventoryScrollRow(11), 1);
  assert.equal(getMaxInventoryScrollRow(21), 6);
  assert.equal(getMaxInventoryScrollRow(22), 6);
  assert.equal(getMaxInventoryScrollRow(23), 7);
  assert.equal(getMaxInventoryScrollRow(24), 7);
  assert.equal(getMaxInventoryScrollRow(8, 4, 2), 0);
  assert.equal(getMaxInventoryScrollRow(13, 4, 2), 2);
});

test('inventory scroll rows clamp to the first and last available rows', () => {
  assert.equal(clampInventoryScrollRow(-4, 30), 0);
  assert.equal(clampInventoryScrollRow(99, 30), 10);
  assert.equal(clampInventoryScrollRow(3, 10), 0);
});

test('inventory drag converts vertical travel to rows and clamps at both ends', () => {
  assert.equal(getDragScrollRow(0, 500, 421, 30), 1);
  assert.equal(getDragScrollRow(3, 421, 500, 30), 2);
  assert.equal(getDragScrollRow(0, 190, 0, 30), 2);
  assert.equal(getDragScrollRow(9, 0, 1000, 30), 0);
  assert.equal(getDragScrollRow(0, 0, -1000, 30), 10);
});

test('invalid inventory counts, row settings, and drag measurements are rejected', () => {
  assert.throws(() => getMaxInventoryScrollRow(-1), RangeError);
  assert.throws(() => getMaxInventoryScrollRow(1.5), RangeError);
  assert.throws(() => getMaxInventoryScrollRow(10, 0), RangeError);
  assert.throws(() => getMaxInventoryScrollRow(10, 2, 0), RangeError);
  assert.throws(() => clampInventoryScrollRow(1.2, 10), RangeError);
  assert.throws(() => getDragScrollRow(0, 10, Number.NaN, 30), RangeError);
  assert.throws(() => getDragScrollRow(0, 10, 0, 30, 0), RangeError);
});

test('short taps remain selectable while a drag or different pointer cannot select', () => {
  const tap = { pointerId: 2, startY: 300, startRow: 0, moved: false };
  assert.equal(hasInventoryDragExceededThreshold(300, 308), false);
  assert.equal(hasInventoryDragExceededThreshold(300, 308.1), true);
  assert.equal(canSelectInventoryItem(tap, 2), true);
  assert.equal(canSelectInventoryItem(tap, 3), false);
  assert.equal(canSelectInventoryItem({ ...tap, moved: true }, 2), false);
  assert.equal(canSelectInventoryItem(null, 2), false);
});
