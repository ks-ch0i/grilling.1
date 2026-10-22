import { createInitialState } from '../../src/game/domain/gear.js';
import { replayPvpRun } from '@knight-run/game-rules/simulation';

export const identityA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Player A',
};
export const identityB = { ...identityA, objectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Player B' };
export const identityC = { ...identityA, objectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', displayName: 'Player C' };

export const PLAYER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
export const PLAYER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
export const PLAYER_C = 'cccccccc-3333-4333-8333-333333333333';
export const MATCH_A = 'dddddddd-4444-4444-8444-444444444444';
export const MATCH_B = 'eeeeeeee-5555-4555-8555-555555555555';
export const NOW = new Date('2026-10-21T02:00:00.000Z');

let gearId = 0;
export function makeSaveState() {
  return createInitialState(() => `pvp-${++gearId}`);
}

export const strongCombat = Object.freeze({
  maxHp: 100000,
  currentHp: 100000,
  attack: 1000,
  defense: 1000,
  critChance: 0,
  critMultiplier: 2,
  moveSpeed: 200,
  effects: [],
});
export const weakCombat = Object.freeze({
  maxHp: 100,
  currentHp: 100,
  attack: 1,
  defense: 0,
  critChance: 0,
  critMultiplier: 2,
  moveSpeed: 200,
  effects: [],
});
export const neutralCombat = Object.freeze({
  maxHp: 100,
  currentHp: 100,
  attack: 0,
  defense: 0,
  critChance: 0,
  critMultiplier: 2,
  moveSpeed: 0,
  effects: [],
});

export function makeSnapshot(combat = strongCombat, revision = 1, displayLevel = 1) {
  const state = makeSaveState();
  return {
    revision,
    character: { level: displayLevel, baseStats: { ...state.player.baseStats } },
    equipment: state.equipment,
    combat: structuredClone(combat),
    publishedAtUtc: NOW.toISOString(),
  };
}

const identityRows = new Map([
  [`${identityA.tenantId}/${identityA.objectId}`, PLAYER_A],
  [`${identityB.tenantId}/${identityB.objectId}`, PLAYER_B],
  [`${identityC.tenantId}/${identityC.objectId}`, PLAYER_C],
]);
const identitiesByPlayer = new Map([[PLAYER_A, identityA], [PLAYER_B, identityB], [PLAYER_C, identityC]]);

function publicSnapshotRow(snapshot, playerId) {
  return {
    PlayerId: playerId,
    Revision: snapshot.revision,
    SnapshotJson: JSON.stringify(snapshot),
    UpdatedAtUtc: new Date(snapshot.publishedAtUtc),
  };
}

function stableContent(snapshot) {
  const { character, equipment, combat } = snapshot;
  return JSON.stringify({ character, equipment, combat });
}

export function createPvpRepository({
  snapshots = { [PLAYER_A]: makeSnapshot(strongCombat), [PLAYER_B]: makeSnapshot(strongCombat), [PLAYER_C]: null },
  ratings = { [PLAYER_A]: 1000, [PLAYER_B]: 1000, [PLAYER_C]: 1000 },
} = {}) {
  const saves = new Map();
  for (const [playerId, state] of [[PLAYER_A, makeSaveState()], [PLAYER_B, makeSaveState()], [PLAYER_C, makeSaveState()]]) {
    saves.set(playerId, {
      SchemaVersion: 2,
      Revision: 7,
      SaveJson: JSON.stringify(state),
      UpdatedAtUtc: new Date('2026-10-21T01:00:00.000Z'),
    });
  }
  const snapshotRows = new Map();
  for (const [playerId, snapshot] of Object.entries(snapshots)) {
    if (snapshot) snapshotRows.set(playerId, publicSnapshotRow(snapshot, playerId));
  }
  const ratingRows = new Map(Object.entries(ratings).map(([id, rating]) => [id, { PlayerId: id, Rating: rating, UpdatedAtUtc: new Date(NOW) }]));
  const matches = new Map();
  const ratedPairs = new Map();
  const calls = { windows: [], creates: [], completes: [], published: [] };

  return {
    saves, snapshotRows, ratingRows, matches, ratedPairs, calls,
    async findPlayerIdByIdentity(_pool, identity) {
      return identityRows.get(`${identity.tenantId}/${identity.objectId}`) ?? null;
    },
    async getByPlayerId(_pool, playerId) {
      const row = saves.get(playerId);
      return row ? structuredClone(row) : null;
    },
    async getPlayerSnapshot(_pool, playerId) {
      const row = snapshotRows.get(playerId);
      return row ? structuredClone(row) : null;
    },
    async getRating(_pool, playerId) {
      return Number(ratingRows.get(playerId)?.Rating ?? 1000);
    },
    async publishSnapshot(_transaction, input) {
      const current = snapshotRows.get(input.playerId);
      const currentSnapshot = current ? JSON.parse(current.SnapshotJson) : null;
      const currentContent = currentSnapshot ? stableContent(currentSnapshot) : null;
      if (currentContent === input.contentJson) return { kind: 'unchanged', row: structuredClone(current) };
      const snapshot = {
        ...JSON.parse(input.contentJson),
        revision: current ? Number(current.Revision) + 1 : 1,
        publishedAtUtc: input.publishedAtUtc.toISOString(),
      };
      const row = publicSnapshotRow(snapshot, input.playerId);
      snapshotRows.set(input.playerId, row);
      return { kind: 'published', row: structuredClone(row) };
    },
    async findOpponentCandidate(_pool, input) {
      calls.windows.push(input.window);
      const ownRating = ratingRows.get(input.playerId)?.Rating ?? 1000;
      const nowDate = input.nowUtc.toISOString().slice(0, 10);
      const candidates = [...snapshotRows.entries()]
        .filter(([id]) => id !== input.playerId)
        .filter(([id]) => Math.abs((ratingRows.get(id)?.Rating ?? 1000) - ownRating) <= input.window)
        .filter(([id]) => !ratedPairs.has(`${nowDate}/${[id, input.playerId].sort().join('/')}`))
        .filter(([id]) => ![...matches.values()].some((match) =>
          match.Status === 'issued' && match.ExpiresAtUtc > input.nowUtc && [match.Player1Id, match.Player2Id].includes(id),
        ))
        .map(([id, row]) => ({
          playerId: id,
          snapshot: JSON.parse(row.SnapshotJson),
          snapshotRevision: Number(row.Revision),
          rating: ratingRows.get(id)?.Rating ?? 1000,
          displayName: identitiesByPlayer.get(id)?.displayName ?? 'Adventurer',
        }))
        .sort((a, b) => Math.abs(a.rating - ownRating) - Math.abs(b.rating - ownRating) || a.playerId.localeCompare(b.playerId));
      return candidates[0] ?? null;
    },
    async createMatch(_transaction, input) {
      calls.creates.push(input);
      const own = snapshotRows.get(input.player1Id);
      const opponent = snapshotRows.get(input.player2Id);
      if (!own || !opponent || Number(own.Revision) !== input.player1SnapshotRevision || Number(opponent.Revision) !== input.player2SnapshotRevision) {
        return { kind: 'snapshot-changed' };
      }
      const ownRating = ratingRows.get(input.player1Id)?.Rating ?? 1000;
      const opponentRating = ratingRows.get(input.player2Id)?.Rating ?? 1000;
      if (Number.isInteger(input.window) && Math.abs(ownRating - opponentRating) > input.window) return { kind: 'rating-changed' };
      const row = {
        MatchId: input.matchId,
        Player1Id: input.player1Id,
        Player2Id: input.player2Id,
        Player1SnapshotRevision: input.player1SnapshotRevision,
        Player2SnapshotRevision: input.player2SnapshotRevision,
        Player1SnapshotJson: own.SnapshotJson,
        Player2SnapshotJson: opponent.SnapshotJson,
        Seed: input.seed,
        SimulatorVersion: input.simulatorVersion,
        InputJson: null,
        Outcome: null,
        RatingBefore1: ownRating,
        RatingBefore2: opponentRating,
        RatingAfter1: null,
        RatingAfter2: null,
        IssuedAtUtc: input.issuedAtUtc,
        ExpiresAtUtc: input.expiresAtUtc,
        CompletedAtUtc: null,
        Status: 'issued',
        Rated: false,
      };
      matches.set(row.MatchId, row);
      return { kind: 'created', row: structuredClone(row) };
    },
    async getMatchForPlayer(_pool, playerId, matchId) {
      const row = matches.get(matchId);
      return row?.Player1Id === playerId ? structuredClone(row) : null;
    },
    async expireMatch(_transaction, playerId, matchId) {
      const row = matches.get(matchId);
      if (row?.Player1Id === playerId && row.Status === 'issued') row.Status = 'expired';
    },
    async completeRatedMatch(_transaction, input) {
      calls.completes.push(input);
      const row = matches.get(input.matchId);
      if (!row || row.Player1Id !== input.player1Id) return { kind: 'not-found' };
      if (row.Status !== 'issued') return { kind: row.Status, row: structuredClone(row) };
      if (row.ExpiresAtUtc <= input.completedAtUtc) return { kind: 'expired', row: structuredClone(row) };
      const r1 = ratingRows.get(row.Player1Id)?.Rating ?? 1000;
      const r2 = ratingRows.get(row.Player2Id)?.Rating ?? 1000;
      const date = input.completedAtUtc.toISOString().slice(0, 10);
      const pairKey = `${date}/${[row.Player1Id, row.Player2Id].sort().join('/')}`;
      const rated = !ratedPairs.has(pairKey);
      let after1 = r1;
      let after2 = r2;
      if (rated) {
        ratedPairs.set(pairKey, row.MatchId);
        if (input.outcome !== 'draw') {
          const expected1 = 1 / (1 + 10 ** ((r2 - r1) / 400));
          const score1 = input.outcome === 'win' ? 1 : 0;
          after1 = Math.round(r1 + 32 * (score1 - expected1));
          after2 = Math.round(r2 + 32 * ((1 - score1) - (1 - expected1)));
          ratingRows.set(row.Player1Id, { PlayerId: row.Player1Id, Rating: after1, UpdatedAtUtc: input.completedAtUtc });
          ratingRows.set(row.Player2Id, { PlayerId: row.Player2Id, Rating: after2, UpdatedAtUtc: input.completedAtUtc });
        }
      }
      Object.assign(row, {
        InputJson: input.inputJson,
        Outcome: input.outcome,
        RatingBefore1: r1,
        RatingBefore2: r2,
        RatingAfter1: after1,
        RatingAfter2: after2,
        CompletedAtUtc: input.completedAtUtc,
        Status: 'completed',
        Rated: rated,
      });
      return { kind: 'completed', row: structuredClone(row) };
    },
    async rejectMatch(_transaction, input) {
      const row = matches.get(input.matchId);
      if (!row || row.Player1Id !== input.player1Id) return { kind: 'not-found' };
      if (row.Status !== 'issued') return { kind: row.Status, row: structuredClone(row) };
      Object.assign(row, { InputJson: input.inputJson, Outcome: 'invalid', CompletedAtUtc: input.completedAtUtc, Status: 'rejected' });
      return { kind: 'rejected', row: structuredClone(row) };
    },
    async getPvpTopFive() {
      return [...ratingRows.values()]
        .sort((a, b) => b.Rating - a.Rating || a.UpdatedAtUtc - b.UpdatedAtUtc || a.PlayerId.localeCompare(b.PlayerId))
        .slice(0, 5)
        .map((row) => ({ PlayerId: row.PlayerId, DisplayName: identitiesByPlayer.get(row.PlayerId)?.displayName ?? 'Adventurer', Rating: row.Rating }));
    },
  };
}

export function createPvpDependencies(repository, overrides = {}) {
  let currentTime = NOW.getTime();
  let matchNo = 0;
  let seed = 123456;
  return {
    repository,
    withTransaction: async (_pool, work) => work({}),
    clock: () => new Date(currentTime),
    sleep: async (ms) => { currentTime += ms; },
    createMatchId: () => matchNo++ === 0 ? MATCH_A : MATCH_B,
    createSeed: () => seed++,
    publishSnapshotChanged: async (event) => repository.calls.published.push(event),
    publishMatchCompleted: async (event) => repository.calls.published.push(event),
    ...overrides,
  };
}

export function makePvpInputs(ticket, playerSnapshot, opponentSnapshot) {
  const inputs = [{ tick: 0, kind: 'move', value: 1 }];
  const replay = replayPvpRun({ ...ticket, timeLimitMs: 60000 }, playerSnapshot, opponentSnapshot, inputs);
  if (!replay.valid) throw new Error(`Could not construct a PvP trace: ${JSON.stringify(replay)}`);
  return { inputs, replay };
}

export function seedIssuedMatch(repository, {
  matchId = MATCH_A,
  player1Id = PLAYER_A,
  player2Id = PLAYER_B,
  playerSnapshot = strongCombat,
  opponentSnapshot = weakCombat,
  issuedAtUtc = NOW,
  expiresAtUtc = new Date(NOW.getTime() + 10 * 60 * 1000),
  seed = 123456,
} = {}) {
  const row = {
    MatchId: matchId,
    Player1Id: player1Id,
    Player2Id: player2Id,
    Player1SnapshotRevision: 1,
    Player2SnapshotRevision: 1,
    Player1SnapshotJson: JSON.stringify(makeSnapshot(playerSnapshot)),
    Player2SnapshotJson: JSON.stringify(makeSnapshot(opponentSnapshot)),
    Seed: seed,
    SimulatorVersion: 1,
    InputJson: null,
    Outcome: null,
    RatingBefore1: 1000,
    RatingBefore2: 1000,
    RatingAfter1: null,
    RatingAfter2: null,
    IssuedAtUtc: issuedAtUtc,
    ExpiresAtUtc: expiresAtUtc,
    CompletedAtUtc: null,
    Status: 'issued',
    Rated: false,
  };
  repository.matches.set(matchId, row);
  return row;
}
