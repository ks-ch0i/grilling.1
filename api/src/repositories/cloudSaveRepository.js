import sql from 'mssql';

const GUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function requireIdentity(identity) {
  if (!GUID_PATTERN.test(identity?.tenantId ?? '') || !GUID_PATTERN.test(identity?.objectId ?? '')) {
    throw new TypeError('Authenticated Entra identity is invalid.');
  }
}

function bindSaveValues(request, input) {
  request.input('PlayerId', sql.UniqueIdentifier, input.playerId);
  request.input('SchemaVersion', sql.Int, input.schemaVersion);
  request.input('SaveJson', sql.NVarChar(sql.MAX), input.saveJson);
  request.input('UpdatedAtUtc', sql.DateTime2, input.updatedAtUtc);
  return request;
}

export async function findPlayerIdByIdentity(pool, identity) {
  requireIdentity(identity);
  const result = await pool.request()
    .input('TenantId', sql.UniqueIdentifier, identity.tenantId)
    .input('ObjectId', sql.UniqueIdentifier, identity.objectId)
    .query(`
      SELECT PlayerId
      FROM dbo.Players
      WHERE TenantId = @TenantId AND ObjectId = @ObjectId;
    `);
  return result.recordset?.[0]?.PlayerId ?? null;
}

export async function getOrCreatePlayerId(pool, identity) {
  requireIdentity(identity);
  const displayName = typeof identity.displayName === 'string' ? identity.displayName.slice(0, 100) : null;
  const result = await pool.request()
    .input('TenantId', sql.UniqueIdentifier, identity.tenantId)
    .input('ObjectId', sql.UniqueIdentifier, identity.objectId)
    .input('DisplayName', sql.NVarChar(100), displayName)
    .query(`
      SET NOCOUNT ON;
      DECLARE @PlayerId uniqueidentifier;
      SELECT @PlayerId = PlayerId
      FROM dbo.Players WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @TenantId AND ObjectId = @ObjectId;

      IF @PlayerId IS NULL
      BEGIN
        DECLARE @InsertedPlayer TABLE (PlayerId uniqueidentifier);
        INSERT dbo.Players (TenantId, ObjectId, DisplayName)
        OUTPUT inserted.PlayerId INTO @InsertedPlayer
        VALUES (@TenantId, @ObjectId, @DisplayName);
        SELECT @PlayerId = PlayerId FROM @InsertedPlayer;
      END
      ELSE
      BEGIN
        UPDATE dbo.Players
        SET DisplayName = COALESCE(@DisplayName, DisplayName), UpdatedAtUtc = SYSUTCDATETIME()
        WHERE PlayerId = @PlayerId;
      END;

      SELECT @PlayerId AS PlayerId;
    `);
  const playerId = result.recordset?.at(-1)?.PlayerId;
  if (!playerId) throw new Error('Player identity could not be resolved.');
  return playerId;
}

export async function getByPlayerId(pool, playerId) {
  const result = await pool.request()
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      SELECT SchemaVersion, Revision, SaveJson, UpdatedAtUtc
      FROM dbo.CloudSaves
      WHERE PlayerId = @PlayerId;
    `);
  return result.recordset?.[0] ?? null;
}

export async function insertInitial(transaction, input) {
  const result = await bindSaveValues(new sql.Request(transaction), input).query(`
    INSERT dbo.CloudSaves (PlayerId, SchemaVersion, Revision, SaveJson, UpdatedAtUtc)
    OUTPUT inserted.SchemaVersion, inserted.Revision, inserted.SaveJson, inserted.UpdatedAtUtc
    VALUES (@PlayerId, @SchemaVersion, 1, @SaveJson, @UpdatedAtUtc);
  `);
  return result.recordset?.[0] ?? null;
}

export async function compareAndSwap(transaction, input) {
  const request = bindSaveValues(new sql.Request(transaction), input)
    .input('ExpectedRevision', sql.BigInt, input.expectedRevision);
  const result = await request.query(`
    UPDATE dbo.CloudSaves
    SET SchemaVersion = @SchemaVersion,
        Revision = Revision + 1,
        SaveJson = @SaveJson,
        UpdatedAtUtc = @UpdatedAtUtc
    OUTPUT inserted.SchemaVersion, inserted.Revision, inserted.SaveJson, inserted.UpdatedAtUtc
    WHERE PlayerId = @PlayerId AND Revision = @ExpectedRevision;
  `);
  return result.recordset?.[0] ?? null;
}
