import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPvpAppearanceTextureKeys,
  getPvpFacingDirections,
  validatePvpEquipmentSnapshot,
} from '../../src/game/ui/pvpCharacterAppearance.js';
import { EQUIPMENT_SLOTS } from '../../src/game/ui/equipmentAppearanceAssets.js';

function equipment(overrides = {}) {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [
    slot,
    overrides[slot] ? { slot, ...overrides[slot] } : null,
  ]));
}

test('PvP appearance maps each fighter only from their own ticket equipment snapshot', () => {
  const player = equipment({
    helmet:{ rarity:'rare', id:'player-helmet' },
    horse:{ rarity:'common', id:'player-horse' },
  });
  const opponent = equipment({
    helmet:{ rarity:'legendary', id:'opponent-helmet' },
    horse:{ rarity:'rare', id:'opponent-horse' },
  });
  const before = structuredClone({ player, opponent });

  validatePvpEquipmentSnapshot(player);
  validatePvpEquipmentSnapshot(opponent);
  const playerKeys = getPvpAppearanceTextureKeys(player);
  const opponentKeys = getPvpAppearanceTextureKeys(opponent);

  assert.equal(playerKeys.helmet, 'gear-helmet-rare');
  assert.equal(playerKeys.horse, 'gear-horse-common');
  assert.equal(opponentKeys.helmet, 'gear-helmet-legendary');
  assert.equal(opponentKeys.horse, 'gear-horse-rare');
  assert.notEqual(playerKeys.helmet, opponentKeys.helmet);
  assert.notEqual(playerKeys.horse, opponentKeys.horse);
  assert.deepEqual({ player, opponent }, before);
});

test('PvP rejects incomplete or malformed equipment before it can render a fighter', () => {
  const missingSlot = equipment();
  delete missingSlot.spear;
  const unknownRarity = equipment({ helmet:{ rarity:'mythic' } });
  const mismatchedSlot = equipment({ horse:{ rarity:'rare' } });
  mismatchedSlot.horse.slot = 'armor';

  assert.throws(() => validatePvpEquipmentSnapshot(null), TypeError);
  assert.throws(() => validatePvpEquipmentSnapshot(missingSlot), TypeError);
  assert.throws(() => validatePvpEquipmentSnapshot(unknownRarity), RangeError);
  assert.throws(() => validatePvpEquipmentSnapshot(mismatchedSlot), TypeError);
  assert.throws(() => validatePvpEquipmentSnapshot([]), TypeError);
});

test('PvP fighter facing points toward the opponent and changes after they cross', () => {
  assert.deepEqual(getPvpFacingDirections(120, 700), { player:1, opponent:-1 });
  assert.deepEqual(getPvpFacingDirections(800, 700), { player:-1, opponent:1 });
  assert.deepEqual(getPvpFacingDirections(700, 700), { player:1, opponent:-1 });
});
