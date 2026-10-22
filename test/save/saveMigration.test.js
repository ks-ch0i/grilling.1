import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE, RARITY } from '../../packages/game-rules/src/balance.js';
import { migrateGameState, validateGameStateV2 } from '../../packages/game-rules/src/saveMigration.js';
import { createInitialState } from '../../src/game/domain/stateFactory.js';

const legacyBaseStats = {
  maxHp: 100,
  attack: 10,
  defense: 5,
  critChance: 0.05,
  critMultiplier: 2,
  moveSpeed: 200,
};

const rarityMultipliers = {
  common: 1,
  uncommon: 1.5,
  rare: 2,
  unique: 3,
  legendary: 5,
};

const expectedBands = [
  { minLevel: 1, maxLevel: 5, min: 0.01, max: 0.05 },
  { minLevel: 6, maxLevel: 10, min: 0.02, max: 0.06 },
  { minLevel: 11, maxLevel: 15, min: 0.03, max: 0.07 },
  { minLevel: 16, maxLevel: 20, min: 0.04, max: 0.08 },
  { minLevel: 21, maxLevel: 25, min: 0.05, max: 0.09 },
  { minLevel: 26, maxLevel: 30, min: 0.06, max: 0.1 },
];

function legacyState({ level = 1, currentHp = 60 } = {}) {
  let nextId = 0;
  const state = createInitialState(() => `legacy-${nextId++}`);
  state.equipment.armor.stats.maxHp = 20;
  state.schemaVersion = 1;
  delete state.gold;
  state.player.baseStats = { ...legacyBaseStats };
  state.player.level = level;
  state.player.xp = 25;
  state.player.xpToNext = 100;
  state.player.pendingLevelUps = 2;
  state.player.currentHp = currentHp;
  delete state.player.availableStatPoints;
  delete state.player.spentStatPoints;
  delete state.player.statResetCount;
  state.materials = 37;
  state.progression = {
    chapter: 2,
    currentStage: 7,
    unlockedChapter: 3,
    unlockedStage: 2,
    clearedStageIds: ['1-1', '1-2', '2-6'],
  };
  return state;
}

function upgradeRate(level) {
  const band = expectedBands.find(({ maxLevel }) => level <= maxLevel);
  return (band.min + band.max) / 2;
}

function expectedAttack(rarity, level) {
  let value = 8 * rarityMultipliers[rarity];
  for (let currentLevel = 1; currentLevel < level; currentLevel += 1) {
    value = Math.ceil(value * (1 + upgradeRate(currentLevel)));
  }
  return value;
}

test('migrates a level-one save, resets stats, and preserves zero or fractional HP ratio', () => {
  const fractional = legacyState({ currentHp: 30.5 });
  const original = structuredClone(fractional);
  const migrated = migrateGameState(fractional);

  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.player.baseStats, BALANCE.basePlayer);
  assert.equal(migrated.player.availableStatPoints, 0);
  assert.equal(migrated.player.spentStatPoints, 0);
  assert.equal(migrated.player.statResetCount, 0);
  assert.equal(migrated.gold, 0);
  assert.equal(migrated.player.currentHp, 56);
  assert.equal(migrated.player.pendingLevelUps, 2);
  assert.deepEqual(migrated.progression, original.progression);
  assert.equal(migrated.materials, original.materials);
  assert.deepEqual(fractional, original, 'migration must not mutate its input');

  const dead = migrateGameState(legacyState({ currentHp: 0 }));
  assert.equal(dead.player.currentHp, 0);
});

test('migrates all rarity and enhancement endpoints from current templates', () => {
  const state = legacyState({ level: 30 });
  for (const rarity of Object.values(RARITY)) {
    for (const level of [1, 30]) {
      state.inventory.push({
        id: `old-${rarity}-${level}`,
        slot: 'spear',
        rarity,
        level,
        stats: { attack: 99 },
        effects: rarity === RARITY.UNIQUE || rarity === RARITY.LEGENDARY
          ? [{ id: 'bonusDamage', value: BALANCE.effectValues.bonusDamage[rarity] }]
          : [],
      });
    }
  }
  state.inventory.push({
    id: 'old-unique-gloves-30',
    slot: 'gloves',
    rarity: RARITY.UNIQUE,
    level: 30,
    stats: { critChance: 0.99, critMultiplier: 0.2 },
    effects: [
      { id: 'bonusDamage', value: 9 },
      { id: 'lifeSteal', value: 9 },
    ],
  });

  const migrated = migrateGameState(state);
  const migratedItems = new Map(migrated.inventory.map((item) => [item.id, item]));
  for (const rarity of Object.values(RARITY)) {
    for (const level of [1, 30]) {
      const item = migratedItems.get(`old-${rarity}-${level}`);
      assert.equal(item.level, level);
      assert.equal(item.rarity, rarity);
      assert.deepEqual(item.stats, { attack: expectedAttack(rarity, level) });
      assert.deepEqual(item.effects.map(({ id }) => id), rarity === RARITY.UNIQUE || rarity === RARITY.LEGENDARY ? ['bonusDamage'] : []);
    }
  }

  const gloves = migratedItems.get('old-unique-gloves-30');
  assert.deepEqual(Object.keys(gloves.stats).sort(), ['critChance', 'critMultiplier']);
  assert.equal(gloves.stats.critChance, 0.2495);
  assert.deepEqual(gloves.effects.map(({ id }) => id), ['bonusDamage', 'lifeSteal']);
  assert.equal(gloves.effects[0].value, 1.05);
  assert.equal(gloves.effects[1].value, 0.1895);
  assert.equal(migrated.player.availableStatPoints, 58);
  assert.equal(migrated.player.pendingLevelUps, 2, 'unconfirmed level-ups do not grant points');
});

test('v2 migration is idempotent, deep-cloned, and validates nested fields and unique gear ids', () => {
  const once = migrateGameState(legacyState());
  const twice = migrateGameState(once);
  assert.deepEqual(twice, once);
  assert.notEqual(twice, once);
  assert.notEqual(twice.equipment.helmet, once.equipment.helmet);
  assert.equal(validateGameStateV2(once), true);
  assert.equal(validateGameStateV2({ ...once, gold: -1 }), false);
  assert.equal(validateGameStateV2({ ...once, player: { ...once.player, availableStatPoints: -1 } }), false);
  assert.equal(validateGameStateV2({ ...once, player: { ...once.player, statResetCount: 1.2 } }), false);

  const duplicateId = structuredClone(once);
  duplicateId.inventory.push({ ...structuredClone(duplicateId.equipment.helmet), slot: 'helmet' });
  assert.equal(validateGameStateV2(duplicateId), false);
  assert.throws(() => migrateGameState({ ...legacyState(), schemaVersion: 3 }), TypeError);
});

test('rejects legacy saves with missing or invalid gear fields', () => {
  const missingEffects = legacyState();
  delete missingEffects.equipment.spear.effects;
  assert.throws(() => migrateGameState(missingEffects), TypeError);

  const invalidRarity = legacyState();
  invalidRarity.equipment.spear.rarity = 'artifact';
  assert.throws(() => migrateGameState(invalidRarity), TypeError);

  const invalidStat = legacyState();
  invalidStat.equipment.spear.stats.attack = Number.NaN;
  assert.throws(() => migrateGameState(invalidStat), TypeError);
});
