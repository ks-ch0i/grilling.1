export const KNIGHT_ANIMATIONS = Object.freeze({
  idle: Object.freeze({ start:0, end:3, frameRate:4, repeat:-1 }),
  run: Object.freeze({ start:4, end:7, frameRate:10, repeat:-1 }),
  contact: Object.freeze({ start:8, end:11, frameRate:12, repeat:0 }),
  hit: Object.freeze({ start:12, end:15, frameRate:10, repeat:0 }),
  defeat: Object.freeze({ start:16, end:19, frameRate:8, repeat:0 }),
});

export function selectKnightAnimation({ moving, action = null } = {}) {
  if (action === 'defeat') return 'defeat';
  if (action === 'hit') return 'hit';
  if (action === 'contact') return 'contact';
  return moving ? 'run' : 'idle';
}

export function selectKnightFacing(direction, previousDirection = 1) {
  if (direction === -1 || direction === 1) return direction;
  return previousDirection === -1 ? -1 : 1;
}
