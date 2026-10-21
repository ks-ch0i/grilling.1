import {
  applyGearEffects,
  resolveContact as resolveDeterministicContact,
  rollCritical as rollDeterministicCritical,
} from '@knight-run/game-rules/combat';

export { applyGearEffects };

export function rollCritical(playerStats, rng = Math.random) {
  return rollDeterministicCritical(playerStats, rng);
}

export function resolveContact(options) {
  return resolveDeterministicContact({
    ...options,
    rng: options.rng ?? Math.random,
  });
}
