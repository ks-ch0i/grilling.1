import { randomBytes, randomUUID } from 'node:crypto';
import { replayRankedRun } from '@knight-run/game-rules/simulation';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as defaultStageRepository from '../repositories/stageRankingRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { parseCloudSave } from '../domain/cloudSave.js';
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
  return { status: 200, outcome: row.Outcome, clearTimeMs, bestChanged: false, verified: row.Outcome === 'clear' };
}

function resultFromCompletion(write, inputJson, clearTimeMs) {
  if (write.kind === 'not-found') return { status: 404, code: 'run-not-found' };
  if (write.kind === 'expired') return { status: 410, code: 'run-expired' };
  if (write.kind === 'completed' || write.kind === 'rejected') {
    const row = write.row;
    if (row.InputJson !== inputJson) return { status: 409, code: 'run-already-completed' };
    if (row.Status === 'rejected') return { status: 422, code: 'run-not-cleared', outcome: row.Outcome };
    return {
      status: 200,
      outcome: row.Outcome,
      clearTimeMs,
      bestChanged: Boolean(write.bestChanged),
      verified: row.Outcome === 'clear',
    };
  }
  return { status: 409, code: 'run-not-available' };
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
  const save = parseCloudSave(saveRow);
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
    return conflictForStoredResult(row, inputJson, issuedAtUtc);
  }
  if (row.Status === 'expired') return { status: 410, code: 'run-expired' };
  if (row.Status !== 'issued') return { status: 409, code: 'run-not-available' };
  if (receivedAt.getTime() >= asDate(row.ExpiresAtUtc).getTime()) {
    await deps.withTransaction(pool, (transaction) => deps.repository.expireTicket(transaction, playerId, runId));
    return { status: 410, code: 'run-expired' };
  }
  if (Number(row.SimulatorVersion) !== SIMULATOR_VERSION || Number(row.BalanceVersion) !== BALANCE_VERSION) {
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
  if (!replay.valid || replay.outcome !== 'clear') {
    const write = await deps.withTransaction(pool, (transaction) => deps.repository.completeRun(transaction, {
      playerId,
      runId,
      inputJson,
      outcome: replay.outcome ?? 'invalid',
      completedAtUtc: receivedAt,
      chapter: ticket.chapter,
      stage: ticket.stage,
      clearTimeMs: 0,
    }));
    if (write.kind === 'completed' || write.kind === 'rejected') {
      if (write.row?.InputJson !== inputJson) return { status: 409, code: 'run-already-completed' };
    }
    if (write.kind === 'expired') return { status: 410, code: 'run-expired' };
    return { status: 422, code: 'run-not-cleared', outcome: replay.outcome };
  }

  const clearTimeMs = receivedAt.getTime() - issuedAtUtc.getTime();
  const replayDurationMs = replay.elapsedTicks * 1000 / 60;
  if (clearTimeMs <= 0 || replayDurationMs > clearTimeMs) {
    return { status: 422, code: 'run-too-fast' };
  }

  const write = await deps.withTransaction(pool, (transaction) => deps.repository.completeRun(transaction, {
    playerId,
    runId,
    inputJson,
    outcome: 'clear',
    completedAtUtc: receivedAt,
    chapter: ticket.chapter,
    stage: ticket.stage,
    clearTimeMs,
  }));
  if (write.kind !== 'completed') {
    if (write.kind === 'expired') return { status: 410, code: 'run-expired' };
    if (write.kind === 'completed' || write.kind === 'rejected') {
      return conflictForStoredResult(write.row, inputJson, issuedAtUtc);
    }
    if (write.kind === 'not-found') return { status: 404, code: 'run-not-found' };
    return { status: 409, code: 'run-not-available' };
  }
  if (typeof write.bestChanged !== 'boolean') {
    return conflictForStoredResult(write.row, inputJson, issuedAtUtc);
  }

  if (write.bestChanged) {
    try {
      await deps.publishRankingChanged({
        board: 'stage',
        chapter: ticket.chapter,
        stage: ticket.stage,
        clearTimeMs,
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
  return resultFromCompletion(write, inputJson, clearTimeMs);
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
