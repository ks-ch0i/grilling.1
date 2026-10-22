import { randomBytes, randomUUID } from 'node:crypto';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as pvpRepository from '../repositories/pvpRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { BALANCE_VERSION, PVP_SIMULATOR_VERSION } from '../domain/gameVersions.js';
import {
  MATCH_TIME_LIMIT_MS,
  MATCH_TTL_MS,
  PvpValidationError,
  validateSearchRequest,
} from '../domain/pvpRating.js';

export const MATCHMAKING = Object.freeze({
  initialWindow: 100,
  windowStep: 100,
  windowEveryMs: 5_000,
  maximumWindow: 500,
  maximumWaitMs: 60_000,
});

function makeSeed() {
  let seed = 0;
  while (seed === 0) seed = randomBytes(4).readUInt32BE(0);
  return seed;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('PvP timestamp is invalid.');
  return date;
}

function dependenciesWithDefaults(dependencies = {}) {
  return {
    repository: dependencies.repository ?? { ...cloudSaveRepository, ...pvpRepository },
    withTransaction: dependencies.withTransaction ?? defaultWithTransaction,
    clock: dependencies.clock ?? (() => new Date()),
    sleep: dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    createMatchId: dependencies.createMatchId ?? randomUUID,
    createSeed: dependencies.createSeed ?? makeSeed,
  };
}

function snapshotFromJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function ticketFromRow(row, opponentDisplayName) {
  return {
    matchId: row.MatchId,
    seed: Number(row.Seed),
    simulatorVersion: Number(row.SimulatorVersion),
    balanceVersion: Number(row.BalanceVersion),
    issuedAtUtc: asDate(row.IssuedAtUtc).toISOString(),
    expiresAtUtc: asDate(row.ExpiresAtUtc).toISOString(),
    timeLimitMs: MATCH_TIME_LIMIT_MS,
    playerSnapshot: snapshotFromJson(row.Player1SnapshotJson),
    opponentSnapshot: snapshotFromJson(row.Player2SnapshotJson),
    opponentDisplayName,
    playerRating: Number(row.RatingBefore1),
    opponentRating: Number(row.RatingBefore2),
  };
}

export async function findOpponent(pool, identity, body, dependencies) {
  if (dependencies === undefined && body && typeof body === 'object' && 'repository' in body) {
    dependencies = body;
    body = {};
  }
  const deps = dependenciesWithDefaults(dependencies);
  try {
    validateSearchRequest(body);
  } catch (error) {
    if (error instanceof PvpValidationError) return { status: 400, code: error.code };
    throw error;
  }

  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'save-not-found' };
  const initialSnapshot = await deps.repository.getPlayerSnapshot(pool, playerId);
  if (!initialSnapshot || Number(initialSnapshot.BalanceVersion) !== BALANCE_VERSION) {
    return { status: 409, code: 'snapshot-required' };
  }
  const startedAt = asDate(deps.clock());

  for (let elapsedMs = 0; elapsedMs < MATCHMAKING.maximumWaitMs;) {
    const window = Math.min(
      MATCHMAKING.initialWindow + Math.floor(elapsedMs / MATCHMAKING.windowEveryMs) * MATCHMAKING.windowStep,
      MATCHMAKING.maximumWindow,
    );
    const playerRating = await deps.repository.getRating(pool, playerId);
    const issuedAtUtc = asDate(deps.clock());
    const candidate = await deps.repository.findOpponentCandidate(pool, {
      playerId,
      playerRating,
      window,
      nowUtc: issuedAtUtc,
      simulatorVersion: PVP_SIMULATOR_VERSION,
      balanceVersion: BALANCE_VERSION,
    });
    if (candidate) {
      const ownSnapshot = await deps.repository.getPlayerSnapshot(pool, playerId);
      if (!ownSnapshot || Number(ownSnapshot.BalanceVersion) !== BALANCE_VERSION) return { status: 409, code: 'snapshot-required' };
      const matchId = deps.createMatchId();
      const seed = deps.createSeed();
      if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new TypeError('PvP seed factory returned an invalid value.');
      const expiresAtUtc = new Date(issuedAtUtc.getTime() + MATCH_TTL_MS);
      const write = await deps.withTransaction(pool, (transaction) => deps.repository.createMatch(transaction, {
        matchId,
        player1Id: playerId,
        player2Id: candidate.playerId,
        player1SnapshotRevision: Number(ownSnapshot.Revision),
        player2SnapshotRevision: candidate.snapshotRevision,
        window,
        seed,
        simulatorVersion: PVP_SIMULATOR_VERSION,
        balanceVersion: BALANCE_VERSION,
        issuedAtUtc,
        expiresAtUtc,
      }));
      if (write.kind === 'created' && write.row) {
        return { status: 201, ticket: ticketFromRow(write.row, candidate.displayName) };
      }
      if (write.kind === 'active-match') return { status: 409, code: 'active-match-exists' };
      if (write.kind === 'already-rated-pair') return { status: 409, code: 'pair-already-rated' };
      if (write.kind === 'missing-player') return { status: 404, code: 'save-not-found' };
      if (write.kind !== 'snapshot-changed' && write.kind !== 'rating-changed') {
        return { status: 409, code: 'match-unavailable' };
      }
    }

    const elapsed = Math.max(elapsedMs, asDate(deps.clock()).getTime() - startedAt.getTime());
    if (elapsed >= MATCHMAKING.maximumWaitMs) break;
    const waitMs = Math.min(MATCHMAKING.windowEveryMs, MATCHMAKING.maximumWaitMs - elapsed);
    await deps.sleep(waitMs);
    elapsedMs = elapsed + waitMs;
  }
  return { status: 404, code: 'no-opponent' };
}

export function createMatchmakingService(dependencies = {}) {
  return { findOpponent: (pool, identity, body) => findOpponent(pool, identity, body, dependencies) };
}
