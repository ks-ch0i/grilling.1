import sql from 'mssql';

function requestFor(connection) {
  return typeof connection?.request === 'function' ? connection.request() : new sql.Request(connection);
}

export async function lockPlayer(transaction, playerId) {
  const result = await requestFor(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`SELECT PlayerId FROM dbo.Players WITH (UPDLOCK, HOLDLOCK) WHERE PlayerId = @PlayerId;`);
  return Boolean(result.recordset?.[0]);
}

export async function getProfileAction(transaction, playerId, actionId, { lock = false } = {}) {
  const result = await requestFor(transaction)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .input('ActionId', sql.UniqueIdentifier, actionId)
    .query(`
      SELECT PlayerId, ActionId, RequestJson, ResultJson, AppliedAtUtc
      FROM dbo.PlayerProfileActions${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
      WHERE PlayerId = @PlayerId AND ActionId = @ActionId;
    `);
  return result.recordset?.[0] ?? null;
}

export async function insertProfileAction(transaction, input) {
  const result = await requestFor(transaction)
    .input('PlayerId', sql.UniqueIdentifier, input.playerId)
    .input('ActionId', sql.UniqueIdentifier, input.actionId)
    .input('RequestJson', sql.NVarChar(2048), input.requestJson)
    .input('ResultJson', sql.NVarChar(sql.MAX), input.resultJson)
    .input('AppliedAtUtc', sql.DateTime2, input.appliedAtUtc)
    .query(`
      INSERT dbo.PlayerProfileActions (PlayerId, ActionId, RequestJson, ResultJson, AppliedAtUtc)
      OUTPUT inserted.PlayerId, inserted.ActionId, inserted.RequestJson, inserted.ResultJson, inserted.AppliedAtUtc
      VALUES (@PlayerId, @ActionId, @RequestJson, @ResultJson, @AppliedAtUtc);
    `);
  return result.recordset?.[0] ?? null;
}
