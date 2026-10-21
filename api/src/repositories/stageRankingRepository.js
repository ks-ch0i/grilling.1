import sql from 'mssql';

const TICKET_COLUMNS = `RunId, PlayerId, Chapter, Stage, Seed, SimulatorVersion,
  BalanceVersion, PlayerSnapshotJson, IssuedAtUtc, ExpiresAtUtc, Status,
  CompletedAtUtc, InputJson, Outcome`;
const TICKET_OUTPUT_COLUMNS = TICKET_COLUMNS.split(',').map((column) => `inserted.${column.trim()}`).join(', ');

function queryTicket(request, lock = false) {
  return request.query(`
    SELECT ${TICKET_COLUMNS}
    FROM dbo.StageRunTickets${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
    WHERE RunId = @RunId AND PlayerId = @PlayerId;
  `);
}

export async function createTicket(transaction, input) {
  const playerLock = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .query(`SELECT PlayerId FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId;`);
  if (!playerLock.recordset?.[0]) return { kind: 'missing-player' };

  const save = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .query(`
      SELECT SchemaVersion, Revision, SaveJson, UpdatedAtUtc
      FROM dbo.CloudSaves WITH (UPDLOCK, HOLDLOCK)
      WHERE PlayerId = @PlayerId;
    `);
  const saveRow = save.recordset?.[0];
  if (!saveRow) return { kind: 'missing-save' };
  const currentRevision = Number(saveRow.Revision);
  if (currentRevision !== input.expectedSaveRevision) return { kind: 'revision-mismatch', currentRevision };

  await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('NowUtc', sql.DateTime2, input.issuedAtUtc)
    .query(`
      UPDATE dbo.StageRunTickets
      SET Status = N'expired'
      WHERE PlayerId = @PlayerId AND Status = N'issued' AND ExpiresAtUtc <= @NowUtc;
    `);

  const active = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('NowUtc', sql.DateTime2, input.issuedAtUtc)
    .query(`
      SELECT TOP (1) RunId, ExpiresAtUtc
      FROM dbo.StageRunTickets WITH (UPDLOCK, HOLDLOCK)
      WHERE PlayerId = @PlayerId AND Status = N'issued' AND ExpiresAtUtc > @NowUtc;
    `);
  if (active.recordset?.[0]) return { kind: 'active-ticket', runId: active.recordset[0].RunId };

  const result = await new sql.Request(transaction)
    .input('RunId', sql.UniqueIdentifier, input.runId)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('Chapter', sql.Int, input.chapter)
    .input('Stage', sql.Int, input.stage)
    .input('Seed', sql.BigInt, input.seed)
    .input('SimulatorVersion', sql.Int, input.simulatorVersion)
    .input('BalanceVersion', sql.Int, input.balanceVersion)
    .input('PlayerSnapshotJson', sql.NVarChar(sql.MAX), JSON.stringify(input.playerSnapshot))
    .input('IssuedAtUtc', sql.DateTime2, input.issuedAtUtc)
    .input('ExpiresAtUtc', sql.DateTime2, input.expiresAtUtc)
    .query(`
      INSERT dbo.StageRunTickets
        (RunId, PlayerId, Chapter, Stage, Seed, SimulatorVersion, BalanceVersion,
         PlayerSnapshotJson, IssuedAtUtc, ExpiresAtUtc, Status)
      OUTPUT ${TICKET_OUTPUT_COLUMNS}
      VALUES
        (@RunId, @PlayerId, @Chapter, @Stage, @Seed, @SimulatorVersion, @BalanceVersion,
         @PlayerSnapshotJson, @IssuedAtUtc, @ExpiresAtUtc, N'issued');
    `);
  return { kind: 'created', row: result.recordset?.[0] ?? null };
}

export async function getTicketByPlayerId(pool, playerId, runId) {
  const result = await queryTicket(pool.request()
    .input('RunId', sql.UniqueIdentifier, runId)
    .input('PlayerId', sql.UniqueIdentifier, playerId));
  return result.recordset?.[0] ?? null;
}

export async function expireTicket(transaction, playerId, runId) {
  await new sql.Request(transaction)
    .input('RunId', sql.UniqueIdentifier, runId)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      UPDATE dbo.StageRunTickets
      SET Status = N'expired'
      WHERE RunId = @RunId AND PlayerId = @PlayerId AND Status = N'issued';
    `);
}

async function selectTopFive(request) {
  const result = await request.query(`
    SELECT TOP (5)
      sb.PlayerId,
      COALESCE(p.DisplayName, N'Adventurer') AS DisplayName,
      sb.Chapter,
      sb.Stage,
      sb.ClearTimeMs
    FROM dbo.StageBests AS sb
    INNER JOIN dbo.Players AS p ON p.PlayerId = sb.PlayerId
    ORDER BY sb.Chapter DESC, sb.Stage DESC, sb.ClearTimeMs ASC, sb.PlayerId ASC;
  `);
  return result.recordset ?? [];
}

export async function completeRun(transaction, input) {
  const playerLock = await new sql.Request(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .query(`SELECT PlayerId FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId;`);
  if (!playerLock.recordset?.[0]) return { kind: 'not-found' };

  const ticketResult = await queryTicket(new sql.Request(transaction)
    .input('RunId', sql.UniqueIdentifier, input.runId)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId), true);
  const existing = ticketResult.recordset?.[0];
  if (!existing) return { kind: 'not-found' };
  if (existing.Status !== 'issued') return { kind: existing.Status, row: existing };
  if (new Date(existing.ExpiresAtUtc).getTime() <= input.completedAtUtc.getTime()) {
    await expireTicket(transaction, input.playerId, input.runId);
    return { kind: 'expired', row: { ...existing, Status: 'expired' } };
  }

  const update = await new sql.Request(transaction)
    .input('RunId', sql.UniqueIdentifier, input.runId)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('InputJson', sql.NVarChar(sql.MAX), input.inputJson)
    .input('Outcome', sql.NVarChar(16), input.outcome)
    .input('Status', sql.NVarChar(16), input.outcome === 'clear' ? 'completed' : 'rejected')
    .input('CompletedAtUtc', sql.DateTime2, input.completedAtUtc)
    .query(`
      UPDATE dbo.StageRunTickets
      SET InputJson = @InputJson, Outcome = @Outcome, Status = @Status, CompletedAtUtc = @CompletedAtUtc
      OUTPUT ${TICKET_OUTPUT_COLUMNS}
      WHERE RunId = @RunId AND PlayerId = @PlayerId AND Status = N'issued';
    `);
  const completedRow = update.recordset?.[0];
  if (!completedRow) {
    const latest = await queryTicket(new sql.Request(transaction)
      .input('RunId', sql.UniqueIdentifier, input.runId)
      .input('PlayerId', sql.UniqueIdentifier, input.playerId), true);
    const row = latest.recordset?.[0];
    return row ? { kind: row.Status, row } : { kind: 'not-found' };
  }

  let bestChanged = false;
  if (input.outcome === 'clear') {
    const current = await new sql.Request(transaction)
      .input('PlayerId', sql.UniqueIdentifier, input.playerId)
      .query(`
        SELECT Chapter, Stage, ClearTimeMs, RunId
        FROM dbo.StageBests WITH (UPDLOCK, HOLDLOCK)
        WHERE PlayerId = @PlayerId;
      `);
    const old = current.recordset?.[0];
    const oldOrdinal = old ? Number(old.Chapter) * 10 + Number(old.Stage) : -1;
    const nextOrdinal = input.chapter * 10 + input.stage;
    bestChanged = !old || nextOrdinal > oldOrdinal ||
      (nextOrdinal === oldOrdinal && input.clearTimeMs < Number(old.ClearTimeMs));
    if (bestChanged && old) {
      await new sql.Request(transaction)
        .input('PlayerId', sql.UniqueIdentifier, input.playerId)
        .input('Chapter', sql.Int, input.chapter)
        .input('Stage', sql.Int, input.stage)
        .input('ClearTimeMs', sql.BigInt, input.clearTimeMs)
        .input('RunId', sql.UniqueIdentifier, input.runId)
        .input('UpdatedAtUtc', sql.DateTime2, input.completedAtUtc)
        .query(`
          UPDATE dbo.StageBests
          SET Chapter = @Chapter, Stage = @Stage, ClearTimeMs = @ClearTimeMs,
              RunId = @RunId, UpdatedAtUtc = @UpdatedAtUtc
          WHERE PlayerId = @PlayerId;
        `);
    } else if (bestChanged) {
      await new sql.Request(transaction)
        .input('PlayerId', sql.UniqueIdentifier, input.playerId)
        .input('Chapter', sql.Int, input.chapter)
        .input('Stage', sql.Int, input.stage)
        .input('ClearTimeMs', sql.BigInt, input.clearTimeMs)
        .input('RunId', sql.UniqueIdentifier, input.runId)
        .input('UpdatedAtUtc', sql.DateTime2, input.completedAtUtc)
        .query(`
          INSERT dbo.StageBests (PlayerId, Chapter, Stage, ClearTimeMs, RunId, UpdatedAtUtc)
          VALUES (@PlayerId, @Chapter, @Stage, @ClearTimeMs, @RunId, @UpdatedAtUtc);
        `);
    }
  }

  const topFive = bestChanged ? await selectTopFive(new sql.Request(transaction)) : [];
  return { kind: 'completed', row: completedRow, bestChanged, topFive };
}

export async function getTopFive(pool) {
  return selectTopFive(pool.request());
}
