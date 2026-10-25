import { NORMAL_ENEMY_TYPES } from '../data/balance.js';

export const ENEMY_FRAME_SIZE = 256;

export const ENEMY_SPRITE_SHEETS = Object.freeze({
  goblin: Object.freeze({ key:'enemy-goblin', path:'/assets/walk/goblin-actions.png' }),
  boar: Object.freeze({ key:'enemy-boar', path:'/assets/walk/boar-actions.png' }),
  brute: Object.freeze({ key:'enemy-brute', path:'/assets/walk/brute-actions.png' }),
  warlord: Object.freeze({ key:'enemy-warlord', path:'/assets/walk/warlord-actions.png' }),
});

export const ENEMY_ANIMATIONS = Object.freeze({
  hit: Object.freeze({ start:0, end:1, frameRate:8, repeat:0 }),
  defeat: Object.freeze({ start:2, end:3, frameRate:5, repeat:0 }),
});

export function selectStageEnemyType(isBoss, zeroBasedIndex = 0) {
  if (isBoss) return 'warlord';
  return NORMAL_ENEMY_TYPES[zeroBasedIndex % NORMAL_ENEMY_TYPES.length];
}

export function enemyAnimationKey(type, action) {
  const spriteSheet = ENEMY_SPRITE_SHEETS[type];
  if (!spriteSheet || !ENEMY_ANIMATIONS[action]) return null;
  return `${spriteSheet.key}-${action}`;
}
