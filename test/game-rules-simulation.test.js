import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gameRulesDirectory = path.join(root, 'packages', 'game-rules');

async function loadRules() {
  try {
    const [balance, combat, simulation] = await Promise.all([
      import('../packages/game-rules/src/balance.js'),
      import('../packages/game-rules/src/combat.js'),
      import('../packages/game-rules/src/simulation.js'),
    ]);
    const random = await import('../packages/game-rules/src/seededRandom.js');
    return { ...balance, ...combat, ...simulation, ...random };
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      assert.fail(`Expected the shared game-rules module to load: ${error.message}`);
    }
    throw error;
  }
}

const player = (overrides = {}) => ({
  maxHp: 10000,
  currentHp: 10000,
  attack: 1000,
  defense: 1000,
  critChance: 0,
  critMultiplier: 2,
  moveSpeed: 200,
  effects: [],
  level: 1,
  xp: 0,
  xpToNext: 100,
  pendingLevelUps: 0,
  availableStatPoints: 0,
  spentStatPoints: 0,
  replayXpMultiplier: 1,
  ...overrides,
});

const stageTicket = (overrides = {}) => ({
  runId: 'golden-stage-1',
  seed: 123456789,
  chapter: 1,
  stage: 1,
  simulatorVersion: 2,
  balanceVersion: 2,
  issuedAtUtc: '2026-10-21T00:00:00.000Z',
  ...overrides,
});

test('the root npm project registers the shared game-rules workspace', () => {
  const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(rootPackage.workspaces?.includes('packages/game-rules'));
  assert.ok(existsSync(path.join(gameRulesDirectory, 'package.json')));
});

test('the game-rules package exposes versioned balance and combat contracts', async () => {
  const rules = await loadRules();
  const oldBalance = await import('../src/game/data/balance.js');
  const oldCombat = await import('../src/game/domain/combat.js');
  const oldProgression = await import('../src/game/domain/progression.js');

  assert.equal(oldBalance.BALANCE, rules.BALANCE);
  assert.equal(oldBalance.getGearUpgradeBand, rules.getGearUpgradeBand);
  assert.equal(oldProgression.getStageEnemyStats, rules.getStageEnemyStats);
  assert.deepEqual(rules.BALANCE.basePlayer, {
    maxHp: 200,
    attack: 10,
    defense: 5,
    critChance: 0.05,
    critMultiplier: 2,
    moveSpeed: 200,
  });
  assert.deepEqual(rules.BALANCE.normalEnemyCount, { min: 4, max: 10 });
  assert.deepEqual(rules.BALANCE.goldRewards, { normalEnemy: 11, boss: 55, stageClear: 175 });
  assert.equal(rules.BALANCE.knockbackPixels, 96);
  assert.deepEqual(rules.GEAR_SLOT, oldBalance.GEAR_SLOT);
  assert.deepEqual(rules.RARITY, oldBalance.RARITY);
  const combatInput = {
    playerStats: { attack: 100, defense: 5, critChance: 0, currentHp: 100, maxHp: 100 },
    enemyStats: { attack: 12, defense: 10, currentHp: 60, maxHp: 60 },
  };
  assert.deepEqual(rules.resolveContact(combatInput), oldCombat.resolveContact(combatInput));
  assert.deepEqual(rules.getStageEnemyStats(2, 5, true), {
    maxHp: 143,
    hp: 143,
    currentHp: 143,
    attack: 26,
    defense: 12,
    isBoss: true,
  });
});

test('the seeded generator is repeatable and rejects invalid seeds', async () => {
  const { createSeededRandom, rollCritical } = await loadRules();
  const first = createSeededRandom(123456789);
  const second = createSeededRandom(123456789);
  const values = Array.from({ length: 8 }, () => first());

  assert.deepEqual(values, Array.from({ length: 8 }, () => second()));
  assert.ok(values.every((value) => value >= 0 && value < 1));
  assert.throws(() => createSeededRandom(0), RangeError);
  assert.throws(() => createSeededRandom(4294967296), RangeError);
  const criticalStats = { critChance: 0.5 };
  assert.equal(rollCritical(criticalStats, createSeededRandom(1)), true);
  assert.equal(rollCritical(criticalStats, createSeededRandom(123456789)), false);
  assert.equal(rollCritical(criticalStats, createSeededRandom(123456789)), false);
});

test('ranked enemy counts use one ticket-seeded draw and preserve the following contact stream', async () => {
  const { createRankedRun, createSeededRandom, stepRankedRun } = await loadRules();
  const seenCounts = new Set();

  for (const seed of [1, 2304, 4608, 6912, 9216, 11392, 13824]) {
    const ticket = stageTicket({ seed });
    const first = createRankedRun(ticket, player());
    const second = createRankedRun(ticket, player());
    const enemyCount = first.enemies.filter((enemy) => !enemy.isBoss).length;
    const expectedCount = 4 + Math.floor(createSeededRandom(seed)() * 7);
    let expectedRandomState = seed >>> 0;
    expectedRandomState ^= expectedRandomState << 13;
    expectedRandomState ^= expectedRandomState >>> 17;
    expectedRandomState ^= expectedRandomState << 5;
    expectedRandomState >>>= 0;

    assert.equal(enemyCount, expectedCount);
    assert.ok(enemyCount >= 4 && enemyCount <= 10);
    assert.equal(first.randomState, expectedRandomState);
    assert.deepEqual(first.enemies, second.enemies);
    assert.deepEqual(first, second);
    seenCounts.add(enemyCount);

    const runToFirstContact = (initial) => {
      let state = initial;
      const contacts = [];
      for (let tick = 0; tick < 220 && contacts.length === 0; tick += 1) {
        const result = stepRankedRun(state, tick === 0 ? [{ tick, kind: 'move', value: 1 }] : []);
        state = result.state;
        contacts.push(...result.events.filter((event) => event.type === 'contact'));
      }
      return { state, contacts };
    };
    assert.deepEqual(runToFirstContact(first), runToFirstContact(second));
  }

  assert.deepEqual([...seenCounts].sort((left, right) => left - right), [4, 5, 6, 7, 8, 9, 10]);
});

test('ranked simulation accepts only the current simulator and balance versions', async () => {
  const { createRankedRun } = await loadRules();

  assert.doesNotThrow(() => createRankedRun(stageTicket(), player()));
  assert.throws(() => createRankedRun(stageTicket({ simulatorVersion: 1 }), player()), /unsupported simulatorVersion/i);
  assert.throws(() => createRankedRun(stageTicket({ balanceVersion: 1 }), player()), /unsupported balanceVersion/i);
});

test('the simulator advances fixed 60 Hz ticks and keeps the last movement direction', async () => {
  const { createRankedRun, stepRankedRun } = await loadRules();
  const initial = createRankedRun(stageTicket(), player());
  const moved = stepRankedRun(initial, [{ tick: 0, kind: 'move', value: 1 }]).state;
  const continued = stepRankedRun(moved, []).state;

  assert.ok(Math.abs(moved.player.x - (120 + 200 / 60)) < 1e-9);
  assert.ok(Math.abs(continued.player.x - (120 + (200 / 60) * 2)) < 1e-9);
});

test('a stage replay produces the same clear result for the same ticket and input log', async () => {
  const { replayRankedRun } = await loadRules();
  const inputs = [{ tick: 0, kind: 'move', value: 1 }];
  const first = replayRankedRun(stageTicket(), player(), inputs);
  const second = replayRankedRun(stageTicket(), player(), inputs);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    valid: true,
    outcome: 'clear',
    elapsedTicks: 2351,
    playerHp: 10000,
    rejectReason: null,
  });
});

test('stage replays reject reversed ticks, duplicate movement and invalid level-up inputs', async () => {
  const { replayRankedRun } = await loadRules();
  const reversed = replayRankedRun(stageTicket(), player(), [
    { tick: 2, kind: 'move', value: 1 },
    { tick: 1, kind: 'move', value: 0 },
  ]);
  const duplicateMove = replayRankedRun(stageTicket(), player(), [
    { tick: 0, kind: 'move', value: 1 },
    { tick: 0, kind: 'move', value: -1 },
  ]);
  const unavailableLevelUp = replayRankedRun(stageTicket(), player(), [
    { tick: 0, kind: 'levelUp', value: ['attack'] },
  ]);
  const invalidLevelUpStat = replayRankedRun(stageTicket(), player(), [
    { tick: 0, kind: 'levelUp', value: ['invalid'] },
  ]);
  const nonArrayLevelUp = replayRankedRun(stageTicket(), player(), [
    { tick: 0, kind: 'levelUp', value: 'attack' },
  ]);
  const invalidSeed = replayRankedRun(stageTicket({ seed: 0 }), player(), []);

  for (const result of [reversed, duplicateMove, unavailableLevelUp, invalidLevelUpStat, nonArrayLevelUp, invalidSeed]) {
    assert.equal(result.valid, false);
    assert.equal(result.outcome, 'invalid');
    assert.ok(result.rejectReason);
  }
});

test('body contact applies mutual damage once, knocks back, and allows a later re-contact', async () => {
  const { createRankedRun, stepRankedRun } = await loadRules();
  let state = createRankedRun(stageTicket(), player({ attack: 10, defense: 12 }));
  const contacts = [];

  for (let tick = 0; tick < 220; tick += 1) {
    const result = stepRankedRun(state, tick === 0 ? [{ tick, kind: 'move', value: 1 }] : []);
    state = result.state;
    contacts.push(...result.events.filter((event) => event.type === 'contact'));
    if (contacts.length === 2) break;
  }

  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].targetId, 'enemy-1');
  assert.equal(contacts[1].targetId, 'enemy-1');
  assert.equal(contacts[0].playerDamage, 12);
  assert.equal(contacts[0].enemyDamage, 6);
  assert.ok(state.player.x < 700);
  assert.equal(state.player.currentHp, 9976);
});

test('a boss stage spawns its fixed boss after the ticket-selected normal enemy count', async () => {
  const { createRankedRun, stepRankedRun } = await loadRules();
  let state = createRankedRun(stageTicket({ stage: 5 }), player());
  const expectedNormalCount = state.enemies.filter((enemy) => !enemy.isBoss).length;
  let bossEvent;

  for (let tick = 0; tick < 3200 && !bossEvent; tick += 1) {
    const result = stepRankedRun(state, tick === 0 ? [{ tick, kind: 'move', value: 1 }] : []);
    state = result.state;
    bossEvent = result.events.find((event) => event.type === 'bossSpawned');
  }

  assert.ok(bossEvent);
  assert.equal(bossEvent.x, 10500);
  assert.equal(state.normalDefeated, expectedNormalCount);
  assert.equal(state.enemies.filter((enemy) => !enemy.isBoss).length, expectedNormalCount);
  assert.equal(state.enemies.at(-1).id, 'boss');
  assert.equal(state.enemies.at(-1).maxHp, 81);
});

test('a pending level-up is applied before a seed-selected boss encounter', async () => {
  const { createRankedRun, replayRankedRun, stepRankedRun } = await loadRules();
  const ticket = stageTicket({ stage: 5 });
  const snapshot = player({ xp: 95 });
  let state = createRankedRun(ticket, snapshot);
  const inputs = [];

  while (!state.outcome && state.tick < 10000) {
    const tickInputs = [];
    if (state.tick === 0) tickInputs.push({ tick: state.tick, kind: 'move', value: 1 });
    if (state.player.pendingLevelUps > 0) tickInputs.push({ tick: state.tick, kind: 'levelUp', value: ['attack'] });
    inputs.push(...tickInputs);
    state = stepRankedRun(state, tickInputs).state;
  }
  const result = replayRankedRun(ticket, snapshot, inputs);

  assert.equal(result.valid, true);
  assert.equal(result.outcome, 'clear');
  assert.equal(state.player.spentStatPoints, 1);
});

test('ranked stage replay starts from saved XP and applies replay XP before level-up inputs', async () => {
  const { createRankedRun, replayRankedRun, stepRankedRun } = await loadRules();
  const ticket = stageTicket();
  const snapshot = player({
    level: 2,
    xp: 18,
    xpToNext: 20,
    pendingLevelUps: 0,
    replayXpMultiplier: 0.3,
  });
  let state = createRankedRun(ticket, snapshot);
  const inputs = [];
  let selectedAtTick = null;
  while (!state.outcome && state.tick < 10000) {
    const tickInputs = [];
    if (state.tick === 0) tickInputs.push({ tick: state.tick, kind: 'move', value: 1 });
    if (state.player.pendingLevelUps > 0) {
      selectedAtTick = state.tick;
      tickInputs.push({ tick: state.tick, kind: 'levelUp', value: ['attack'] });
    }
    inputs.push(...tickInputs);
    state = stepRankedRun(state, tickInputs).state;
  }
  const replay = replayRankedRun(ticket, snapshot, inputs);

  assert.ok(Number.isInteger(selectedAtTick));
  assert.equal(replay.valid, true);
  assert.equal(replay.outcome, 'clear');
  assert.equal(state.player.level, 3);
  assert.equal(state.player.xp, 22);
  assert.equal(state.player.spentStatPoints, 1);
});

test('level-up replay applies an allocation array and awards unspent points deterministically', async () => {
  const { createRankedRun, stepRankedRun, replayRankedRun } = await loadRules();
  const snapshot = player({ pendingLevelUps: 1, availableStatPoints: 2 });
  const ticket = stageTicket();
  const initial = createRankedRun(ticket, snapshot);
  const selected = stepRankedRun(initial, [{ tick: 0, kind: 'levelUp', value: ['attack', 'attack'] }]).state;
  const held = stepRankedRun(initial, [{ tick: 0, kind: 'levelUp', value: [] }]).state;
  const incomplete = replayRankedRun(ticket, snapshot, []);

  assert.equal(selected.player.attack, initial.player.attack + 10);
  assert.equal(selected.player.availableStatPoints, 2);
  assert.equal(selected.player.spentStatPoints, 2);
  assert.equal(selected.player.pendingLevelUps, 0);
  assert.equal(held.player.availableStatPoints, 4);
  assert.equal(held.player.spentStatPoints, 0);
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.outcome, 'incomplete');
  assert.equal(incomplete.rejectReason, 'level-up-selection-required');
});

test('ranked snapshots require valid stat-point counters and allocation arrays have a two-key limit', async () => {
  const { createRankedRun, stepRankedRun, replayRankedRun } = await loadRules();
  const snapshot = player({ pendingLevelUps: 1 });
  assert.throws(() => createRankedRun(stageTicket(), { ...snapshot, availableStatPoints: undefined }), RangeError);

  const sparse = [];
  sparse.length = 1;
  for (const value of ['attack', ['attack', 'defense', 'maxHp'], ['speed'], sparse]) {
    const result = replayRankedRun(stageTicket(), snapshot, [{ tick: 0, kind: 'levelUp', value }]);
    assert.equal(result.valid, false);
    assert.equal(result.rejectReason, 'invalid-level-up-allocation');
  }
  assert.throws(() => stepRankedRun(createRankedRun(stageTicket(), snapshot), [
    { tick: 0, kind: 'levelUp', value: ['attack', 'defense', 'maxHp'] },
  ]), /invalid-level-up-allocation/);
});

test('stage inputs cannot claim a clear before all enemies are defeated', async () => {
  const { replayRankedRun } = await loadRules();
  const result = replayRankedRun(stageTicket(), player(), [{ tick: 0, kind: 'move', value: 0 }]);
  assert.equal(result.outcome, 'incomplete');
  assert.notEqual(result.outcome, 'clear');
});

test('a replay records death at the first lethal body contact', async () => {
  const { replayRankedRun } = await loadRules();
  const result = replayRankedRun(stageTicket(), player({ maxHp: 1, currentHp: 1, defense: 0 }), [
    { tick: 0, kind: 'move', value: 1 },
  ]);

  assert.equal(result.valid, true);
  assert.equal(result.outcome, 'death');
  assert.equal(result.playerHp, 0);
});

test('a mutual final-normal kill records the kill before death without clearing the stage', async () => {
  const { createRankedRun, stepRankedRun } = await loadRules();
  const state = createRankedRun(stageTicket(), player({
    maxHp:1,
    currentHp:1,
    attack:100000,
    defense:0,
    moveSpeed:0,
  }));
  const normalEnemies = state.enemies.filter((enemy) => !enemy.isBoss);
  const finalEnemy = normalEnemies.at(-1);
  state.enemies = state.enemies.map((enemy) => ({ ...enemy, active:enemy.id === finalEnemy.id }));
  state.normalDefeated = normalEnemies.length - 1;
  state.player.x = finalEnemy.x;

  const result = stepRankedRun(state, []);
  const eventTypes = result.events.map((event) => event.type);

  assert.equal(result.state.outcome, 'death');
  assert.equal(result.state.normalDefeated, normalEnemies.length);
  assert.ok(eventTypes.indexOf('enemyDefeated') < eventTypes.indexOf('playerDeath'));
  assert.equal(eventTypes.includes('stageClear'), false);
});

test('a mutual boss kill records the boss defeat before death without clearing the stage', async () => {
  const { createRankedRun, stepRankedRun } = await loadRules();
  const state = createRankedRun(stageTicket({ stage:5 }), player({
    maxHp:10000,
    currentHp:10000,
    attack:100000,
    defense:100000,
    moveSpeed:0,
  }));
  const normalEnemies = state.enemies.filter((enemy) => !enemy.isBoss);
  const finalEnemy = normalEnemies.at(-1);
  state.enemies = state.enemies.map((enemy) => ({ ...enemy, active:enemy.id === finalEnemy.id }));
  state.normalDefeated = normalEnemies.length - 1;
  state.player.x = finalEnemy.x;
  const normalKill = stepRankedRun(state, []);
  const boss = normalKill.state.enemies.find((enemy) => enemy.isBoss);
  assert.ok(boss);

  normalKill.state.player = {
    ...normalKill.state.player,
    currentHp:1,
    defense:0,
    x:boss.x,
  };
  const result = stepRankedRun(normalKill.state, []);
  const eventTypes = result.events.map((event) => event.type);

  assert.equal(result.state.outcome, 'death');
  assert.ok(eventTypes.includes('enemyDefeated'));
  assert.ok(eventTypes.indexOf('enemyDefeated') < eventTypes.indexOf('playerDeath'));
  assert.equal(eventTypes.includes('stageClear'), false);
});

test('a PvP replay uses a fixed opponent and resolves a body-contact win', async () => {
  const { createPvpRun, replayPvpRun, stepPvpRun } = await loadRules();
  const ticket = {
    matchId: 'golden-pvp-1',
    seed: 987654321,
    simulatorVersion: 1,
    issuedAtUtc: '2026-10-21T00:00:00.000Z',
    timeLimitMs: 60000,
  };
  const opponent = player({
    maxHp: 60,
    currentHp: 60,
    attack: 1,
    defense: 0,
    moveSpeed: 0,
  });
  const result = replayPvpRun(ticket, player(), opponent, [
    { tick: 0, kind: 'move', value: 1 },
  ]);
  let state = createPvpRun(ticket, player(), opponent);
  const inputs = [{ tick: 0, kind: 'move', value: 1 }];
  while (!state.outcome) state = stepPvpRun(state, state.tick === 0 ? [inputs[0]] : []).state;
  const steppedReplay = replayPvpRun(ticket, player(), opponent, inputs);

  assert.equal(result.valid, true);
  assert.equal(result.outcome, 'win');
  assert.equal(result.opponentHp, 0);
  assert.ok(result.elapsedTicks > 0 && result.elapsedTicks < 3600);
  assert.deepEqual(steppedReplay, result);
  assert.equal(state.tick, result.elapsedTicks);
});

test('a PvP timeout compares exact remaining HP percentages and permits a draw', async () => {
  const { replayPvpRun } = await loadRules();
  const ticket = {
    matchId: 'golden-pvp-timeout',
    seed: 1,
    simulatorVersion: 1,
    issuedAtUtc: '2026-10-21T00:00:00.000Z',
    timeLimitMs: 60000,
  };
  const still = player({ maxHp: 100, currentHp: 50, attack: 0, defense: 100, moveSpeed: 0 });
  const opponent = player({ maxHp: 200, currentHp: 160, attack: 0, defense: 100, moveSpeed: 0 });
  const loss = replayPvpRun(ticket, still, opponent, []);
  const draw = replayPvpRun(ticket, still, player({ maxHp: 200, currentHp: 100, attack: 0, defense: 100, moveSpeed: 0 }), []);

  assert.equal(loss.elapsedTicks, 3600);
  assert.equal(loss.playerHpPercent, 0.5);
  assert.equal(loss.opponentHpPercent, 0.8);
  assert.equal(loss.outcome, 'loss');
  assert.equal(draw.outcome, 'draw');
});

test('the replay modules do not depend on Phaser, DOM, wall clock or ambient randomness', async () => {
  const sourceFiles = [
    'balance.js',
    'combat.js',
    'seededRandom.js',
    'simulation.js',
  ];
  const forbidden = /\b(?:Phaser|window|Date\.now|Math\.random)\b/;

  for (const file of sourceFiles) {
    const filePath = path.join(gameRulesDirectory, 'src', file);
    assert.ok(existsSync(filePath), `${file} must exist in the shared game-rules package`);
    const source = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(source, forbidden, `${file} must be deterministic and runtime-independent`);
  }
});
