import sql from 'mssql';
import { calculateElo } from '../domain/pvpRating.js';

function requestFor(connection) {
  return typeof connection?.request === 'function' ? connection.request() : new sql.Request(connection);
}

const MATCH_COLUMNS = `MatchId, Player1Id, Player2Id, Player1SnapshotRevision, Player2SnapshotRevision,
  Player1SnapshotJson, Player2SnapshotJson, Seed, SimulatorVersion, InputJson, Outcome,
  RatingBefore1, RatingBefore2, RatingAfter1, RatingAfter2, IssuedAtUtc, ExpiresAtUtc,
  CompletedAtUtc, Status`;
const MATCH_OUTPUT_COLUMNS = MATCH_COLUMNS.split(',').map((column) => `inserted.${column.trim()}`).join(', ');

export async function getPlayerSnapshot(connection, playerId, { lock = false } = {}) {
  const request = requestFor(connection).input('PlayerId', sql.UniqueIdentifier, playerId);
  const result = await request.query(`
    SELECT PlayerId, Revision, SnapshotJson, UpdatedAtUtc
    FROM dbo.PlayerSnapshots${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE PlayerId = @PlayerId;
  `);
  return result.recordset?.[0] ?? null;
}

export async function getCloudSaveForUpdate(transaction, playerId) {
  const result = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      SELECT SchemaVersion, Revision, SaveJson, UpdatedAtUtc
      FROM dbo.CloudSaves WITH (UPDLOCK, HOLDLOCK)
      WHERE PlayerId = @PlayerId;
    `);
  return result.recordset?.[0] ?? null;
}

export async function savePlayerSnapshot(transaction, input) {
  const result = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('Revision', sql.BigInt, input.revision)
    .input('SnapshotJson', sql.NVarChar(sql.MAX), input.snapshotJson)
    .input('UpdatedAtUtc', sql.DateTime2, input.updatedAtUtc)
    .query(`
      IF EXISTS (SELECT 1 FROM dbo.PlayerSnapshots WHERE PlayerId = @PlayerId)
      BEGIN
        UPDATE dbo.PlayerSnapshots
        SET Revision = @Revision, SnapshotJson = @SnapshotJson, UpdatedAtUtc = @UpdatedAtUtc
        OUTPUT inserted.PlayerId, inserted.Revision, inserted.SnapshotJson, inserted.UpdatedAtUtc
        WHERE PlayerId = @PlayerId;
      END
      ELSE
      BEGIN
        INSERT dbo.PlayerSnapshots (PlayerId, Revision, SnapshotJson, UpdatedAtUtc)
        OUTPUT inserted.PlayerId, inserted.Revision, inserted.SnapshotJson, inserted.UpdatedAtUtc
        VALUES (@PlayerId, @Revision, @SnapshotJson, @UpdatedAtUtc);
      END;
    `);
  return result.recordset?.[0] ?? null;
}

export async function lockPlayers(transaction, playerIds) {
  const result = await new sql.Request(transaction)
    .input('Player1Id', sql.UniqueIdentifier, playerIds[0])
    .input('Player2Id', sql.UniqueIdentifier, playerIds[1])
    .query(`
      SELECT PlayerId
      FROM dbo.Players WITH (UPDLOCK, HOLDLOCK)
      WHERE PlayerId IN (@Player1Id, @Player2Id)
      ORDER BY PlayerId;
    `);
  return result.recordset ?? [];
}

export async function lockPlayer(transaction, playerId) {
  const result = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`SELECT PlayerId FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId;`);
  return Boolean(result.recordset?.[0]);
}

export async function getRating(pool, playerId) {
  const result = await pool.request()
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`SELECT COALESCE((SELECT Rating FROM dbo.PvpRatings WHERE PlayerId = @PlayerId), 1000) AS Rating;`);
  return Number(result.recordset?.[0]?.Rating ?? 1000);
}

export async function findOpponentCandidate(pool, input) {
  const result = await pool.request()
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('PlayerRating', sql.Int, input.playerRating)
    .input('MinRating', sql.Int, input.playerRating - input.window)
    .input('MaxRating', sql.Int, input.playerRating + input.window)
    .input('NowUtc', sql.DateTime2, input.nowUtc)
    .query(`
      SELECT TOP (1)
        p.PlayerId,
        COALESCE(p.DisplayName, N'Adventurer') AS DisplayName,
        ps.Revision AS SnapshotRevision,
        ps.SnapshotJson,
        COALESCE(r.Rating, 1000) AS Rating
      FROM dbo.PlayerSnapshots AS ps
      INNER JOIN dbo.Players AS p ON p.PlayerId = ps.PlayerId
      LEFT JOIN dbo.PvpRatings AS r ON r.PlayerId = p.PlayerId
      WHERE p.PlayerId <> @PlayerId
        AND COALESCE(r.Rating, 1000) BETWEEN @MinRating AND @MaxRating
        AND NOT EXISTS (
          SELECT 1 FROM dbo.PvpRatedPairDays AS pd
          WHERE pd.MatchDateUtc = CONVERT(date, @NowUtc)
            AND pd.LowPlayerId = CASE WHEN p.PlayerId < @PlayerId THEN p.PlayerId ELSE @PlayerId END
            AND pd.HighPlayerId = CASE WHEN p.PlayerId < @PlayerId THEN @PlayerId ELSE p.PlayerId END
        )
        AND NOT EXISTS (
          SELECT 1 FROM dbo.PvpMatches AS m
          WHERE m.Status = N'issued' AND m.ExpiresAtUtc > @NowUtc
            AND (m.Player1Id = p.PlayerId OR m.Player2Id = p.PlayerId
              OR m.Player1Id = @PlayerId OR m.Player2Id = @PlayerId)
        )
      ORDER BY ABS(COALESCE(r.Rating, 1000) - @PlayerRating), p.PlayerId;
    `);
  const row = result.recordset?.[0];
  if (!row) return null;
  return {
    playerId: row.PlayerId,
    displayName: row.DisplayName,
    snapshotRevision: Number(row.SnapshotRevision),
    snapshot: typeof row.SnapshotJson === 'string' ? JSON.parse(row.SnapshotJson) : row.SnapshotJson,
    rating: Number(row.Rating),
  };
}

async function ensureRating(transaction, playerId, nowUtc) {
  await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .input('NowUtc', sql.DateTime2, nowUtc)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.PvpRatings WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId)
        INSERT dbo.PvpRatings (PlayerId, Rating, UpdatedAtUtc) VALUES (@PlayerId, 1000, @NowUtc);
    `);
  const result = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`SELECT Rating FROM dbo.PvpRatings WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId;`);
  return Number(result.recordset?.[0]?.Rating ?? 1000);
}

export async function createMatch(transaction, input) {
  const ids = [input.player1Id, input.player2Id];
  const lockedPlayers = await lockPlayers(transaction, ids);
  if (lockedPlayers.length !== 2) return { kind: 'missing-player' };

  const snapshots = await new sql.Request(transaction)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
    .query(`
      SELECT PlayerId, Revision, SnapshotJson
      FROM dbo.PlayerSnapshots WITH (UPDLOCK, HOLDLOCK)
      WHERE PlayerId IN (@Player1Id, @Player2Id);
    `);
  const snapshotById = new Map((snapshots.recordset ?? []).map((row) => [row.PlayerId, row]));
  const player1Snapshot = snapshotById.get(input.player1Id);
  const player2Snapshot = snapshotById.get(input.player2Id);
  if (!player1Snapshot || !player2Snapshot ||
      Number(player1Snapshot.Revision) !== input.player1SnapshotRevision ||
      Number(player2Snapshot.Revision) !== input.player2SnapshotRevision) {
    return { kind: 'snapshot-changed' };
  }

  const rating1 = await ensureRating(transaction, input.player1Id, input.issuedAtUtc);
  const rating2 = await ensureRating(transaction, input.player2Id, input.issuedAtUtc);
  if (Number.isInteger(input.window) && Math.abs(rating1 - rating2) > input.window) {
    return { kind: 'rating-changed' };
  }
  const pair = await new sql.Request(transaction)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
    .input('NowUtc', sql.DateTime2, input.issuedAtUtc)
    .query(`
      SELECT TOP (1) MatchId
      FROM dbo.PvpRatedPairDays WITH (UPDLOCK, HOLDLOCK)
      WHERE MatchDateUtc = CONVERT(date, @NowUtc)
        AND LowPlayerId = CASE WHEN @Player1Id < @Player2Id THEN @Player1Id ELSE @Player2Id END
        AND HighPlayerId = CASE WHEN @Player1Id < @Player2Id THEN @Player2Id ELSE @Player1Id END;
    `);
  if (pair.recordset?.[0]) return { kind: 'already-rated-pair' };

  const active = await new sql.Request(transaction)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
    .input('NowUtc', sql.DateTime2, input.issuedAtUtc)
    .query(`
      SELECT TOP (1) MatchId
      FROM dbo.PvpMatches WITH (UPDLOCK, HOLDLOCK)
      WHERE Status = N'issued' AND ExpiresAtUtc > @NowUtc
        AND (Player1Id IN (@Player1Id, @Player2Id) OR Player2Id IN (@Player1Id, @Player2Id));
    `);
  if (active.recordset?.[0]) return { kind: 'active-match' };

  const result = await new sql.Request(transaction)
    .input('MatchId', sql.UniqueIdentifier, input.matchId)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
    .input('Player1SnapshotRevision', sql.BigInt, input.player1SnapshotRevision)
    .input('Player2SnapshotRevision', sql.BigInt, input.player2SnapshotRevision)
    .input('Player1SnapshotJson', sql.NVarChar(sql.MAX), player1Snapshot.SnapshotJson)
    .input('Player2SnapshotJson', sql.NVarChar(sql.MAX), player2Snapshot.SnapshotJson)
    .input('Seed', sql.BigInt, input.seed)
    .input('SimulatorVersion', sql.Int, input.simulatorVersion)
    .input('RatingBefore1', sql.Int, rating1)
    .input('RatingBefore2', sql.Int, rating2)
    .input('IssuedAtUtc', sql.DateTime2, input.issuedAtUtc)
    .input('ExpiresAtUtc', sql.DateTime2, input.expiresAtUtc)
    .query(`
      INSERT dbo.PvpMatches
        (MatchId, Player1Id, Player2Id, Player1SnapshotRevision, Player2SnapshotRevision,
         Player1SnapshotJson, Player2SnapshotJson, Seed, SimulatorVersion,
         RatingBefore1, RatingBefore2, IssuedAtUtc, ExpiresAtUtc, Status)
      OUTPUT ${MATCH_OUTPUT_COLUMNS}
      VALUES
        (@MatchId, @Player1Id, @Player2Id, @Player1SnapshotRevision, @Player2SnapshotRevision,
         @Player1SnapshotJson, @Player2SnapshotJson, @Seed, @SimulatorVersion,
         @RatingBefore1, @RatingBefore2, @IssuedAtUtc, @ExpiresAtUtc, N'issued');
    `);
  return { kind: 'created', row: result.recordset?.[0] ?? null };
}

async function selectMatch(connection, player1Id, matchId, { lock = false } = {}) {
  const result = await requestFor(connection)
    .input('MatchId', sql.UniqueIdentifier, matchId)
    .input('Player1Id', sql.UniqueIdentifier, player1Id)
    .query(`
      SELECT m.${MATCH_COLUMNS.split(',').map((column) => column.trim()).join(', m.')},
        CAST(CASE WHEN pd.MatchId IS NULL THEN 0 ELSE 1 END AS bit) AS Rated
      FROM dbo.PvpMatches AS m${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
      LEFT JOIN dbo.PvpRatedPairDays AS pd ON pd.MatchId = m.MatchId
      WHERE m.MatchId = @MatchId AND m.Player1Id = @Player1Id;
    `);
  return result.recordset?.[0] ?? null;
}

export async function getMatchForPlayer(pool, player1Id, matchId) {
  return selectMatch(pool, player1Id, matchId);
}

export async function expireMatch(transaction, player1Id, matchId) {
  await new sql.Request(transaction)
    .input('MatchId', sql.UniqueIdentifier, matchId)
    .input('Player1Id', sql.UniqueIdentifier, player1Id)
    .query(`UPDATE dbo.PvpMatches SET Status = N'expired' WHERE MatchId = @MatchId AND Player1Id = @Player1Id AND Status = N'issued';`);
}

export async function rejectMatch(transaction, input) {
  const row = await selectMatch(transaction, input.player1Id, input.matchId, { lock: true });
  if (!row) return { kind: 'not-found' };
  if (row.Status !== 'issued') return { kind: row.Status, row };
  if (new Date(row.ExpiresAtUtc).getTime() <= input.completedAtUtc.getTime()) {
    await expireMatch(transaction, input.player1Id, input.matchId);
    return { kind: 'expired' };
  }
  await new sql.Request(transaction)
    .input('MatchId', sql.UniqueIdentifier, input.matchId)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('InputJson', sql.NVarChar(sql.MAX), input.inputJson)
    .input('CompletedAtUtc', sql.DateTime2, input.completedAtUtc)
    .query(`
      UPDATE dbo.PvpMatches
      SET InputJson = @InputJson, Outcome = N'invalid', Status = N'rejected', CompletedAtUtc = @CompletedAtUtc
      WHERE MatchId = @MatchId AND Player1Id = @Player1Id AND Status = N'issued';
    `);
  return { kind: 'rejected', row: await selectMatch(transaction, input.player1Id, input.matchId) };
}

export async function completeRatedMatch(transaction, input) {
  const lockedPlayers = await lockPlayers(transaction, [input.player1Id, input.player2Id]);
  if (lockedPlayers.length !== 2) return { kind: 'not-found' };
  const row = await selectMatch(transaction, input.player1Id, input.matchId, { lock: true });
  if (!row) return { kind: 'not-found' };
  if (row.Status !== 'issued') return { kind: row.Status, row };
  if (new Date(row.ExpiresAtUtc).getTime() <= input.completedAtUtc.getTime()) {
    await expireMatch(transaction, input.player1Id, input.matchId);
    return { kind: 'expired' };
  }

  const rating1 = await ensureRating(transaction, input.player1Id, input.completedAtUtc);
  const rating2 = await ensureRating(transaction, input.player2Id, input.completedAtUtc);
  const pair = await new sql.Request(transaction)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
    .input('MatchId', sql.UniqueIdentifier, input.matchId)
    .input('CompletedAtUtc', sql.DateTime2, input.completedAtUtc)
    .query(`
      SELECT TOP (1) MatchId
      FROM dbo.PvpRatedPairDays WITH (UPDLOCK, HOLDLOCK)
      WHERE MatchDateUtc = CONVERT(date, @CompletedAtUtc)
        AND LowPlayerId = CASE WHEN @Player1Id < @Player2Id THEN @Player1Id ELSE @Player2Id END
        AND HighPlayerId = CASE WHEN @Player1Id < @Player2Id THEN @Player2Id ELSE @Player1Id END;
    `);
  const rated = !pair.recordset?.[0];
  let ratingAfter1 = rating1;
  let ratingAfter2 = rating2;
  if (rated) {
    await new sql.Request(transaction)
      .input('MatchDateUtc', sql.Date, input.completedAtUtc)
      .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
      .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
      .input('MatchId', sql.UniqueIdentifier, input.matchId)
      .query(`
        INSERT dbo.PvpRatedPairDays (MatchDateUtc, LowPlayerId, HighPlayerId, MatchId)
        VALUES
          (CONVERT(date, @MatchDateUtc),
           CASE WHEN @Player1Id < @Player2Id THEN @Player1Id ELSE @Player2Id END,
           CASE WHEN @Player1Id < @Player2Id THEN @Player2Id ELSE @Player1Id END,
           @MatchId);
      `);
    if (input.outcome !== 'draw') {
      const next = calculateElo(rating1, rating2, input.outcome);
      ratingAfter1 = next.player1;
      ratingAfter2 = next.player2;
      await new sql.Request(transaction)
        .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
        .input('Player2Id', sql.UniqueIdentifier, input.player2Id)
        .input('RatingAfter1', sql.Int, ratingAfter1)
        .input('RatingAfter2', sql.Int, ratingAfter2)
        .input('UpdatedAtUtc', sql.DateTime2, input.completedAtUtc)
        .query(`
          UPDATE dbo.PvpRatings SET Rating = @RatingAfter1, UpdatedAtUtc = @UpdatedAtUtc WHERE PlayerId = @Player1Id;
          UPDATE dbo.PvpRatings SET Rating = @RatingAfter2, UpdatedAtUtc = @UpdatedAtUtc WHERE PlayerId = @Player2Id;
        `);
    }
  }

  await new sql.Request(transaction)
    .input('MatchId', sql.UniqueIdentifier, input.matchId)
    .input('Player1Id', sql.UniqueIdentifier, input.player1Id)
    .input('InputJson', sql.NVarChar(sql.MAX), input.inputJson)
    .input('Outcome', sql.NVarChar(16), input.outcome)
    .input('RatingBefore1', sql.Int, rating1)
    .input('RatingBefore2', sql.Int, rating2)
    .input('RatingAfter1', sql.Int, ratingAfter1)
    .input('RatingAfter2', sql.Int, ratingAfter2)
    .input('CompletedAtUtc', sql.DateTime2, input.completedAtUtc)
    .query(`
      UPDATE dbo.PvpMatches
      SET InputJson = @InputJson, Outcome = @Outcome,
          RatingBefore1 = @RatingBefore1, RatingBefore2 = @RatingBefore2,
          RatingAfter1 = @RatingAfter1, RatingAfter2 = @RatingAfter2,
          CompletedAtUtc = @CompletedAtUtc, Status = N'completed'
      WHERE MatchId = @MatchId AND Player1Id = @Player1Id AND Status = N'issued';
    `);
  return { kind: 'completed', changed: true, row: await selectMatch(transaction, input.player1Id, input.matchId) };
}

export async function getPvpTopFive(pool) {
  const result = await pool.request().query(`
    SELECT TOP (5)
      p.PlayerId,
      COALESCE(p.DisplayName, N'Adventurer') AS DisplayName,
      r.Rating,
      r.UpdatedAtUtc
    FROM dbo.PvpRatings AS r
    INNER JOIN dbo.Players AS p ON p.PlayerId = r.PlayerId
    ORDER BY r.Rating DESC, r.UpdatedAtUtc ASC, r.PlayerId ASC;
  `);
  return result.recordset ?? [];
}

export async function getPlayerRank(pool, playerId) {
  const result = await pool.request()
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      WITH RankedPvp AS (
        SELECT PlayerId,
          ROW_NUMBER() OVER (ORDER BY Rating DESC, UpdatedAtUtc ASC, PlayerId ASC) AS Rank
        FROM dbo.PvpRatings
      )
      SELECT ranked.Rank, COALESCE(rating.Rating, 1000) AS Rating
      FROM dbo.Players AS player
      LEFT JOIN RankedPvp AS ranked ON ranked.PlayerId = player.PlayerId
      LEFT JOIN dbo.PvpRatings AS rating ON rating.PlayerId = player.PlayerId
      WHERE player.PlayerId = @PlayerId;
    `);
  return result.recordset?.[0] ?? null;
}
