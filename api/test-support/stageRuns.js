import { createInitialState } from '../../src/game/domain/gear.js';
import { createRankedRun, replayRankedRun, stepRankedRun } from '@knight-run/game-rules/simulation';

export const identityA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  displayName: 'Player A',
};

export const RUN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
export const PLAYER_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
export const ISSUED_AT = new Date('2026-10-21T02:00:00.000Z');

let itemId = 0;
export function makeSaveState() {
  return createInitialState(() => `stage-${++itemId}`);
}

export const strongSnapshot = Object.freeze({
  maxHp: 100000,
  currentHp: 100000,
  attack: 1000,
  defense: 1000,
  critChance: 0,
  critMultiplier: 2,
  moveSpeed: 200,
  effects: [],
});

export function makeClearInputs(ticket, snapshot = strongSnapshot) {
  let state = createRankedRun(ticket, snapshot);
  const inputs = [];
  while (!state.outcome && state.tick < 10000) {
    const tickInputs = [];
    if (state.tick === 0) tickInputs.push({ tick: state.tick, kind: 'move', value: 1 });
    if (state.player.pendingLevelUps > 0) tickInputs.push({ tick: state.tick, kind: 'levelUp', value: 'attack' });
    inputs.push(...tickInputs);
    state = stepRankedRun(state, tickInputs).state;
  }
  const replay = replayRankedRun(ticket, snapshot, inputs);
  if (!replay.valid || replay.outcome !== 'clear') throw new Error(`Could not construct clear input trace: ${JSON.stringify(replay)}`);
  return { inputs, replay };
}

function makeTicketRow(input) {
  return {
    RunId: input.runId,
    PlayerId: input.playerId,
    Chapter: input.chapter,
    Stage: input.stage,
    Seed: input.seed,
    SimulatorVersion: input.simulatorVersion,
    BalanceVersion: input.balanceVersion,
    PlayerSnapshotJson: JSON.stringify(input.playerSnapshot),
    IssuedAtUtc: input.issuedAtUtc,
    ExpiresAtUtc: input.expiresAtUtc,
    Status: 'issued',
    CompletedAtUtc: null,
    InputJson: null,
    Outcome: null,
  };
}

export function createStageRepository({ revision = 7, state = makeSaveState(), existingTicket = null } = {}) {
  const saves = new Map([[PLAYER_ID, {
    SchemaVersion: 2,
    Revision: revision,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date('2026-10-21T01:00:00.000Z'),
  }]]);
  const tickets = new Map(existingTicket ? [[existingTicket.RunId, structuredClone(existingTicket)]] : []);
  const bests = new Map();
  const calls = { createTicket: [], completeRun: [], published: [] };
  return {
    saves,
    tickets,
    bests,
    calls,
    async findPlayerIdByIdentity(_pool, identity) {
      return identity.tenantId === identityA.tenantId && identity.objectId === identityA.objectId ? PLAYER_ID : null;
    },
    async getByPlayerId(_pool, playerId) {
      return structuredClone(saves.get(playerId) ?? null);
    },
    async createTicket(_transaction, input) {
      calls.createTicket.push(input);
      const save = saves.get(input.playerId);
      if (!save) return { kind: 'missing-save' };
      if (Number(save.Revision) !== input.expectedSaveRevision) {
        return { kind: 'revision-mismatch', currentRevision: Number(save.Revision) };
      }
      const active = [...tickets.values()].find((ticket) =>
        ticket.PlayerId === input.playerId && ticket.Status === 'issued' && ticket.ExpiresAtUtc > input.issuedAtUtc,
      );
      if (active) return { kind: 'active-ticket', runId: active.RunId };
      const row = makeTicketRow(input);
      tickets.set(row.RunId, row);
      return { kind: 'created', row: structuredClone(row) };
    },
    async getTicketByPlayerId(_pool, playerId, runId) {
      const row = tickets.get(runId);
      return row?.PlayerId === playerId ? structuredClone(row) : null;
    },
    async expireTicket(_transaction, playerId, runId) {
      const row = tickets.get(runId);
      if (row?.PlayerId === playerId && row.Status === 'issued') row.Status = 'expired';
    },
    async completeRun(_transaction, input) {
      calls.completeRun.push(input);
      const row = tickets.get(input.runId);
      if (!row || row.PlayerId !== input.playerId) return { kind: 'not-found' };
      if (row.Status !== 'issued') return { kind: row.Status, row: structuredClone(row) };
      row.Status = input.outcome === 'clear' ? 'completed' : 'rejected';
      row.InputJson = input.inputJson;
      row.Outcome = input.outcome;
      row.CompletedAtUtc = input.completedAtUtc;
      let bestChanged = false;
      if (input.outcome === 'clear') {
        const old = bests.get(input.playerId);
        const candidate = {
          PlayerId: input.playerId,
          Chapter: input.chapter,
          Stage: input.stage,
          ClearTimeMs: input.clearTimeMs,
          RunId: input.runId,
        };
        const oldOrdinal = old ? old.Chapter * 10 + old.Stage : -1;
        const newOrdinal = candidate.Chapter * 10 + candidate.Stage;
        if (!old || newOrdinal > oldOrdinal || (newOrdinal === oldOrdinal && candidate.ClearTimeMs < old.ClearTimeMs)) {
          bests.set(input.playerId, candidate);
          bestChanged = true;
        }
      }
      return { kind: 'completed', row: structuredClone(row), bestChanged, topFive: [] };
    },
    async getTopFive() { return []; },
  };
}

export function createStageDependencies(repository, overrides = {}) {
  let nextId = 0;
  let nextSeed = 123456;
  return {
    repository,
    withTransaction: async (_pool, work) => work({}),
    clock: () => new Date('2026-10-21T02:00:00.000Z'),
    createRunId: () => nextId++ === 0 ? RUN_ID : 'cccccccc-3333-4333-8333-333333333333',
    createSeed: () => nextSeed++,
    publishRankingChanged: async (event) => repository.calls.published.push(event),
    ...overrides,
  };
}
