import sql from 'mssql';

function requestFor(connection) {
  return typeof connection?.request === 'function' ? connection.request() : new sql.Request(connection);
}

function bindProfile(request, playerId, profile, nowUtc) {
  return request
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .input('Level', sql.Int, profile.level)
    .input('Xp', sql.Decimal(16, 0), profile.xp)
    .input('XpToNext', sql.Decimal(16, 0), profile.xpToNext)
    .input('PendingLevelUps', sql.Int, profile.pendingLevelUps)
    .input('Gold', sql.Decimal(16, 0), profile.gold)
    .input('Materials', sql.Decimal(16, 0), profile.materials)
    .input('InventoryJson', sql.NVarChar(sql.MAX), JSON.stringify(profile.inventory))
    .input('Chapter', sql.Int, profile.chapter)
    .input('CurrentStage', sql.Int, profile.currentStage)
    .input('UnlockedChapter', sql.Int, profile.unlockedChapter)
    .input('UnlockedStage', sql.Int, profile.unlockedStage)
    .input('ClearedStageIdsJson', sql.NVarChar(sql.MAX), JSON.stringify(profile.clearedStageIds))
    .input('UpdatedAtUtc', sql.DateTime2, nowUtc);
}

export async function getRewardProfileByPlayerId(connection, playerId, { lock = false } = {}) {
  const result = await requestFor(connection)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      SELECT PlayerId, Level, Xp, XpToNext, PendingLevelUps, Gold, Materials,
        InventoryJson, Chapter, CurrentStage, UnlockedChapter, UnlockedStage,
        ClearedStageIdsJson, UpdatedAtUtc
      FROM dbo.PlayerRewardProfiles${lock ? ' WITH (UPDLOCK, HOLDLOCK)' : ''}
      WHERE PlayerId = @PlayerId;
    `);
  return result.recordset?.[0] ?? null;
}

export async function createRewardProfile(transaction, playerId, profile, nowUtc) {
  const result = await bindProfile(new sql.Request(transaction), playerId, profile, nowUtc).query(`
    INSERT dbo.PlayerRewardProfiles
      (PlayerId, Level, Xp, XpToNext, PendingLevelUps, Gold, Materials, InventoryJson,
       Chapter, CurrentStage, UnlockedChapter, UnlockedStage, ClearedStageIdsJson, UpdatedAtUtc)
    OUTPUT inserted.PlayerId, inserted.Level, inserted.Xp, inserted.XpToNext,
      inserted.PendingLevelUps, inserted.Gold, inserted.Materials, inserted.InventoryJson,
      inserted.Chapter, inserted.CurrentStage, inserted.UnlockedChapter, inserted.UnlockedStage,
      inserted.ClearedStageIdsJson, inserted.UpdatedAtUtc
    VALUES (@PlayerId, @Level, @Xp, @XpToNext, @PendingLevelUps, @Gold, @Materials, @InventoryJson,
      @Chapter, @CurrentStage, @UnlockedChapter, @UnlockedStage, @ClearedStageIdsJson, @UpdatedAtUtc);
  `);
  return result.recordset?.[0] ?? null;
}

export async function updateRewardProfile(transaction, { playerId, profile, nowUtc }) {
  const result = await bindProfile(new sql.Request(transaction), playerId, profile, nowUtc).query(`
    UPDATE dbo.PlayerRewardProfiles
    SET Level = @Level, Xp = @Xp, XpToNext = @XpToNext, PendingLevelUps = @PendingLevelUps,
      Gold = @Gold, Materials = @Materials, InventoryJson = @InventoryJson,
      Chapter = @Chapter, CurrentStage = @CurrentStage, UnlockedChapter = @UnlockedChapter,
      UnlockedStage = @UnlockedStage, ClearedStageIdsJson = @ClearedStageIdsJson,
      UpdatedAtUtc = @UpdatedAtUtc
    OUTPUT inserted.PlayerId, inserted.Level, inserted.Xp, inserted.XpToNext,
      inserted.PendingLevelUps, inserted.Gold, inserted.Materials, inserted.InventoryJson,
      inserted.Chapter, inserted.CurrentStage, inserted.UnlockedChapter, inserted.UnlockedStage,
      inserted.ClearedStageIdsJson, inserted.UpdatedAtUtc
    WHERE PlayerId = @PlayerId;
  `);
  return result.recordset?.[0] ?? null;
}

export async function getLegacySaveArchiveByPlayerId(connection, playerId) {
  const result = await requestFor(connection)
    .input('PlayerId', sql.UniqueIdentifier, playerId)
    .query(`
      SELECT OriginalRevision, OriginalSaveJson, ArchivedAtUtc, Reason
      FROM dbo.LegacySaveArchives
      WHERE PlayerId = @PlayerId
      ORDER BY CASE WHEN Reason = N'schema-v5-migration' THEN 0 ELSE 1 END, ArchivedAtUtc DESC;
    `);
  return result.recordset?.[0] ?? null;
}
