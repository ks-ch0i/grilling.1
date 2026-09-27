import { BALANCE } from '../data/balance.js';

const EFFECT_ORDER = Object.freeze(['bonusDamage', 'damageReduction', 'thorns', 'lifeSteal']);

function sumEffects(effects = [], id) {
  return effects.filter((effect) => effect.id === id).reduce((sum, effect) => sum + effect.value, 0);
}

export function applyGearEffects(effects = []) {
  const totals = Object.fromEntries(EFFECT_ORDER.map((id) => [id, sumEffects(effects, id)]));
  return Object.freeze(totals);
}

export function rollCritical(playerStats, rng = Math.random) {
  return rng() < Math.min(BALANCE.critChanceCap, Math.max(0, playerStats.critChance ?? 0));
}

function nonnegativeDamage(value) {
  return Math.max(0, Math.ceil(value));
}

export function resolveContact({ playerStats, enemyStats, playerEffects = [], rng = Math.random }) {
  if (!playerStats || !enemyStats || !Number.isFinite(playerStats.attack) || !Number.isFinite(enemyStats.attack)) {
    throw new TypeError('resolveContact requires numeric player and enemy attack stats.');
  }
  const critical = rollCritical(playerStats, rng);
  const effects = applyGearEffects(playerEffects);
  const baseAttack = playerStats.attack * (critical ? (playerStats.critMultiplier ?? 1) : 1);
  const playerAttack = baseAttack * (1 + effects.bonusDamage);
  const playerDefense = playerStats.defense ?? 0;
  const enemyDefense = enemyStats.defense ?? 0;
  const strikeEnemyDamage = nonnegativeDamage(playerAttack - enemyDefense);
  const playerRecoil = nonnegativeDamage(enemyDefense - playerAttack);
  const enemyStrikePlayerDamage = nonnegativeDamage(enemyStats.attack - playerDefense);
  const enemyRecoil = nonnegativeDamage(playerDefense - enemyStats.attack);

  const playerDamageBeforeReduction = playerRecoil + enemyStrikePlayerDamage;
  const reduction = Math.min(1, Math.max(0, effects.damageReduction));
  const playerDamageAfterReduction = nonnegativeDamage(playerDamageBeforeReduction * (1 - reduction));
  const thornsDamage = nonnegativeDamage(playerDamageAfterReduction * effects.thorns);
  const enemyDamageBeforeCap = strikeEnemyDamage + enemyRecoil + thornsDamage;
  const enemyHp = Math.max(0, enemyStats.currentHp ?? enemyStats.hp ?? enemyStats.maxHp ?? 0);
  const enemyDamage = Math.min(enemyHp, enemyDamageBeforeCap);
  const remainingEnemyHp = Math.max(0, enemyHp - enemyDamage);
  const enemyDefeated = remainingEnemyHp <= 0;
  const currentPlayerHp = Math.max(0, playerStats.currentHp ?? playerStats.maxHp ?? 0);
  const maxPlayerHp = playerStats.maxHp ?? currentPlayerHp;
  const playerDamage = Math.min(currentPlayerHp, playerDamageAfterReduction);
  const lifeStealHealing = Math.floor(Math.min(strikeEnemyDamage, Math.max(0, enemyHp)) * effects.lifeSteal);
  const remainingPlayerHp = Math.min(maxPlayerHp, Math.max(0, currentPlayerHp - playerDamage + lifeStealHealing));

  return {
    critical,
    playerAttack,
    enemyDamage,
    playerDamage,
    enemyDefeated,
    playerDefeated: remainingPlayerHp <= 0,
    enemyHp: remainingEnemyHp,
    playerHp: remainingPlayerHp,
    healing: remainingPlayerHp - Math.max(0, currentPlayerHp - playerDamage),
  };
}
