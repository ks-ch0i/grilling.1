import {
  EQUIPMENT_SLOTS,
  equipmentAppearanceTextureKey,
} from './equipmentAppearanceAssets.js';

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function validatePvpEquipmentSnapshot(equipment) {
  if (!isPlainRecord(equipment)) throw new TypeError('PvP equipment snapshot must be a plain record.');
  for (const slot of EQUIPMENT_SLOTS) {
    if (!Object.hasOwn(equipment, slot)) throw new TypeError(`PvP equipment snapshot is missing ${slot}.`);
    const item = equipment[slot];
    if (item === null) continue;
    if (!isPlainRecord(item) || item.slot !== slot) {
      throw new TypeError(`PvP ${slot} equipment has an invalid item record.`);
    }
    equipmentAppearanceTextureKey(slot, item.rarity);
  }
  return true;
}

export function getPvpAppearanceTextureKeys(equipment) {
  validatePvpEquipmentSnapshot(equipment);
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => {
    const item = equipment[slot];
    return [slot, item ? equipmentAppearanceTextureKey(slot, item.rarity) : null];
  }));
}

export function getPvpFacingDirections(playerX, opponentX) {
  if (!Number.isFinite(playerX) || !Number.isFinite(opponentX)) {
    throw new TypeError('PvP character positions must be finite numbers.');
  }
  return opponentX >= playerX
    ? { player:1, opponent:-1 }
    : { player:-1, opponent:1 };
}
