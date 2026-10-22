import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE, getGearUpgradeBand, getStageEnemyStats } from '../packages/game-rules/src/balance.js';
import { resolveContact } from '../packages/game-rules/src/combat.js';

const STAT_KEYS = ['attack', 'defense', 'maxHp'];
const LEVEL_BANDS = [
  { min: 0.01, max: 0.05, failureChance: 0, destructionChance: 0 },
  { min: 0.02, max: 0.06, failureChance: 0.05, destructionChance: 0.01 },
  { min: 0.03, max: 0.07, failureChance: 0.15, destructionChance: 0.03 },
  { min: 0.04, max: 0.08, failureChance: 0.3, destructionChance: 0.06 },
  { min: 0.05, max: 0.09, failureChance: 0.5, destructionChance: 0.1 },
  { min: 0.06, max: 0.1, failureChance: 0.7, destructionChance: 0.15 },
];

function sampleSeed(sample) {
  return Math.imul(sample + 1, 0x9e3779b9) >>> 0;
}

function nextRandom(randomState) {
  let state = randomState >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return { state, value: state / 0x100000000 };
}

test('fixed calibration seeds cover the initial 10% critical-hit band', () => {
  let criticalSeeds = 0;
  for (let sample = 0; sample < 1024; sample += 1) {
    if (nextRandom(sampleSeed(sample)).value < 0.1) criticalSeeds += 1;
  }
  assert.ok(criticalSeeds >= 80 && criticalSeeds <= 130, 'critical seed count: ' + criticalSeeds);
});

function makeAverageStarterPlayer(level = 1, hpRatio = 1) {
  const stats = { ...BALANCE.basePlayer };
  for (const template of Object.values(BALANCE.equipmentTemplates)) {
    for (const [key, value] of Object.entries(template)) {
      if (key === 'moveSpeedPercent') stats.moveSpeed *= 1 + value;
      else stats[key] += value;
    }
  }
  for (let point = 0; point < 2 * (level - 1); point += 1) {
    const key = STAT_KEYS[point % STAT_KEYS.length];
    stats[key] += BALANCE.levelUp[key];
  }
  stats.critChance = Math.min(BALANCE.critChanceCap, stats.critChance);
  stats.maxHp = Math.ceil(stats.maxHp);
  stats.attack = Math.ceil(stats.attack);
  stats.defense = Math.ceil(stats.defense);
  stats.currentHp = Math.ceil(stats.maxHp * hpRatio);
  return stats;
}

function fightEnemy(player, enemyInput, randomState) {
  let enemyHp = enemyInput.maxHp;
  let currentHp = player.currentHp;
  let contacts = 0;
  while (enemyHp > 0 && currentHp > 0 && contacts < 1000) {
    const random = nextRandom(randomState);
    randomState = random.state;
    const result = resolveContact({
      playerStats: { ...player, currentHp },
      enemyStats: { ...enemyInput, currentHp: enemyHp },
      rng: () => random.value,
    });
    enemyHp = result.enemyHp;
    currentHp = result.playerHp;
    contacts += 1;
  }
  return { currentHp, enemyHp, contacts, randomState };
}

function meanEnemyContacts(chapter, stage, isBoss = false, sampleCount = 128) {
  const values = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const seed = sampleSeed(sample);
    const player = makeAverageStarterPlayer(1);
    player.currentHp = 1_000_000;
    player.maxHp = 1_000_000;
    values.push(fightEnemy(player, getStageEnemyStats(chapter, stage, isBoss), seed).contacts);
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function meanStageEndHp(chapter, stage, playerLevel, startRatio, includeBoss, sampleCount = 1024) {
  let totalRatio = 0;
  let completedRuns = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const seed = sampleSeed(sample);
    const player = makeAverageStarterPlayer(playerLevel, startRatio);
    let randomState = seed;
    let defeatedNormals = 0;
    for (let enemy = 0; enemy < 7 && player.currentHp > 0; enemy += 1) {
      const result = fightEnemy(player, getStageEnemyStats(chapter, stage), randomState);
      player.currentHp = result.currentHp;
      randomState = result.randomState;
      if (result.enemyHp <= 0) defeatedNormals += 1;
    }
    let defeatedBoss = !includeBoss;
    if (includeBoss && player.currentHp > 0) {
      const result = fightEnemy(player, getStageEnemyStats(chapter, stage, true), randomState);
      player.currentHp = result.currentHp;
      defeatedBoss = result.enemyHp <= 0;
    }
    if (defeatedNormals === 7 && defeatedBoss && player.currentHp > 0) completedRuns += 1;
    totalRatio += player.currentHp / player.maxHp;
  }
  return { remainingRatio: totalRatio / sampleCount, completedRuns };
}

test('enhancement bands have the confirmed rates and non-overlapping boundaries', () => {
  for (const [index, expected] of LEVEL_BANDS.entries()) {
    for (let level = index * 5 + 1; level <= index * 5 + 5; level += 1) {
      assert.deepEqual(getGearUpgradeBand(level), expected);
    }
  }
  assert.throws(() => getGearUpgradeBand(0), RangeError);
  assert.throws(() => getGearUpgradeBand(31), RangeError);
  assert.equal(BALANCE.levelUp.attack, 5);
  assert.equal(BALANCE.levelUp.defense, 10);
  assert.equal(BALANCE.levelUp.maxHp, 30);
  assert.equal(BALANCE.gearUpgrade.greatSuccessChance, 0.05);
  assert.equal(BALANCE.gearMaxLevel, 30);
  assert.deepEqual(BALANCE.gearRarityMultipliers, {
    common: 1,
    uncommon: 1.5,
    rare: 2,
    unique: 3,
    legendary: 5,
  });
  assert.deepEqual(BALANCE.gearRollRange, { min: 0.75, max: 1.25 });
  assert.deepEqual(BALANCE.gearUpgrade.specialIncrease, {
    critChance: { min: 0.001, max: 0.01 },
    critMultiplier: { min: 0.01, max: 0.1 },
    moveSpeedPercent: { min: 0.01, max: 0.05 },
    bonusDamage: { min: 0.01, max: 0.05 },
    damageReduction: { min: 0.001, max: 0.01 },
    lifeSteal: { min: 0.001, max: 0.01 },
    thorns: { min: 0.01, max: 0.03 },
  });
  assert.equal(BALANCE.critChanceCap, 1);
});

test('deterministic average build meets the first-stage survival target', () => {
  const contacts = meanEnemyContacts(1, 1);
  const result = meanStageEndHp(1, 1, 1, 1, false);
  assert.equal(result.completedRuns, 1024, 'all first-stage samples must defeat seven normals');
  assert.ok(contacts >= 2 && contacts <= 3, 'C1S1 normal: ' + contacts);
  const detail = 'expected 30–50% HP, got ' + (result.remainingRatio * 100).toFixed(2) + '%';
  assert.ok(result.remainingRatio >= 0.3 && result.remainingRatio <= 0.5, detail);
});

test('deterministic average build meets the contact-count progression targets', () => {
  const c1s5Normal = meanEnemyContacts(1, 5);
  const c1s5Boss = meanEnemyContacts(1, 5, true);
  const c1s10 = meanEnemyContacts(1, 10);
  const c2s1 = meanEnemyContacts(2, 1);
  const c2s10 = meanEnemyContacts(2, 10);
  const c3s1 = meanEnemyContacts(3, 1);

  assert.ok(c1s5Normal >= 2 && c1s5Normal <= 4, 'C1S5 normal: ' + c1s5Normal);
  assert.ok(c1s5Boss >= 6 && c1s5Boss <= 9, 'C1S5 boss: ' + c1s5Boss);
  assert.ok(c1s5Boss / c1s5Normal >= 1.75 && c1s5Boss / c1s5Normal <= 2.25);
  assert.ok(c1s10 >= 4 && c1s10 <= 5, 'C1S10 normal: ' + c1s10);
  assert.ok(c2s1 >= 5 && c2s1 <= 6, 'C2S1 normal: ' + c2s1);
  assert.ok(c2s10 >= 7 && c2s10 <= 8, 'C2S10 normal: ' + c2s10);
  assert.ok(c3s1 > c2s10, 'C3S1 ' + c3s1 + ' must exceed C2S10 ' + c2s10);
});

test('stage enemy stat calculation rejects invalid and non-finite inputs', () => {
  assert.throws(() => getStageEnemyStats(0, 1), RangeError);
  assert.throws(() => getStageEnemyStats(1, 0), RangeError);
  assert.throws(() => getStageEnemyStats(1, 11), RangeError);
  assert.throws(() => getStageEnemyStats(5e306, 1, true), RangeError);
});

test('C1S10 ends below 10% HP after the average normal group and boss', () => {
  const result = meanStageEndHp(1, 10, 1, 0.5, true);
  assert.equal(result.completedRuns, 1024, 'all C1S10 samples must defeat seven normals and the boss');
  const detail = 'expected below 10% HP, got ' + (result.remainingRatio * 100).toFixed(2) + '%';
  assert.ok(result.remainingRatio < 0.1, detail);
});
