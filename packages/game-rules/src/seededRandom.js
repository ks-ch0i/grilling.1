export function createSeededRandom(seed) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
    throw new RangeError('seed must be an integer from 1 to 4294967295.');
  }
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function deriveSeed(seed, streamName) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
    throw new RangeError('seed must be an integer from 1 to 4294967295.');
  }
  if (typeof streamName !== 'string' || streamName.length === 0) {
    throw new TypeError('streamName must be a non-empty string.');
  }
  let state = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < streamName.length; index += 1) {
    state ^= streamName.charCodeAt(index);
    state = Math.imul(state, 16777619) >>> 0;
  }
  return state || 0x9e3779b9;
}
