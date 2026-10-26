import sql from 'mssql';

function rowsAffected(result) {
  const value = Number(result.recordset?.[0]?.RowsAffected);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('PvP retention batch did not return a valid row count.');
  }
  return value;
}

function batchRequest(transaction, { nowUtc, batchSize }) {
  return new sql.Request(transaction)
    .input('NowUtc', sql.DateTime2, nowUtc)
    .input('BatchSize', sql.Int, batchSize);
}

export async function expireOverdueActiveMatchesBatch(transaction, input) {
  const result = await batchRequest(transaction, input).query(`
    UPDATE TOP (@BatchSize) dbo.PvpMatches
    SET Status = N'expired'
    WHERE Status IN (N'issued', N'started') AND ExpiresAtUtc <= @NowUtc;
    SELECT @@ROWCOUNT AS RowsAffected;
  `);
  return rowsAffected(result);
}

export async function deleteExpiredSearchBatch(transaction, input) {
  const result = await batchRequest(transaction, input).query(`
    DELETE TOP (@BatchSize) dbo.PvpMatchSearches
    WHERE Status IN (N'matched', N'started', N'cancelled', N'no-opponent', N'expired')
      AND RetainUntilUtc IS NOT NULL
      AND RetainUntilUtc <= @NowUtc;
    SELECT @@ROWCOUNT AS RowsAffected;
  `);
  return rowsAffected(result);
}

export async function deleteExpiredPayloadBatch(transaction, input) {
  const result = await batchRequest(transaction, input).query(`
    DELETE TOP (@BatchSize) payload
    FROM dbo.PvpMatchPayloads AS payload
    INNER JOIN dbo.PvpMatches AS match ON match.MatchId = payload.MatchId
    WHERE match.Status IN (N'completed', N'rejected', N'expired')
      AND COALESCE(match.CompletedAtUtc, match.ExpiresAtUtc) <= DATEADD(day, -90, @NowUtc);
    SELECT @@ROWCOUNT AS RowsAffected;
  `);
  return rowsAffected(result);
}

export async function deleteOldRatedPairDayBatch(transaction, input) {
  const result = await batchRequest(transaction, input).query(`
    DELETE TOP (@BatchSize) dbo.PvpRatedPairDays
    WHERE MatchDateUtc < CONVERT(date, @NowUtc);
    SELECT @@ROWCOUNT AS RowsAffected;
  `);
  return rowsAffected(result);
}
