import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as pvpRepository from '../repositories/pvpRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { replayPvpRun } from '@knight-run/game-rules/simulation';
import { BALANCE_VERSION, PVP_SIMULATOR_VERSION } from '../domain/gameVersions.js';
import {
  MATCH_TIME_LIMIT_MS,
  PvpValidationError,
  calculateElo,
  isMatchId,
  validatePvpInputs,
} from '../domain/pvpRating.js';

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('PvP result timestamp is invalid.');
  return date;
}

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? { ...cloudSaveRepository, ...pvpRepository },
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    publishMatchCompleted: dependencies.publishMatchCompleted ?? (async () => {}),
    publishPlayerRankChanged: dependencies.publishPlayerRankChanged ?? (async () => {}),
  };
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function resultEnvelope(row, replay) {
  return {
    status: 200,
    outcome: row.Outcome,
    rated: Boolean(row.Rated),
    playerRatingBefore: Number(row.RatingBefore1),
    playerRatingAfter: Number(row.RatingAfter1),
    opponentRatingAfter: Number(row.RatingAfter2),
    remainingHpPercent: replay.playerHpPercent,
  };
}

export async function submitPvpResult(pool, identity, matchId, body, receivedAtUtc, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  if (!isMatchId(matchId)) return { status: 404, code: 'match-not-found' };
  let submitted;
  try {
    submitted = validatePvpInputs(body);
  } catch (error) {
    if (error instanceof PvpValidationError) return { status: 400, code: error.code };
    throw error;
  }
  const inputJson = JSON.stringify(submitted.inputs);
  const receivedAt = asDate(receivedAtUtc);
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'match-not-found' };
  const row = await deps.repository.getMatchForPlayer(pool, playerId, matchId);
  if (!row) return { status: 404, code: 'match-not-found' };
  if (row.Status === 'expired') return { status: 410, code: 'match-expired' };
  if (row.Status === 'rejected') {
    return row.InputJson === inputJson
      ? { status: 422, code: 'invalid-match-result', outcome: row.Outcome }
      : { status: 409, code: 'match-already-completed' };
  }
  if (row.Status === 'completed' && row.InputJson !== inputJson) return { status: 409, code: 'match-already-completed' };
  if (row.Status !== 'issued' && row.Status !== 'completed') return { status: 409, code: 'match-not-available' };
  if (row.Status === 'issued' && receivedAt.getTime() >= asDate(row.ExpiresAtUtc).getTime()) {
    await deps.withTransaction(pool, (transaction) => deps.repository.expireMatch(transaction, playerId, matchId));
    return { status: 410, code: 'match-expired' };
  }
  if (Number(row.SimulatorVersion) !== PVP_SIMULATOR_VERSION || Number(row.BalanceVersion) !== BALANCE_VERSION) {
    if (row.Status === 'issued') {
      await deps.withTransaction(pool, (transaction) => deps.repository.expireMatch(transaction, playerId, matchId));
    }
    return { status: 409, code: 'unsupported-simulator-version' };
  }

  const playerSnapshot = parseJson(row.Player1SnapshotJson);
  const opponentSnapshot = parseJson(row.Player2SnapshotJson);
  const ticket = {
    matchId: row.MatchId,
    seed: Number(row.Seed),
    simulatorVersion: Number(row.SimulatorVersion),
    balanceVersion: Number(row.BalanceVersion),
    issuedAtUtc: asDate(row.IssuedAtUtc).toISOString(),
    timeLimitMs: MATCH_TIME_LIMIT_MS,
  };
  const replay = replayPvpRun(ticket, playerSnapshot.combat, opponentSnapshot.combat, submitted.inputs);
  if (!replay.valid) {
    if (row.Status === 'completed') return { status: 409, code: 'match-already-completed' };
    const write = await deps.withTransaction(pool, (transaction) => deps.repository.rejectMatch(transaction, {
      player1Id: playerId,
      matchId,
      inputJson,
      completedAtUtc: receivedAt,
    }));
    if (write.kind === 'expired') return { status: 410, code: 'match-expired' };
    if (write.kind === 'not-found') return { status: 404, code: 'match-not-found' };
    if (write.kind !== 'rejected') {
      if (write.row?.InputJson === inputJson && write.row?.Status === 'rejected') {
        return { status: 422, code: 'invalid-match-result', outcome: write.row.Outcome };
      }
      return { status: 409, code: 'match-already-completed' };
    }
    return { status: 422, code: 'invalid-match-result', outcome: replay.rejectReason };
  }

  if (row.Status === 'completed') return resultEnvelope(row, replay);
  const write = await deps.withTransaction(pool, (transaction) => deps.repository.completeRatedMatch(transaction, {
    player1Id: playerId,
    player2Id: row.Player2Id,
    matchId,
    inputJson,
    outcome: replay.outcome,
    completedAtUtc: receivedAt,
  }));
  if (write.kind === 'expired') return { status: 410, code: 'match-expired' };
  if (write.kind === 'not-found') return { status: 404, code: 'match-not-found' };
  if (write.kind !== 'completed') {
    if (write.row?.Status === 'completed' && write.row.InputJson === inputJson) return resultEnvelope(write.row, replay);
    if (write.row?.InputJson && write.row.InputJson !== inputJson) return { status: 409, code: 'match-already-completed' };
    return { status: 409, code: 'match-not-available' };
  }

  const result = resultEnvelope(write.row, replay);
  if (result.rated) {
    let topFive;
    try {
      topFive = await deps.repository.getPvpTopFive(pool);
    } catch {
      topFive = null;
    }
    if (topFive) {
      try {
        await deps.publishMatchCompleted({
          board:'pvp',
          matchId,
          outcome: result.outcome,
          rated: result.rated,
          playerRatingAfter: result.playerRatingAfter,
          opponentRatingAfter: result.opponentRatingAfter,
          topFive: topFive.map((entry, index) => ({
            displayName: entry.DisplayName ?? entry.displayName ?? null,
            rating: Number(entry.Rating ?? entry.rating),
            rank: index + 1,
          })),
          generatedAtUtc: receivedAt.toISOString(),
        });
      } catch {
        // Player rank events and authoritative reads remain available independently.
      }
    }
    try {
      await deps.publishPlayerRankChanged({ identity, board:'pvp', generatedAtUtc:receivedAt.toISOString() });
    } catch {
      // Ranking polling remains authoritative if the personal event transport is unavailable.
    }
  }
  return result;
}

export async function getPvpTopFive(pool, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const rows = await repository.getPvpTopFive(pool);
  return rows.map((row, index) => ({
    displayName: row.DisplayName ?? row.displayName ?? null,
    rating: Number(row.Rating ?? row.rating),
    rank: index + 1,
  }));
}

export async function getPlayerPvpRank(pool, identity, dependencies) {
  const { repository } = dependenciesWithDefaults(dependencies);
  const playerId = await repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { rank:null, rating:1000 };
  const row = await repository.getPlayerRank(pool, playerId);
  return row
    ? { rank:row.Rank === null ? null : Number(row.Rank ?? row.rank), rating:Number(row.Rating ?? row.rating) }
    : { rank:null, rating:1000 };
}

export function createPvpResultService(dependencies = {}) {
  return {
    submitPvpResult: (pool, identity, matchId, body, receivedAtUtc) =>
      submitPvpResult(pool, identity, matchId, body, receivedAtUtc, dependencies),
    getPvpTopFive: (pool) => getPvpTopFive(pool, dependencies),
    getPlayerRank: (pool, identity) => getPlayerPvpRank(pool, identity, dependencies),
  };
}

export { calculateElo };
