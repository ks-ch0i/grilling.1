import { createInitialState } from '../../src/game/domain/gear.js';
import { createRankedRun, replayRankedRun, stepRankedRun } from '@knight-run/game-rules/simulation';
import { mergeRewardProfile, parseRewardProfile } from '../src/domain/playerProfile.js';

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
  level: 1,
  xp: 0,
  xpToNext: 100,
  pendingLevelUps: 0,
  availableStatPoints: 0,
  spentStatPoints: 0,
  replayXpMultiplier: 1,
});

export function makeClearInputs(ticket, snapshot = strongSnapshot) {
  let state = createRankedRun(ticket, snapshot);
  const inputs = [];
  while (!state.outcome && state.tick < 10000) {
    const tickInputs = [];
    if (state.tick === 0) tickInputs.push({ tick: state.tick, kind: 'move', value: 1 });
    if (state.player.pendingLevelUps > 0) tickInputs.push({ tick: state.tick, kind: 'levelUp', value: ['attack'] });
    inputs.push(...tickInputs);
    state = stepRankedRun(state, tickInputs).state;
  }
  const replay = replayRankedRun(ticket, snapshot, inputs);
  if (!replay.valid || replay.outcome !== 'clear') throw new Error(`Could not construct clear input trace: ${JSON.stringify(replay)}`);
  return { inputs, replay };
}

export function makeDeathInputs(ticket, snapshot = {
  maxHp: 1, currentHp: 1, attack: 0, defense: 0, critChance: 0,
  critMultiplier: 2, moveSpeed: 200, effects: [], level: 1, xp: 0,
  xpToNext: 100, pendingLevelUps: 0, availableStatPoints: 0,
  spentStatPoints: 0, replayXpMultiplier: 1,
}) {
  let state = createRankedRun(ticket, snapshot);
  const inputs = [];
  while (!state.outcome && state.tick < 10000) {
    const tickInputs = [];
    if (state.tick === 0) tickInputs.push({ tick: state.tick, kind: 'move', value: 1 });
    if (state.player.pendingLevelUps > 0) tickInputs.push({ tick: state.tick, kind: 'levelUp', value: [] });
    inputs.push(...tickInputs);
    state = stepRankedRun(state, tickInputs).state;
  }
  const replay = replayRankedRun(ticket, snapshot, inputs);
  if (!replay.valid || replay.outcome !== 'death') throw new Error(`Could not construct death input trace: ${JSON.stringify(replay)}`);
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
    RewardJson: null,
  };
}

function cloneMap(map) {
  return new Map([...map].map(([key, value]) => [key, structuredClone(value)]));
}

function profileRow(playerId, profile) {
  return {
    PlayerId: playerId,
    Level: profile.level,
    Xp: profile.xp,
    XpToNext: profile.xpToNext,
    PendingLevelUps: profile.pendingLevelUps,
    Gold: profile.gold,
    Materials: profile.materials,
    InventoryJson: JSON.stringify(profile.inventory),
    Chapter: profile.chapter,
    CurrentStage: profile.currentStage,
    UnlockedChapter: profile.unlockedChapter,
    UnlockedStage: profile.unlockedStage,
    ClearedStageIdsJson: JSON.stringify(profile.clearedStageIds),
    UpdatedAtUtc: new Date('2026-10-21T01:00:00.000Z'),
  };
}

export function createStageRepository({ revision = 7, state = makeSaveState(), existingTicket = null } = {}) {
  const saves = new Map([[PLAYER_ID, {
    SchemaVersion: 2,
    Revision: revision,
    SaveJson: JSON.stringify(state),
    UpdatedAtUtc: new Date('2026-10-21T01:00:00.000Z'),
    RewardProfile: {
      PlayerId: PLAYER_ID, Level: 1, Xp: 0, XpToNext: 100, PendingLevelUps: 0,
      Gold: 0, Materials: 0, InventoryJson: '[]', Chapter: 1, CurrentStage: 1,
      UnlockedChapter: 1, UnlockedStage: 1, ClearedStageIdsJson: '[]',
    },
  }]]);
  const tickets = new Map(existingTicket ? [[existingTicket.RunId, structuredClone(existingTicket)]] : []);
  const bests = new Map();
  const calls = { createTicket: [], expireTicket: [], completeRun: [], published: [] };
  const repository = {
    saves,
    tickets,
    bests,
    calls,
    failAt: null,
    snapshot() {
      return { saves: cloneMap(saves), tickets: cloneMap(tickets), bests: cloneMap(bests) };
    },
    restore(snapshot) {
      for (const [target, source] of [[saves, snapshot.saves], [tickets, snapshot.tickets], [bests, snapshot.bests]]) {
        target.clear();
        for (const [key, value] of source) target.set(key, structuredClone(value));
      }
    },
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
      for (const ticket of tickets.values()) {
        if (ticket.PlayerId === input.playerId && ticket.Status === 'issued' &&
            (ticket.ExpiresAtUtc <= input.issuedAtUtc || ticket.SimulatorVersion !== input.simulatorVersion ||
             ticket.BalanceVersion !== input.balanceVersion)) {
          ticket.Status = 'expired';
        }
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
      calls.expireTicket.push({ playerId, runId });
      const row = tickets.get(runId);
      if (row?.PlayerId === playerId && row.Status === 'issued') row.Status = 'expired';
    },
    async completeRun(_transaction, input) {
      calls.completeRun.push(input);
      const row = tickets.get(input.runId);
      if (!row || row.PlayerId !== input.playerId) return { kind: 'not-found' };
      if (row.Status !== 'issued') {
        if (row.RewardJson && row.Status === 'completed' && row.InputJson === input.inputJson) {
          const save = saves.get(input.playerId);
          const profile = parseRewardProfile(save.RewardProfile);
          return {
            kind: 'completed',
            row: structuredClone(row),
            bestChanged: false,
            revision: Number(save.Revision),
            state: mergeRewardProfile(JSON.parse(save.SaveJson), profile),
            rewardSummary: JSON.parse(row.RewardJson),
          };
        }
        return { kind: row.Status, row: structuredClone(row) };
      }
      if (row.ExpiresAtUtc <= input.completedAtUtc) return { kind: 'expired', row: { ...structuredClone(row), Status: 'expired' } };

      const save = saves.get(input.playerId);
      if (!save) throw new Error('Stage reward CloudSave row is missing.');
      const currentProfile = parseRewardProfile(save.RewardProfile);
      let application = null;
      if (input.outcome === 'clear' || input.outcome === 'death') {
        if (typeof input.resolveRewards !== 'function') throw new Error('Missing reward resolver.');
        const ticket = {
          runId: row.RunId,
          chapter: Number(row.Chapter),
          stage: Number(row.Stage),
          seed: Number(row.Seed),
          simulatorVersion: Number(row.SimulatorVersion),
          balanceVersion: Number(row.BalanceVersion),
          playerSnapshot: JSON.parse(row.PlayerSnapshotJson),
        };
        application = input.resolveRewards({
          ticket,
          profile: currentProfile,
          state: mergeRewardProfile(JSON.parse(save.SaveJson), currentProfile),
        });
        save.RewardProfile = profileRow(input.playerId, application.profile);
        if (repository.failAt === 'profile') throw new Error('profile write failed');
        const currentState = mergeRewardProfile(JSON.parse(save.SaveJson), application.profile);
        saves.set(input.playerId, {
          ...save,
          SchemaVersion: 2,
          Revision: Number(save.Revision) + 1,
          SaveJson: JSON.stringify(currentState),
          UpdatedAtUtc: input.completedAtUtc,
        });
        if (repository.failAt === 'cloudSave') throw new Error('CloudSave write failed');
      }

      row.Status = input.outcome === 'clear' || input.outcome === 'death' ? 'completed' : 'rejected';
      row.InputJson = input.inputJson;
      row.Outcome = input.outcome;
      row.CompletedAtUtc = input.completedAtUtc;
      row.RewardJson = application ? JSON.stringify(application.rewardSummary) : null;
      if (repository.failAt === 'ticket') throw new Error('ticket write failed');
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
      if (repository.failAt === 'stageBest' && bestChanged) throw new Error('stage best write failed');
      const updatedSave = saves.get(input.playerId);
      return {
        kind: row.Status === 'rejected' ? 'rejected' : 'completed',
        row: structuredClone(row),
        bestChanged,
        topFive: [],
        ...(application ? {
          revision: Number(updatedSave.Revision),
          state: mergeRewardProfile(JSON.parse(updatedSave.SaveJson), parseRewardProfile(updatedSave.RewardProfile)),
          rewardSummary: structuredClone(application.rewardSummary),
        } : {}),
      };
    },
    async getTopFive() { return []; },
  };
  return repository;
}

export function createStageDependencies(repository, overrides = {}) {
  let nextId = 0;
  let nextSeed = 123456;
  let transactionTail = Promise.resolve();
  return {
    repository,
    withTransaction: async (_pool, work) => {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      const snapshot = repository.snapshot();
      try {
        return await work({});
      } catch (error) {
        repository.restore(snapshot);
        throw error;
      } finally {
        release();
      }
    },
    clock: () => new Date('2026-10-21T02:00:00.000Z'),
    createRunId: () => nextId++ === 0 ? RUN_ID : 'cccccccc-3333-4333-8333-333333333333',
    createSeed: () => nextSeed++,
    publishRankingChanged: async (event) => repository.calls.published.push(event),
    ...overrides,
  };
}
