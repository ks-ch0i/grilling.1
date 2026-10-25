import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getInventoryTapItemId,
  removeInventoryInputHandlers,
} from '../src/game/ui/inventoryScroll.js';

const tap = {
  pointerId: 4,
  itemId: 'gear-1',
  left: 478,
  right: 670,
  top: 196,
  bottom: 270,
};

test('an inventory tap selects only the item pressed and released inside its card', () => {
  const drag = { pointerId: 4, startY: 220, startRow: 0, moved: false };
  assert.equal(getInventoryTapItemId(drag, tap, { id: 4, x: 520, y: 230 }, [{ id: 'gear-1' }]), 'gear-1');
  assert.equal(getInventoryTapItemId(drag, tap, { id: 4, x: 671, y: 230 }, [{ id: 'gear-1' }]), null);
  assert.equal(getInventoryTapItemId(drag, tap, { id: 4, x: 520, y: 230 }, []), null);
});

test('inventory drag, pointer mismatch, and missing press state cannot select an item', () => {
  assert.equal(getInventoryTapItemId(
    { pointerId: 4, startY: 220, startRow: 0, moved: true }, tap, { id: 4, x: 520, y: 230 }, [{ id: 'gear-1' }],
  ), null);
  assert.equal(getInventoryTapItemId(
    { pointerId: 4, startY: 220, startRow: 0, moved: false }, tap, { id: 5, x: 520, y: 230 }, [{ id: 'gear-1' }],
  ), null);
  assert.equal(getInventoryTapItemId(null, tap, { id: 4, x: 520, y: 230 }, [{ id: 'gear-1' }]), null);
});

test('inventory input cleanup removes each registered handler', () => {
  const removed = [];
  const handlers = Object.fromEntries(
    ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointerupoutside']
      .map((event) => [event, () => {}]),
  );
  removeInventoryInputHandlers({ off: (event, handler) => removed.push([event, handler]) }, handlers);

  assert.deepEqual(removed.map(([event]) => event), Object.keys(handlers));
});
