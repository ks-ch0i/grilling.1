export const EQUIPMENT_SLOTS = Object.freeze([
  'helmet',
  'armor',
  'gloves',
  'boots',
  'spear',
  'horse',
]);

export const EQUIPMENT_RARITIES = Object.freeze([
  'common',
  'uncommon',
  'rare',
  'unique',
  'legendary',
]);

export const EQUIPMENT_APPEARANCE_FRAMES = Object.freeze({
  frameWidth:256,
  frameHeight:256,
  frameCount:12,
  walk:Object.freeze([0, 1, 2, 3]),
  action:Object.freeze([4, 5, 6, 7, 8, 9]),
  town:10,
  padding:11,
});

export const EQUIPMENT_APPEARANCE_ASSETS = Object.freeze(
  EQUIPMENT_SLOTS.flatMap((slot) => EQUIPMENT_RARITIES.map((rarity) => Object.freeze({
    slot,
    rarity,
    key:`gear-${slot}-${rarity}`,
    path:`/assets/gear/${slot}-${rarity}.png`,
  }))),
);

export function equipmentAppearanceTextureKey(slot, rarity) {
  if (!EQUIPMENT_SLOTS.includes(slot)) throw new RangeError(`Unsupported equipment slot: ${slot}`);
  if (!EQUIPMENT_RARITIES.includes(rarity)) throw new RangeError(`Unsupported equipment rarity: ${rarity}`);
  return `gear-${slot}-${rarity}`;
}
