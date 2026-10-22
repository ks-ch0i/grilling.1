import assert from 'node:assert/strict';
import test from 'node:test';
import { BALANCE } from '../../packages/game-rules/src/balance.js';
import { createInitialState } from '../../src/game/domain/stateFactory.js';
import {
  LEGACY_SAVE_KEY,
  SAVE_KEY,
  isValidGameState,
  loadGameState,
  readSavedGame,
  saveGameState,
} from '../../src/game/domain/saveStore.js';

function createStorage(seed = {}, failWrites = false) {
  const entries = new Map(Object.entries(seed));
  return {
    entries,
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('quota exceeded');
      entries.set(key, String(value));
    },
    removeItem: (key) => entries.delete(key),
  };
}

function legacyState() {
  let nextId = 0;
  const state = createInitialState(() => `old-${nextId++}`);
  state.equipment.armor.stats.maxHp = 20;
  state.schemaVersion = 1;
  delete state.gold;
  state.player.baseStats = {
    maxHp: 100,
    attack: 10,
    defense: 5,
    critChance: 0.05,
    critMultiplier: 2,
    moveSpeed: 200,
  };
  state.player.currentHp = 60;
  delete state.player.availableStatPoints;
  delete state.player.spentStatPoints;
  delete state.player.statResetCount;
  return state;
}

test('new state and canonical saves use only the v2 schema', () => {
  let nextId = 0;
  const state = createInitialState(() => `new-${nextId++}`);
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.gold, 0);
  assert.equal(state.player.availableStatPoints, 0);
  assert.equal(state.player.spentStatPoints, 0);
  assert.equal(state.player.statResetCount, 0);
  assert.deepEqual(state.player.baseStats, BALANCE.basePlayer);
  assert.equal(isValidGameState(state), true);

  state.debugOnly = true;
  const storage = createStorage();
  assert.deepEqual(saveGameState(state, storage), { ok: true });
  const saved = JSON.parse(storage.getItem(SAVE_KEY));
  assert.equal(saved.schemaVersion, 2);
  assert.equal(Object.hasOwn(saved, 'debugOnly'), false);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), null);
  assert.equal(readSavedGame(storage).schemaVersion, 2);
});

test('load migrates a valid v1 source, writes v2, and preserves the legacy bytes', () => {
  const legacyRaw = JSON.stringify(legacyState());
  const storage = createStorage({ [LEGACY_SAVE_KEY]: legacyRaw });
  let nextId = 0;
  const fallback = createInitialState(() => `fallback-${nextId++}`);
  const loaded = loadGameState(fallback, storage);

  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.player.currentHp, 110);
  assert.equal(loaded.player.availableStatPoints, 0);
  assert.equal(loaded.gold, 0);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(JSON.parse(storage.getItem(SAVE_KEY)).schemaVersion, 2);
});

test('failed v2 storage writes keep the migrated state in memory and retain v1 bytes', () => {
  const legacyRaw = JSON.stringify(legacyState());
  const storage = createStorage({ [LEGACY_SAVE_KEY]: legacyRaw }, true);
  const loaded = loadGameState(createInitialState(), storage);

  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.gold, 0);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test('a legacy fallback does not overwrite an invalid existing v2 value', () => {
  const legacyRaw = JSON.stringify(legacyState());
  const brokenCurrent = '{invalid v2 cache';
  const storage = createStorage({ [SAVE_KEY]: brokenCurrent, [LEGACY_SAVE_KEY]: legacyRaw });
  const loaded = loadGameState(createInitialState(), storage);

  assert.equal(loaded.schemaVersion, 2);
  assert.equal(storage.getItem(SAVE_KEY), brokenCurrent);
  assert.equal(storage.getItem(LEGACY_SAVE_KEY), legacyRaw);
});

test('v1 and malformed states are rejected by v2 persistence and v2 reads', () => {
  const storage = createStorage({ [SAVE_KEY]: JSON.stringify({ schemaVersion: 2, player: {} }) });
  assert.equal(readSavedGame(storage), null);
  assert.equal(isValidGameState(legacyState()), false);
  assert.deepEqual(saveGameState(legacyState(), createStorage()), { ok: false, error: 'invalid-state' });
});
