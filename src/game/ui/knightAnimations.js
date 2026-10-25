export const KNIGHT_FRAME_WIDTH = 256;
export const KNIGHT_FRAME_HEIGHT = 256;

export const KNIGHT_ANIMATIONS = Object.freeze({
  contact: Object.freeze({ start:0, end:1, frameRate:10, repeat:0 }),
  hit: Object.freeze({ start:2, end:3, frameRate:8, repeat:0 }),
  defeat: Object.freeze({ start:4, end:5, frameRate:5, repeat:0 }),
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
