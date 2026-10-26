import { randomBytes, randomUUID } from 'node:crypto';
import * as cloudSaveRepository from '../repositories/cloudSaveRepository.js';
import * as pvpRepository from '../repositories/pvpRepository.js';
import { withTransaction as defaultWithTransaction } from '../database/transaction.js';
import { BALANCE_VERSION, PVP_SIMULATOR_VERSION } from '../domain/gameVersions.js';
import {
  MATCH_TIME_LIMIT_MS,
  MATCH_TTL_MS,
  PvpValidationError,
  isMatchId,
  isSearchId,
  validateStartSearchRequest,
  validateSearchRequest,
} from '../domain/pvpRating.js';

export const MATCHMAKING = Object.freeze({
  initialWindow: 100,
  windowStep: 100,
  windowEveryMs: 5_000,
  maximumWindow: 500,
  maximumWaitMs: 60_000,
});

const SEARCH_RETENTION_MS = 10 * 60 * 1000;

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
  const deps = dependenciesWithDefaults(dependencies);
  let request;
  try {
    request = validateSearchRequest(body);
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

  const createdAtUtc = asDate(deps.clock());
  const claim = await deps.withTransaction(pool, (transaction) => deps.repository.claimSearch(transaction, {
    searchId: request.searchId,
    playerId,
    nowUtc: createdAtUtc,
    deadlineUtc: new Date(createdAtUtc.getTime() + MATCHMAKING.maximumWaitMs),
  }));
  if (claim.kind !== 'created') {
    if (claim.kind === 'not-found') return { status: 404, code: 'search-not-found' };
    return responseForSearchState(pool, playerId, claim.row, deps, 'retry');
  }
  return runSearchLoop(pool, playerId, claim.row, deps);
}

async function responseForSearchState(pool, playerId, search, deps, mode = 'read') {
  if (!search) return { status: 404, code: 'search-not-found' };
  const nowUtc = asDate(deps.clock());
  if (search.Status === 'searching' && asDate(search.SearchDeadlineAtUtc).getTime() <= nowUtc.getTime()) {
    const finished = await deps.withTransaction(pool, (transaction) => deps.repository.finishSearch(transaction, {
      searchId: search.SearchId,
      playerId,
      expectedStatus: 'searching',
      status: 'no-opponent',
      nowUtc,
      retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
    }));
    if (finished.row) search = finished.row;
  }

  if (search.Status === 'matched' || search.Status === 'started') {
    let ticketRow = await deps.repository.loadSearchTicket(pool, {
      searchId: search.SearchId,
      playerId,
    });
    if (!ticketRow || asDate(ticketRow.ExpiresAtUtc).getTime() <= nowUtc.getTime()) {
      const expired = await deps.withTransaction(pool, (transaction) => deps.repository.expireSearchMatch(transaction, {
        searchId: search.SearchId,
        playerId,
        nowUtc,
        retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
      }));
      if (expired.kind === 'expired') search = expired.row;
      else if (expired.kind === 'active') {
        ticketRow = await deps.repository.loadSearchTicket(pool, { searchId: search.SearchId, playerId });
      }
    }
    if (ticketRow && ['matched', 'started'].includes(search.Status) &&
        asDate(ticketRow.ExpiresAtUtc).getTime() > nowUtc.getTime()) {
      return {
        status: 200,
        searchId: search.SearchId,
        state: search.Status,
        matchId: search.MatchId,
        ticket: ticketFromRow(ticketRow, ticketRow.OpponentDisplayName),
      };
    }
  }

  if (search.Status === 'searching') {
    return { status: mode === 'retry' ? 202 : 200, searchId: search.SearchId, state: search.Status };
  }
  if (search.Status === 'no-opponent' && mode === 'retry') {
    return { status: 404, searchId: search.SearchId, state: 'no-opponent', code: 'no-opponent' };
  }
  return {
    status: 200,
    searchId: search.SearchId,
    state: search.Status,
    ...(search.MatchId ? { matchId: search.MatchId } : {}),
  };
}

async function runSearchLoop(pool, playerId, search, deps) {
  const startedAtUtc = asDate(search.CreatedAtUtc);
  while (true) {
    const nowUtc = asDate(deps.clock());
    const current = await deps.repository.getSearch(pool, {
      searchId: search.SearchId,
      playerId,
      nowUtc,
    });
    if (!current) return { status: 404, code: 'search-not-found' };
    if (current.Status !== 'searching') return responseForSearchState(pool, playerId, current, deps, 'read');

    const elapsedMs = Math.max(0, nowUtc.getTime() - startedAtUtc.getTime());
    const deadlineUtc = asDate(current.SearchDeadlineAtUtc);
    if (elapsedMs >= MATCHMAKING.maximumWaitMs || nowUtc.getTime() >= deadlineUtc.getTime()) {
      const finished = await deps.withTransaction(pool, (transaction) => deps.repository.finishSearch(transaction, {
        searchId: search.SearchId,
        playerId,
        expectedStatus: 'searching',
        status: 'no-opponent',
        nowUtc,
        retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
      }));
      return responseForSearchState(pool, playerId, finished.row ?? current, deps, 'retry');
    }

    const window = Math.min(
      MATCHMAKING.initialWindow + Math.floor(elapsedMs / MATCHMAKING.windowEveryMs) * MATCHMAKING.windowStep,
      MATCHMAKING.maximumWindow,
    );
    const playerRating = await deps.repository.getRating(pool, playerId);
    const candidate = await deps.repository.findOpponentCandidate(pool, {
      playerId,
      playerRating,
      window,
      nowUtc,
      simulatorVersion: PVP_SIMULATOR_VERSION,
      balanceVersion: BALANCE_VERSION,
    });
    if (candidate) {
      const beforeIssue = await deps.repository.getSearch(pool, {
        searchId: search.SearchId,
        playerId,
        nowUtc: asDate(deps.clock()),
      });
      if (!beforeIssue || beforeIssue.Status !== 'searching') {
        return responseForSearchState(pool, playerId, beforeIssue, deps, 'read');
      }
      const ownSnapshot = await deps.repository.getPlayerSnapshot(pool, playerId);
      if (!ownSnapshot || Number(ownSnapshot.BalanceVersion) !== BALANCE_VERSION) {
        const expiredAtUtc = asDate(deps.clock());
        await deps.withTransaction(pool, (transaction) => deps.repository.finishSearch(transaction, {
          searchId: search.SearchId,
          playerId,
          expectedStatus: 'searching',
          status: 'expired',
          nowUtc: expiredAtUtc,
          retainUntilUtc: new Date(expiredAtUtc.getTime() + SEARCH_RETENTION_MS),
        }));
        return { status: 409, code: 'snapshot-required' };
      }
      const issuedAtUtc = asDate(deps.clock());
      const matchId = deps.createMatchId();
      const seed = deps.createSeed();
      if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff) throw new TypeError('PvP seed factory returned an invalid value.');
      const expiresAtUtc = new Date(issuedAtUtc.getTime() + MATCH_TTL_MS);
      let write;
      try {
        write = await deps.withTransaction(pool, async (transaction) => {
          const created = await deps.repository.createMatch(transaction, {
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
          });
          if (created.kind !== 'created' || !created.row) return created;
          const linked = await deps.repository.attachSearchMatch(transaction, {
            searchId: search.SearchId,
            playerId,
            matchId,
            nowUtc: issuedAtUtc,
            retainUntilUtc: expiresAtUtc,
          });
          if (linked.kind !== 'linked') throw new SearchAttachTransitionError(linked.kind);
          return { kind: 'created', row: created.row, search: linked.row };
        });
      } catch (error) {
        if (!(error instanceof SearchAttachTransitionError)) throw error;
        const state = await deps.repository.getSearch(pool, {
          searchId: search.SearchId,
          playerId,
          nowUtc: asDate(deps.clock()),
        });
        return responseForSearchState(pool, playerId, state, deps, 'read');
      }
      if (write.kind === 'created') {
        return {
          status: 201,
          searchId: search.SearchId,
          state: 'matched',
          ticket: ticketFromRow(write.row, candidate.displayName),
        };
      }
    }

    const afterSearchUtc = asDate(deps.clock());
    const elapsedAfterSearchMs = Math.max(0, afterSearchUtc.getTime() - startedAtUtc.getTime());
    const remainingMs = Math.min(
      MATCHMAKING.maximumWaitMs - elapsedAfterSearchMs,
      deadlineUtc.getTime() - afterSearchUtc.getTime(),
    );
    if (remainingMs <= 0) continue;
    await deps.sleep(Math.min(MATCHMAKING.windowEveryMs, remainingMs));
  }
}

class SearchAttachTransitionError extends Error {
  constructor(kind) {
    super('Search changed before match attachment: ' + kind);
    this.name = 'SearchAttachTransitionError';
    this.kind = kind;
  }
}

export async function getSearch(pool, identity, searchId, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId || !isSearchId(searchId)) return { status: 404, code: 'search-not-found' };
  const nowUtc = asDate(deps.clock());
  const search = await deps.repository.getSearch(pool, { searchId, playerId, nowUtc });
  return responseForSearchState(pool, playerId, search, deps, 'read');
}

export async function cancelSearch(pool, identity, searchId, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId || !isSearchId(searchId)) return { status: 404, code: 'search-not-found' };
  const nowUtc = asDate(deps.clock());
  const result = await deps.withTransaction(pool, (transaction) => deps.repository.cancelSearch(transaction, {
    searchId,
    playerId,
    nowUtc,
    retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
  }));
  if (result.kind === 'not-found') return { status: 404, code: 'search-not-found' };
  if (result.kind === 'already-started') {
    return { status: 409, searchId, state: 'started', code: 'match-already-started' };
  }
  return { status: 200, searchId, state: result.row?.Status ?? result.kind };
}

export async function startMatch(pool, identity, matchId, body, dependencies) {
  const deps = dependenciesWithDefaults(dependencies);
  if (!isMatchId(matchId)) return { status: 404, code: 'match-not-found' };
  let request;
  try {
    request = validateStartSearchRequest(body);
  } catch (error) {
    if (error instanceof PvpValidationError) return { status: 400, code: error.code };
    throw error;
  }
  const playerId = await deps.repository.findPlayerIdByIdentity(pool, identity);
  if (!playerId) return { status: 404, code: 'match-not-found' };
  const nowUtc = asDate(deps.clock());
  const result = await deps.withTransaction(pool, (transaction) => deps.repository.startSearchMatch(transaction, {
    searchId: request.searchId,
    matchId,
    playerId,
    nowUtc,
    retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
  }));
  if (result.kind === 'not-found') return { status: 404, code: 'match-not-found' };
  if (result.kind === 'cancelled') return { status: 409, searchId: request.searchId, state: 'cancelled', code: 'search-cancelled' };
  if (result.kind !== 'started') {
    if (result.kind === 'expired') return { status: 410, searchId: request.searchId, matchId, state: 'expired', code: 'match-expired' };
    return { status: 409, searchId: request.searchId, state: result.row?.Status ?? result.kind, code: 'match-not-available' };
  }
  const ticketRow = await deps.repository.loadSearchTicket(pool, { searchId: request.searchId, playerId });
  if (!ticketRow || asDate(ticketRow.ExpiresAtUtc).getTime() <= nowUtc.getTime()) {
    await deps.withTransaction(pool, (transaction) => deps.repository.expireSearchMatch(transaction, {
      searchId: request.searchId,
      playerId,
      nowUtc,
      retainUntilUtc: new Date(nowUtc.getTime() + SEARCH_RETENTION_MS),
    }));
    return { status: 410, searchId: request.searchId, matchId, state: 'expired', code: 'match-expired' };
  }
  return { status: 200, searchId: request.searchId, matchId, state: 'started' };
}

export function createMatchmakingService(dependencies = {}) {
  return {
    findOpponent: (pool, identity, body) => findOpponent(pool, identity, body, dependencies),
    getSearch: (pool, identity, searchId) => getSearch(pool, identity, searchId, dependencies),
    cancelSearch: (pool, identity, searchId) => cancelSearch(pool, identity, searchId, dependencies),
    startMatch: (pool, identity, matchId, body) => startMatch(pool, identity, matchId, body, dependencies),
  };
}
