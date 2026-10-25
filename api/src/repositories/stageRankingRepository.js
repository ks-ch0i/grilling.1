import sql from 'mssql';
import * as cloudSaveRepository from './cloudSaveRepository.js';
import * as playerProfileRepository from './playerProfileRepository.js';
import { parseCloudSave } from '../domain/cloudSave.js';
import { mergeRewardProfile, parseRewardProfile } from '../domain/playerProfile.js';

const TICKET_COLUMNS = `RunId, PlayerId, Chapter, Stage, Seed, SimulatorVersion,
  BalanceVersion, PlayerSnapshotJson, IssuedAtUtc, ExpiresAtUtc, Status,
  CompletedAtUtc, InputJson, Outcome, RewardJson`;
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
    .input('SimulatorVersion', sql.Int, input.simulatorVersion)
    .input('BalanceVersion', sql.Int, input.balanceVersion)
    .query(`
      UPDATE dbo.StageRunTickets
      SET Status = N'expired'
      WHERE PlayerId = @PlayerId AND Status = N'issued' AND
        (ExpiresAtUtc <= @NowUtc OR SimulatorVersion <> @SimulatorVersion OR BalanceVersion <> @BalanceVersion);
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

async function readCurrentSave(transaction, playerId) {
  const saveRow = await cloudSaveRepository.getSaveForUpdate(transaction, playerId);
  if (!saveRow) throw new Error('Stage reward CloudSave row is missing.');
  const profileRow = await playerProfileRepository.getRewardProfileByPlayerId(
    transaction, playerId, { lock: true },
  );
  const profile = parseRewardProfile(profileRow);
  return { profile, envelope: parseCloudSave(saveRow, profile) };
}

function rewardSummaryFrom(value) {
  const summary = typeof value === 'string' ? JSON.parse(value) : value;
  if (!summary || !['clear', 'death'].includes(summary.outcome) ||
      !Number.isSafeInteger(summary.xpGranted) || summary.xpGranted < 0 ||
      !Number.isSafeInteger(summary.goldGranted) || summary.goldGranted < 0 ||
      !Array.isArray(summary.drops)) {
    throw new TypeError('Stored stage reward summary is invalid.');
  }
  return summary;
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
  if (existing.Status !== 'issued') {
    if (existing.RewardJson && existing.InputJson === input.inputJson && existing.Status === 'completed') {
      const current = await readCurrentSave(transaction, input.playerId);
      return {
        kind: 'completed',
        row: existing,
        bestChanged: false,
        revision: current.envelope.revision,
        state: current.envelope.state,
        rewardSummary: rewardSummaryFrom(existing.RewardJson),
      };
    }
    return { kind: existing.Status, row: existing };
  }
  if (new Date(existing.ExpiresAtUtc).getTime() <= input.completedAtUtc.getTime()) {
    await expireTicket(transaction, input.playerId, input.runId);
    return { kind: 'expired', row: { ...existing, Status: 'expired' } };
  }

  const current = await readCurrentSave(transaction, input.playerId);
  let rewardApplication = null;
  let updatedEnvelope = null;
  if (input.outcome === 'clear' || input.outcome === 'death') {
    if (typeof input.resolveRewards !== 'function') {
      throw new TypeError('A validated stage reward resolver is required for terminal runs.');
    }
    rewardApplication = input.resolveRewards({
      ticket: ticketForRewardResolution(existing),
      profile: current.profile,
      state: current.envelope.state,
    });
    if (!rewardApplication?.profile || !rewardApplication.rewardSummary) {
      throw new TypeError('Stage reward resolver returned an invalid profile patch.');
    }
    const nextState = mergeRewardProfile(current.envelope.state, rewardApplication.profile);
    const saved = await cloudSaveRepository.compareAndSwap(transaction, {
      playerId: input.playerId,
      schemaVersion: 2,
      saveJson: JSON.stringify(nextState),
      updatedAtUtc: input.completedAtUtc,
      expectedRevision: current.envelope.revision,
      rewardProfile: rewardApplication.profile,
    });
    if (!saved) throw new Error('Stage reward CloudSave compare-and-swap failed while locked.');
    updatedEnvelope = parseCloudSave(saved, rewardApplication.profile);
  }

  const update = await new sql.Request(transaction)
    .input('RunId', sql.UniqueIdentifier, input.runId)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('InputJson', sql.NVarChar(sql.MAX), input.inputJson)
    .input('Outcome', sql.NVarChar(16), input.outcome)
    .input('Status', sql.NVarChar(16), input.outcome === 'clear' || input.outcome === 'death' ? 'completed' : 'rejected')
    .input('CompletedAtUtc', sql.DateTime2, input.completedAtUtc)
    .input('RewardJson', sql.NVarChar(sql.MAX), rewardApplication ? JSON.stringify(rewardApplication.rewardSummary) : null)
    .query(`
      UPDATE dbo.StageRunTickets
      SET InputJson = @InputJson, Outcome = @Outcome, Status = @Status,
          CompletedAtUtc = @CompletedAtUtc, RewardJson = @RewardJson
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
  return {
    kind: input.outcome === 'invalid' || input.outcome === 'incomplete' ? 'rejected' : 'completed',
    row: completedRow,
    bestChanged,
    topFive,
    ...(rewardApplication ? {
      revision: updatedEnvelope.revision,
      state: updatedEnvelope.state,
      rewardSummary: rewardSummaryFrom(rewardApplication.rewardSummary),
    } : {}),
  };
}

export async function getTopFive(pool) {
  return selectTopFive(pool.request());
}

export async function getPlayerRank(pool, playerId) {
  const result = await pool.request()
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      WITH RankedStages AS (
        SELECT PlayerId,
          ROW_NUMBER() OVER (ORDER BY Chapter DESC, Stage DESC, ClearTimeMs ASC, PlayerId ASC) AS Rank
        FROM dbo.StageBests
      )
      SELECT sb.Chapter, sb.Stage, sb.ClearTimeMs, ranked.Rank
      FROM dbo.StageBests AS sb
      INNER JOIN RankedStages AS ranked ON ranked.PlayerId = sb.PlayerId
      WHERE sb.PlayerId = @PlayerId;
    `);
  return result.recordset?.[0] ?? null;
}
