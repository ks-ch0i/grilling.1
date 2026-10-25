import { randomBytes, randomUUID } from 'node:crypto';
import { replayRankedRun } from '@knight-run/game-rules/simulation';
import { resolveStageRewards, StageRewardError } from '@knight-run/game-rules/rewards';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as defaultStageRepository from '../repositories/stageRankingRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { parseCloudSave } from '../domain/cloudSave.js';
import { parseRewardProfile } from '../domain/playerProfile.js';
import {
  BALANCE_VERSION,
  derivePlayerCombatSnapshot,
  isRunId,
  isStageAccessible,
  SIMULATOR_VERSION,
  StageRunValidationError,
  STAGE_RUN_TTL_MS,
  validateStageInputs,
  validateStartRequest,
} from '../domain/stageRank.js';

function makeSeed() {
  let seed = 0;
  while (seed === 0) seed = randomBytes(4).readUInt32BE(0);
  return seed;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Stage run timestamp is invalid.');
  return date;
}

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? { ...cloudSaveRepository, ...defaultStageRepository },
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    clock: dependencies.clock ?? (() => new Date()),
    createRunId: dependencies.createRunId ?? randomUUID,
    createSeed: dependencies.createSeed ?? makeSeed,
    publishRankingChanged: dependencies.publishRankingChanged ?? (async () => {}),
    publishPlayerRankChanged: dependencies.publishPlayerRankChanged ?? (async () => {}),
  };
}

function ticketEnvelope(row) {
  return {
    runId: row.RunId,
    chapter: Number(row.Chapter),
    stage: Number(row.Stage),
    seed: Number(row.Seed),
    simulatorVersion: Number(row.SimulatorVersion),
    balanceVersion: Number(row.BalanceVersion),
    issuedAtUtc: asDate(row.IssuedAtUtc).toISOString(),
    expiresAtUtc: asDate(row.ExpiresAtUtc).toISOString(),
    playerSnapshot: typeof row.PlayerSnapshotJson === 'string'
      ? JSON.parse(row.PlayerSnapshotJson)
      : row.PlayerSnapshotJson,
  };
}

function conflictForStoredResult(row, inputJson, issuedAtUtc) {
  if (row.InputJson !== inputJson) return { status: 409, code: 'run-already-completed' };
  if (row.Status === 'rejected') return { status: 422, code: 'run-not-cleared', outcome: row.Outcome };
  if (row.Status !== 'completed') return { status: 409, code: 'run-not-available' };
  const clearTimeMs = asDate(row.CompletedAtUtc).getTime() - issuedAtUtc.getTime();
  return {
    status: 200,
    outcome: row.Outcome,
    clearTimeMs: row.Outcome === 'clear' ? clearTimeMs : null,
    bestChanged: false,
    verified: row.Outcome === 'clear' || row.Outcome === 'death',
  };
}

function resultFromCompletion(write, inputJson, issuedAtUtc) {
  if (write.kind === 'not-found') return { status: 404, code: 'run-not-found' };
  if (write.kind === 'expired') return { status: 410, code: 'run-expired' };
  if (write.kind === 'completed' || write.kind === 'rejected') {
    const row = write.row;
    if (row.InputJson !== inputJson) return { status: 409, code: 'run-already-completed' };
    if (row.Status === 'rejected') return { status: 422, code: 'run-not-cleared', outcome: row.Outcome };
    const clearTimeMs = row.Outcome === 'clear'
      ? asDate(row.CompletedAtUtc).getTime() - issuedAtUtc.getTime()
      : null;
    if (write.rewardSummary && write.state && Number.isSafeInteger(write.revision)) {
      return {
        status: 200,
        outcome: row.Outcome,
        clearTimeMs,
        bestChanged: Boolean(write.bestChanged),
        verified: true,
        revision: write.revision,
        state: write.state,
        rewards: write.rewardSummary,
      };
    }
    return {
      status: 200,
      outcome: row.Outcome,
      clearTimeMs,
      bestChanged: Boolean(write.bestChanged),
      verified: row.Outcome === 'clear' || row.Outcome === 'death',
    };
  }
  return { status: 409, code: 'run-not-available' };
}

function rewardProfileForResolver(profile) {
  return {
    level: profile.level,
    xp: profile.xp,
    xpToNext: profile.xpToNext,
    pendingLevelUps: profile.pendingLevelUps,
    gold: profile.gold,
    materials: profile.materials,
    inventory: profile.inventory,
    progression: {
      chapter: profile.chapter,
      currentStage: profile.currentStage,
      unlockedChapter: profile.unlockedChapter,
      unlockedStage: profile.unlockedStage,
      clearedStageIds: profile.clearedStageIds,
    },
  };
}

function profileWithRewardPatch(profile, patch) {
  return {
    ...profile,
    level: patch.level,
    xp: patch.xp,
    xpToNext: patch.xpToNext,
    pendingLevelUps: patch.pendingLevelUps,
    gold: patch.gold,
    inventory: patch.inventory,
    chapter: patch.progression.chapter,
    currentStage: patch.progression.currentStage,
    unlockedChapter: patch.progression.unlockedChapter,
    unlockedStage: patch.progression.unlockedStage,
    clearedStageIds: patch.progression.clearedStageIds,
  };
}

function ticketForRewardResolution(row) {
  return {
    runId: row.RunId,
    chapter: Number(row.Chapter),
    stage: Number(row.Stage),
    seed: Number(row.Seed),
    simulatorVersion: Number(row.SimulatorVersion),
    balanceVersion: Number(row.BalanceVersion),
    playerSnapshot: typeof row.PlayerSnapshotJson === 'string'
      ? JSON.parse(row.PlayerSnapshotJson)
      : row.PlayerSnapshotJson,
  };
}

export async function startStageRun(pool, identity, body, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  let request;
  try {
    request = validateStartRequest(body);
  } catch (error) {
    if (error instanceof StageRunValidationError) return { status: 400, code: error.code };
    throw error;
  }

  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'save-not-found' };
  const saveRow = await deps.repository.getByPlayerId(pool, playerId);
  if (!saveRow) return { status: 404, code: 'save-not-found' };
  const save = parseCloudSave(saveRow, parseRewardProfile(saveRow.RewardProfile));
  if (save.revision !== request.expectedSaveRevision) {
    return { status: 409, code: 'save-revision-conflict', currentRevision: save.revision };
  }
  if (!isStageAccessible(save.state, request.chapter, request.stage)) {
    return { status: 403, code: 'stage-locked' };
  }

  let playerSnapshot;
  try {
    playerSnapshot = derivePlayerCombatSnapshot(save.state, request.chapter, request.stage);
  } catch (error) {
    if (error instanceof StageRunValidationError) return { status: 422, code: error.code };
    throw error;
  }
  const issuedAtUtc = asDate(deps.clock());
  const expiresAtUtc = new Date(issuedAtUtc.getTime() + STAGE_RUN_TTL_MS);
  const runId = deps.createRunId();
  const seed = deps.createSeed();
  if (!isRunId(runId) || !Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) {
    throw new TypeError('Stage run id or seed factory returned an invalid value.');
  }

  const write = await deps.withTransaction(pool, (transaction) => deps.repository.createTicket(transaction, {
    playerId,
    expectedSaveRevision: request.expectedSaveRevision,
    runId,
    seed,
    chapter: request.chapter,
    stage: request.stage,
    simulatorVersion: SIMULATOR_VERSION,
    balanceVersion: BALANCE_VERSION,
    playerSnapshot,
    issuedAtUtc,
    expiresAtUtc,
  }));
  if (write.kind === 'revision-mismatch') {
    return { status: 409, code: 'save-revision-conflict', currentRevision: write.currentRevision };
  }
  if (write.kind === 'active-ticket') return { status: 409, code: 'active-run-exists' };
  if (write.kind === 'missing-player' || write.kind === 'missing-save') return { status: 404, code: 'save-not-found' };
  if (write.kind !== 'created' || !write.row) throw new Error('Stage run ticket insert did not return a row.');
  return { status: 201, ticket: ticketEnvelope(write.row) };
}

export async function submitStageResult(pool, identity, runId, body, receivedAtUtc, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  if (!isRunId(runId)) return { status: 404, code: 'run-not-found' };
  let submitted;
  try {
    submitted = validateStageInputs(body);
  } catch (error) {
    if (error instanceof StageRunValidationError) return { status: 400, code: error.code };
    throw error;
  }
  const inputJson = JSON.stringify(submitted.inputs);
  const receivedAt = asDate(receivedAtUtc);
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'run-not-found' };
  const row = await deps.repository.getTicketByPlayerId(pool, playerId, runId);
  if (!row) return { status: 404, code: 'run-not-found' };
  const issuedAtUtc = asDate(row.IssuedAtUtc);

  if (row.Status === 'completed' || row.Status === 'rejected') {
    if (row.InputJson !== inputJson) return { status: 409, code: 'run-already-completed' };
    if (row.Status === 'rejected' || !row.RewardJson) {
      return conflictForStoredResult(row, inputJson, issuedAtUtc);
    }
    const write = await deps.withTransaction(pool, (transaction) => deps.repository.completeRun(transaction, {
      playerId,
      runId,
      inputJson,
      outcome: row.Outcome,
      completedAtUtc: receivedAt,
      chapter: Number(row.Chapter),
      stage: Number(row.Stage),
      clearTimeMs: null,
    }));
    return resultFromCompletion(write, inputJson, issuedAtUtc);
  }
  if (row.Status === 'expired') return { status: 410, code: 'run-expired' };
  if (row.Status !== 'issued') return { status: 409, code: 'run-not-available' };
  if (receivedAt.getTime() >= asDate(row.ExpiresAtUtc).getTime()) {
    await deps.withTransaction(pool, (transaction) => deps.repository.expireTicket(transaction, playerId, runId));
    return { status: 410, code: 'run-expired' };
  }
  if (Number(row.SimulatorVersion) !== SIMULATOR_VERSION || Number(row.BalanceVersion) !== BALANCE_VERSION) {
    await deps.withTransaction(pool, (transaction) => deps.repository.expireTicket(transaction, playerId, runId));
    return { status: 409, code: 'unsupported-simulator-version' };
  }

  const ticket = {
    runId: row.RunId,
    seed: Number(row.Seed),
    chapter: Number(row.Chapter),
    stage: Number(row.Stage),
    simulatorVersion: Number(row.SimulatorVersion),
    balanceVersion: Number(row.BalanceVersion),
    issuedAtUtc: issuedAtUtc.toISOString(),
  };
  const playerSnapshot = typeof row.PlayerSnapshotJson === 'string'
    ? JSON.parse(row.PlayerSnapshotJson)
    : row.PlayerSnapshotJson;
  const replay = replayRankedRun(ticket, playerSnapshot, submitted.inputs);
  const validTerminal = replay.valid && (replay.outcome === 'clear' || replay.outcome === 'death');
  const rejectedOutcome = replay.outcome === 'incomplete' ? 'incomplete' : 'invalid';
  const elapsedMs = receivedAt.getTime() - issuedAtUtc.getTime();
  const replayDurationMs = replay.elapsedTicks * 1000 / 60;
  if (validTerminal && (elapsedMs <= 0 || replayDurationMs > elapsedMs)) {
    return { status: 422, code: 'run-too-fast' };
  }

  const outcome = validTerminal ? replay.outcome : rejectedOutcome;
  let write;
  try {
    write = await deps.withTransaction(pool, (transaction) => deps.repository.completeRun(transaction, {
      playerId,
      runId,
      inputJson,
      outcome,
      completedAtUtc: receivedAt,
      chapter: ticket.chapter,
      stage: ticket.stage,
      clearTimeMs: outcome === 'clear' ? elapsedMs : null,
      resolveRewards: validTerminal
        ? ({ ticket: lockedTicket, profile }) => {
          const resolved = resolveStageRewards({
            ticket: lockedTicket,
            replay,
            profile: rewardProfileForResolver(profile),
          });
          return {
            profile: profileWithRewardPatch(profile, resolved.profilePatch),
            rewardSummary: {
              outcome: resolved.outcome,
              xpGranted: resolved.xpGranted,
              goldGranted: resolved.goldGranted,
              drops: resolved.drops,
            },
          };
        }
        : undefined,
    }));
  } catch (error) {
    if (error instanceof StageRewardError && error.code === 'reward-overflow') {
      return { status: 422, code: 'reward-overflow' };
    }
    throw error;
  }
  if (write.kind !== 'completed') {
    if (write.kind === 'expired') return { status: 410, code: 'run-expired' };
    if (write.kind === 'completed' || write.kind === 'rejected') {
      return resultFromCompletion(write, inputJson, issuedAtUtc);
    }
    if (write.kind === 'not-found') return { status: 404, code: 'run-not-found' };
    return { status: 409, code: 'run-not-available' };
  }
  if (write.row?.InputJson !== inputJson) {
    return { status: 409, code: 'run-already-completed' };
  }

  if (outcome === 'clear' && write.bestChanged) {
    try {
      await deps.publishRankingChanged({
        board: 'stage',
        chapter: ticket.chapter,
        stage: ticket.stage,
        clearTimeMs: elapsedMs,
        topFive: (write.topFive ?? []).map((entry, index) => ({
          displayName: entry.DisplayName ?? entry.displayName ?? null,
          chapter: Number(entry.Chapter ?? entry.chapter),
          stage: Number(entry.Stage ?? entry.stage),
          clearTimeMs: Number(entry.ClearTimeMs ?? entry.clearTimeMs),
          rank: index + 1,
        })),
        generatedAtUtc: receivedAt.toISOString(),
      });
    } catch {
      // Personal rank events are attempted independently; polling remains authoritative.
    }
    try {
      await deps.publishPlayerRankChanged({ identity, board:'stage', generatedAtUtc:receivedAt.toISOString() });
    } catch {
      // Ranking polling remains authoritative if the personal event transport is unavailable.
    }
  }
  return resultFromCompletion(write, inputJson, issuedAtUtc);
}

export async function getStageTopFive(pool, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const rows = await repository.getTopFive(pool);
  return rows.map((row, index) => ({
    displayName: row.DisplayName ?? row.displayName ?? null,
    chapter: Number(row.Chapter ?? row.chapter),
    stage: Number(row.Stage ?? row.stage),
    clearTimeMs: Number(row.ClearTimeMs ?? row.clearTimeMs),
    rank: index + 1,
  }));
}

export async function getStagePlayerRank(pool, identity, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { rank:null, chapter:null, stage:null, clearTimeMs:null };
  const row = await repository.getPlayerRank(pool, playerId);
  return row ? {
    rank:Number(row.Rank ?? row.rank),
    chapter:Number(row.Chapter ?? row.chapter),
    stage:Number(row.Stage ?? row.stage),
    clearTimeMs:Number(row.ClearTimeMs ?? row.clearTimeMs),
  } : { rank:null, chapter:null, stage:null, clearTimeMs:null };
}

export function createStageRunService(dependencies = {}) {
  return {
    startStageRun: (pool, identity, body) => startStageRun(pool, identity, body, dependencies),
    submitStageResult: (pool, identity, runId, body, receivedAtUtc) =>
      submitStageResult(pool, identity, runId, body, receivedAtUtc, dependencies),
    getStageTopFive: (pool) => getStageTopFive(pool, dependencies),
    getPlayerRank: (pool, identity) => getStagePlayerRank(pool, identity, dependencies),
  };
}
