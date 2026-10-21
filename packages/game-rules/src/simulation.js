import { BALANCE, getStageEnemyStats } from './balance.js';
import { resolveContact } from './combat.js';

const TICKS_PER_SECOND = 60;
const WORLD_WIDTH = 11200;
const PLAYER_WIDTH = 64;
const NORMAL_ENEMY_WIDTH = 70;
const BOSS_WIDTH = NORMAL_ENEMY_WIDTH * 1.65;
const PLAYER_START_X = 120;
const PLAYER_MIN_X = 45;
const PLAYER_MAX_X = WORLD_WIDTH - 45;
const BOSS_X = 10500;
const PVP_OPPONENT_X = 700;
const PVP_PLAYER_WIDTH = 64;
const LEVEL_UP_KEYS = Object.freeze(['attack', 'defense', 'maxHp']);
const MAX_REPLAY_TICKS = 360000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function assertTicket(ticket) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('ticket must be an object.');
  if (typeof ticket.runId !== 'string' || !ticket.runId) throw new TypeError('runId must be a non-empty string.');
  if (!Number.isInteger(ticket.seed) || ticket.seed < 1 || ticket.seed > 0xffffffff) {
    throw new RangeError('seed must be an integer from 1 to 4294967295.');
  }
  if (!Number.isInteger(ticket.chapter) || ticket.chapter < 1) throw new RangeError('chapter must be a positive integer.');
  if (!Number.isInteger(ticket.stage) || ticket.stage < 1 || ticket.stage > 10) {
    throw new RangeError('stage must be an integer from 1 to 10.');
  }
  if (ticket.simulatorVersion !== 1) throw new RangeError('unsupported simulatorVersion.');
  if (!Number.isInteger(ticket.balanceVersion) || ticket.balanceVersion < 1) {
    throw new RangeError('balanceVersion must be a positive integer.');
  }
  if (typeof ticket.issuedAtUtc !== 'string' || !ticket.issuedAtUtc) throw new TypeError('issuedAtUtc must be a non-empty string.');
}

function assertCombatSnapshot(snapshot, name = 'player') {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError(`${name} snapshot must be an object.`);
  for (const key of ['maxHp', 'currentHp', 'attack', 'defense', 'critChance', 'critMultiplier', 'moveSpeed']) {
    if (!Number.isFinite(snapshot[key])) throw new TypeError(`${name}.${key} must be finite.`);
  }
  if (snapshot.maxHp <= 0 || snapshot.currentHp < 0 || snapshot.currentHp > snapshot.maxHp) {
    throw new RangeError(`${name} HP must satisfy 0 <= currentHp <= maxHp and maxHp > 0.`);
  }
  if (snapshot.attack < 0 || snapshot.defense < 0 || snapshot.moveSpeed < 0) {
    throw new RangeError(`${name} attack, defense and moveSpeed must be non-negative.`);
  }
  if (snapshot.critChance < 0 || snapshot.critMultiplier < 0) {
    throw new RangeError(`${name} critical stats must be non-negative.`);
  }
  if (!Array.isArray(snapshot.effects) || snapshot.effects.some((effect) =>
    !effect || typeof effect.id !== 'string' || !Number.isFinite(effect.value))) {
    throw new TypeError(`${name}.effects must contain effect id/value pairs.`);
  }
}

function createEnemy(id, x, isBoss, chapter, stage) {
  const stats = getStageEnemyStats(chapter, stage, isBoss);
  return {
    id,
    x,
    width: isBoss ? BOSS_WIDTH : NORMAL_ENEMY_WIDTH,
    maxHp: stats.maxHp,
    currentHp: stats.maxHp,
    attack: stats.attack,
    defense: stats.defense,
    isBoss,
    active: true,
  };
}

export function createRankedRun(ticket, playerSnapshot) {
  assertTicket(ticket);
  assertCombatSnapshot(playerSnapshot);
  const enemies = Array.from({ length: BALANCE.normalEnemyCount }, (_, index) =>
    createEnemy(`enemy-${index + 1}`, 700 + index * 950, false, ticket.chapter, ticket.stage));
  return {
    mode: 'stage',
    ticket: { ...ticket },
    tick: 0,
    elapsedTicks: 0,
    randomState: ticket.seed >>> 0,
    player: {
      ...playerSnapshot,
      effects: playerSnapshot.effects.map((effect) => ({ ...effect })),
      x: PLAYER_START_X,
      level: 1,
      xp: 0,
      xpToNext: 100,
      pendingLevelUps: 0,
    },
    enemies,
    contactPairs: [],
    normalDefeated: 0,
    hasBoss: ticket.stage % 5 === 0,
    bossSpawned: false,
    outcome: null,
    rejectReason: null,
    movementDirection: 0,
  };
}

function nextRandom(randomState) {
  let state = randomState >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  state >>>= 0;
  return { state, value: state / 0x100000000 };
}

function xpRequiredForLevel(targetLevel) {
  let cost = 100;
  for (let level = 3; level <= targetLevel; level += 1) {
    const multiplier = level % 10 === 0 ? 2 : level % 5 === 0 ? 1.5 : 1.2;
    cost = Math.ceil(cost * multiplier);
  }
  return cost;
}

function grantRunXp(player, amount) {
  let xp = player.xp + amount;
  let pendingLevelUps = player.pendingLevelUps;
  let virtualTargetLevel = player.level + pendingLevelUps + 1;
  let threshold = pendingLevelUps === 0 ? player.xpToNext : xpRequiredForLevel(virtualTargetLevel);
  while (xp >= threshold) {
    xp -= threshold;
    pendingLevelUps += 1;
    virtualTargetLevel += 1;
    threshold = xpRequiredForLevel(virtualTargetLevel);
  }
  return { ...player, xp, pendingLevelUps };
}

function applyLevelUp(player, statKey) {
  if (!LEVEL_UP_KEYS.includes(statKey)) throw new RangeError('invalid-level-up-stat.');
  if (player.pendingLevelUps < 1) throw new RangeError('level-up-without-pending-selection.');
  const gain = BALANCE.levelUp[statKey];
  const next = { ...player, pendingLevelUps: player.pendingLevelUps - 1, level: player.level + 1 };
  if (statKey === 'maxHp') {
    next.maxHp += gain;
    next.currentHp = Math.min(next.maxHp, next.currentHp + gain);
  } else {
    next[statKey] += gain;
  }
  return next;
}

function validateTickInputs(inputForTick, tick) {
  if (!Array.isArray(inputForTick)) throw new TypeError('inputForTick must be an array of input events.');
  let moveCount = 0;
  for (const event of inputForTick) {
    if (!event || event.tick !== tick) throw new RangeError('input event tick must match the current simulation tick.');
    if (event.kind === 'move') {
      if (![-1, 0, 1].includes(event.value)) throw new RangeError('move value must be -1, 0 or 1.');
      moveCount += 1;
      if (moveCount > 1) throw new RangeError('duplicate-move-event.');
    } else if (event.kind === 'levelUp') {
      if (!LEVEL_UP_KEYS.includes(event.value)) throw new RangeError('invalid-level-up-stat.');
    } else {
      throw new RangeError('invalid-input-event-kind.');
    }
  }
}

function updatePlayerAfterContact(player, result) {
  return { ...player, currentHp: result.playerHp };
}

function applyStageContact(state, enemies, contactPairs, player, events, randomState) {
  const pairs = new Set(contactPairs);
  let normalDefeated = state.normalDefeated;
  let bossSpawned = state.bossSpawned;
  let outcome = state.outcome;
  let rejectReason = state.rejectReason;
  let updatedPlayer = player;
  let updatedRandomState = randomState;

  for (const enemy of enemies) {
    if (!enemy.active) {
      pairs.delete(enemy.id);
      continue;
    }
    const overlapping = Math.abs(updatedPlayer.x - enemy.x) <= (PLAYER_WIDTH + enemy.width) / 2;
    if (!overlapping) {
      pairs.delete(enemy.id);
      continue;
    }
    if (pairs.has(enemy.id)) continue;
    pairs.add(enemy.id);
    const random = nextRandom(updatedRandomState);
    updatedRandomState = random.state;
    const result = resolveContact({
      playerStats: { ...updatedPlayer, currentHp: updatedPlayer.currentHp },
      enemyStats: enemy,
      playerEffects: updatedPlayer.effects,
      rng: () => random.value,
    });
    enemy.currentHp = result.enemyHp;
    updatedPlayer = updatePlayerAfterContact(updatedPlayer, result);
    events.push({
      type: 'contact',
      tick: state.tick,
      targetId: enemy.id,
      critical: result.critical,
      playerDamage: result.playerDamage,
      enemyDamage: result.enemyDamage,
      playerHp: result.playerHp,
      enemyHp: result.enemyHp,
    });
    if (updatedPlayer.currentHp <= 0) {
      outcome = 'death';
      events.push({ type: 'playerDeath', tick: state.tick });
      break;
    }
    if (result.enemyDefeated) {
      enemy.active = false;
      events.push({ type: 'enemyDefeated', tick: state.tick, targetId: enemy.id });
      if (enemy.isBoss) {
        outcome = 'clear';
        events.push({ type: 'stageClear', tick: state.tick });
      } else {
        normalDefeated += 1;
        updatedPlayer = grantRunXp(updatedPlayer, BALANCE.xpRewards.normalEnemy);
        if (normalDefeated >= BALANCE.normalEnemyCount) {
          if (state.hasBoss) {
            if (!bossSpawned) {
              enemies.push(createEnemy('boss', BOSS_X, true, state.ticket.chapter, state.ticket.stage));
              bossSpawned = true;
              events.push({ type: 'bossSpawned', tick: state.tick, x: BOSS_X });
            }
          } else {
            outcome = 'clear';
            events.push({ type: 'stageClear', tick: state.tick });
          }
        }
      }
    }
    const directionAway = updatedPlayer.x <= enemy.x ? -1 : 1;
    updatedPlayer.x = clamp(
      updatedPlayer.x + directionAway * BALANCE.knockbackPixels,
      PLAYER_MIN_X,
      PLAYER_MAX_X,
    );
    if (outcome) break;
  }

  return {
    player: updatedPlayer,
    enemies,
    contactPairs: [...pairs],
    normalDefeated,
    bossSpawned,
    randomState: updatedRandomState,
    outcome,
    rejectReason,
  };
}

export function stepRankedRun(state, inputForTick = []) {
  if (!state || state.mode !== 'stage') throw new TypeError('state must be a ranked stage run.');
  if (state.outcome) throw new RangeError('cannot advance a completed run.');
  validateTickInputs(inputForTick, state.tick);
  const next = {
    ...state,
    player: { ...state.player, effects: state.player.effects.map((effect) => ({ ...effect })) },
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    contactPairs: [...state.contactPairs],
    elapsedTicks: state.tick + 1,
  };
  const events = [];
  for (const event of inputForTick) {
    if (event.kind === 'move') next.movementDirection = event.value;
    else {
      next.player = applyLevelUp(next.player, event.value);
      events.push({ type: 'levelUp', tick: state.tick, stat: event.value, level: next.player.level });
    }
  }
  next.player.x = clamp(
    next.player.x + next.movementDirection * next.player.moveSpeed / TICKS_PER_SECOND,
    PLAYER_MIN_X,
    PLAYER_MAX_X,
  );
  const contacts = applyStageContact(
    next,
    next.enemies,
    next.contactPairs,
    next.player,
    events,
    next.randomState,
  );
  Object.assign(next, contacts);
  next.tick = state.tick + 1;
  next.elapsedTicks = next.tick;
  return { state: next, events };
}

function validateInputLog(inputs) {
  if (!Array.isArray(inputs)) return 'input-log-must-be-an-array';
  let previousTick = -1;
  let previousTickMoveCount = 0;
  for (const event of inputs) {
    if (!event || !Number.isInteger(event.tick) || event.tick < 0) return 'invalid-input-tick';
    if (event.tick < previousTick) return 'input-ticks-out-of-order';
    if (event.tick !== previousTick) previousTickMoveCount = 0;
    if (event.kind === 'move') {
      if (![-1, 0, 1].includes(event.value)) return 'invalid-move-value';
      previousTickMoveCount += 1;
      if (previousTickMoveCount > 1) return 'duplicate-move-event';
    } else if (event.kind === 'levelUp') {
      if (!LEVEL_UP_KEYS.includes(event.value)) return 'invalid-level-up-stat';
    } else {
      return 'invalid-input-event-kind';
    }
    previousTick = event.tick;
  }
  return null;
}

function invalidStageResult(reason, playerSnapshot, elapsedTicks = 0) {
  return {
    valid: false,
    outcome: 'invalid',
    elapsedTicks,
    playerHp: Number.isFinite(playerSnapshot?.currentHp) ? playerSnapshot.currentHp : 0,
    rejectReason: reason,
  };
}

function stageResult(state) {
  return {
    valid: state.outcome === 'clear' || state.outcome === 'death',
    outcome: state.outcome,
    elapsedTicks: state.elapsedTicks,
    playerHp: state.player.currentHp,
    rejectReason: state.rejectReason,
  };
}

function canContinueStage(state) {
  if (state.player.pendingLevelUps > 0) return false;
  const direction = state.movementDirection;
  for (const enemy of state.enemies) {
    if (!enemy.active) continue;
    const halfWidth = (PLAYER_WIDTH + enemy.width) / 2;
    const isReachableAhead = direction > 0
      ? enemy.x >= state.player.x - halfWidth
      : direction < 0
        ? enemy.x <= state.player.x + halfWidth
        : Math.abs(state.player.x - enemy.x) <= halfWidth && !state.contactPairs.includes(enemy.id);
    if (isReachableAhead) return true;
  }
  return false;
}

export function replayRankedRun(ticket, playerSnapshot, inputs) {
  const inputError = validateInputLog(inputs);
  if (inputError) return invalidStageResult(inputError, playerSnapshot);
  let state;
  try {
    state = createRankedRun(ticket, playerSnapshot);
  } catch (error) {
    return invalidStageResult(error.message, playerSnapshot);
  }
  let inputIndex = 0;
  while (!state.outcome && state.tick < MAX_REPLAY_TICKS) {
    const tickInputs = [];
    while (inputIndex < inputs.length && inputs[inputIndex].tick === state.tick) {
      tickInputs.push(inputs[inputIndex]);
      inputIndex += 1;
    }
    if (state.player.pendingLevelUps > 0 && !tickInputs.some((event) => event.kind === 'levelUp')) {
      return {
        valid: false,
        outcome: 'incomplete',
        elapsedTicks: state.elapsedTicks,
        playerHp: state.player.currentHp,
        rejectReason: 'level-up-selection-required',
      };
    }
    if (inputIndex < inputs.length && inputs[inputIndex].tick < state.tick) {
      return invalidStageResult('input-tick-already-passed', playerSnapshot, state.elapsedTicks);
    }
    try {
      const step = stepRankedRun(state, tickInputs);
      state = step.state;
    } catch (error) {
      return invalidStageResult(error.message, playerSnapshot, state.elapsedTicks);
    }
    if (!state.outcome && inputIndex >= inputs.length && !canContinueStage(state)) {
      return {
        valid: false,
        outcome: 'incomplete',
        elapsedTicks: state.elapsedTicks,
        playerHp: state.player.currentHp,
        rejectReason: 'run-cannot-progress-with-submitted-inputs',
      };
    }
  }
  if (!state.outcome) {
    return {
      valid: false,
      outcome: 'incomplete',
      elapsedTicks: state.elapsedTicks,
      playerHp: state.player.currentHp,
      rejectReason: 'simulation-tick-limit-reached',
    };
  }
  if (inputIndex < inputs.length) return invalidStageResult('input-after-terminal-outcome', playerSnapshot, state.elapsedTicks);
  return stageResult(state);
}

function assertPvpTicket(ticket) {
  if (!ticket || typeof ticket !== 'object') throw new TypeError('ticket must be an object.');
  if (typeof ticket.matchId !== 'string' || !ticket.matchId) throw new TypeError('matchId must be a non-empty string.');
  if (!Number.isInteger(ticket.seed) || ticket.seed < 1 || ticket.seed > 0xffffffff) {
    throw new RangeError('seed must be an integer from 1 to 4294967295.');
  }
  if (ticket.simulatorVersion !== 1) throw new RangeError('unsupported simulatorVersion.');
  if (typeof ticket.issuedAtUtc !== 'string' || !ticket.issuedAtUtc) throw new TypeError('issuedAtUtc must be a non-empty string.');
  if (ticket.timeLimitMs !== 60000) throw new RangeError('timeLimitMs must be exactly 60000.');
}

function invalidPvpResult(reason, playerSnapshot, opponentSnapshot, elapsedTicks = 0) {
  const playerHp = Number.isFinite(playerSnapshot?.currentHp) ? playerSnapshot.currentHp : 0;
  const opponentHp = Number.isFinite(opponentSnapshot?.currentHp) ? opponentSnapshot.currentHp : 0;
  return {
    valid: false,
    outcome: 'invalid',
    elapsedTicks,
    playerHp,
    opponentHp,
    playerHpPercent: Number.isFinite(playerSnapshot?.maxHp) && playerSnapshot.maxHp > 0 ? playerHp / playerSnapshot.maxHp : 0,
    rejectReason: reason,
  };
}

function pvpOutcome(playerHp, playerMaxHp, opponentHp, opponentMaxHp) {
  const playerHpPercent = playerHp / playerMaxHp;
  const opponentHpPercent = opponentHp / opponentMaxHp;
  if (playerHpPercent === opponentHpPercent) return { outcome: 'draw', playerHpPercent, opponentHpPercent };
  return {
    outcome: playerHpPercent > opponentHpPercent ? 'win' : 'loss',
    playerHpPercent,
    opponentHpPercent,
  };
}

export function replayPvpRun(ticket, playerSnapshot, opponentSnapshot, inputs) {
  const inputError = validateInputLog(inputs);
  if (inputError) return invalidPvpResult(inputError, playerSnapshot, opponentSnapshot);
  if (inputs.some((event) => event.kind !== 'move')) {
    return invalidPvpResult('pvp-only-accepts-movement-inputs', playerSnapshot, opponentSnapshot);
  }
  try {
    assertPvpTicket(ticket);
    assertCombatSnapshot(playerSnapshot);
    assertCombatSnapshot(opponentSnapshot, 'opponent');
  } catch (error) {
    return invalidPvpResult(error.message, playerSnapshot, opponentSnapshot);
  }
  const player = {
    ...playerSnapshot,
    effects: playerSnapshot.effects.map((effect) => ({ ...effect })),
    x: PLAYER_START_X,
  };
  const opponent = {
    ...opponentSnapshot,
    effects: opponentSnapshot.effects.map((effect) => ({ ...effect })),
    x: PVP_OPPONENT_X,
    width: PVP_PLAYER_WIDTH,
  };
  let randomState = ticket.seed >>> 0;
  let direction = 0;
  let playerContacted = false;
  let tick = 0;
  let inputIndex = 0;
  while (tick < ticket.timeLimitMs * TICKS_PER_SECOND / 1000) {
    const tickInputs = [];
    while (inputIndex < inputs.length && inputs[inputIndex].tick === tick) {
      tickInputs.push(inputs[inputIndex]);
      inputIndex += 1;
    }
    if (tickInputs.some((event) => event.kind !== 'move')) {
      return invalidPvpResult('pvp-only-accepts-movement-inputs', playerSnapshot, opponentSnapshot, tick);
    }
    if (tickInputs.length > 1) return invalidPvpResult('duplicate-move-event', playerSnapshot, opponentSnapshot, tick);
    if (tickInputs.length === 1) direction = tickInputs[0].value;
    player.x = clamp(player.x + direction * player.moveSpeed / TICKS_PER_SECOND, PLAYER_MIN_X, PLAYER_MAX_X);
    const overlapping = Math.abs(player.x - opponent.x) <= (PLAYER_WIDTH + opponent.width) / 2;
    if (!overlapping) {
      playerContacted = false;
    } else if (!playerContacted) {
      playerContacted = true;
      const random = nextRandom(randomState);
      randomState = random.state;
      const result = resolveContact({
        playerStats: player,
        enemyStats: {
          attack: opponent.attack,
          defense: opponent.defense,
          currentHp: opponent.currentHp,
          maxHp: opponent.maxHp,
        },
        playerEffects: player.effects,
        rng: () => random.value,
      });
      player.currentHp = result.playerHp;
      opponent.currentHp = result.enemyHp;
      const directionAway = player.x <= opponent.x ? -1 : 1;
      player.x = clamp(player.x + directionAway * BALANCE.knockbackPixels, PLAYER_MIN_X, PLAYER_MAX_X);
      if (player.currentHp <= 0) {
        const remaining = pvpOutcome(player.currentHp, player.maxHp, opponent.currentHp, opponent.maxHp);
        return {
          valid: true,
          ...remaining,
          elapsedTicks: tick + 1,
          playerHp: player.currentHp,
          opponentHp: opponent.currentHp,
          rejectReason: null,
        };
      }
      if (opponent.currentHp <= 0) {
        return {
          valid: true,
          outcome: 'win',
          elapsedTicks: tick + 1,
          playerHp: player.currentHp,
          opponentHp: 0,
          playerHpPercent: player.currentHp / player.maxHp,
          opponentHpPercent: 0,
          rejectReason: null,
        };
      }
    }
    tick += 1;
    if (tickInputs.length === 0 && inputIndex >= inputs.length && direction === 0 && !playerContacted) {
      // A stationary replay still consumes the ticket's full time limit; this is a valid timeout result.
    }
  }
  if (inputIndex < inputs.length) return invalidPvpResult('input-after-time-limit', playerSnapshot, opponentSnapshot, tick);
  const remaining = pvpOutcome(player.currentHp, player.maxHp, opponent.currentHp, opponent.maxHp);
  return {
    valid: true,
    ...remaining,
    elapsedTicks: tick,
    playerHp: player.currentHp,
    opponentHp: opponent.currentHp,
    rejectReason: null,
  };
}
