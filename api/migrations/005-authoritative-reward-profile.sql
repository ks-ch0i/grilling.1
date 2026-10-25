-- Preserve existing unverified saves before seeding canonical reward profiles.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 5)
BEGIN
  CREATE TABLE dbo.LegacySaveArchives (
    ArchiveId uniqueidentifier NOT NULL CONSTRAINT PK_LegacySaveArchives PRIMARY KEY,
    PlayerId uniqueidentifier NOT NULL,
    OriginalRevision bigint NOT NULL,
    OriginalSaveJson nvarchar(max) NOT NULL,
    ArchivedAtUtc datetime2(7) NOT NULL,
    Reason nvarchar(32) NOT NULL,
    CONSTRAINT FK_LegacySaveArchives_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId)
  );

  CREATE UNIQUE INDEX UX_LegacySaveArchives_Player_Migration
    ON dbo.LegacySaveArchives (PlayerId)
    WHERE Reason = N'schema-v5-migration';

  CREATE TABLE dbo.PlayerRewardProfiles (
    PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_PlayerRewardProfiles PRIMARY KEY,
    Level int NOT NULL,
    Xp decimal(16, 0) NOT NULL,
    XpToNext decimal(16, 0) NOT NULL,
    PendingLevelUps int NOT NULL,
    Gold decimal(16, 0) NOT NULL,
    Materials decimal(16, 0) NOT NULL,
    InventoryJson nvarchar(max) NOT NULL,
    Chapter int NOT NULL,
    CurrentStage int NOT NULL,
    UnlockedChapter int NOT NULL,
    UnlockedStage int NOT NULL,
    ClearedStageIdsJson nvarchar(max) NOT NULL,
    UpdatedAtUtc datetime2(7) NOT NULL,
    CONSTRAINT FK_PlayerRewardProfiles_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
    CONSTRAINT CK_PlayerRewardProfiles_Level CHECK (Level >= 1),
    CONSTRAINT CK_PlayerRewardProfiles_Xp CHECK (Xp >= 0),
    CONSTRAINT CK_PlayerRewardProfiles_XpToNext CHECK (XpToNext >= 1),
    CONSTRAINT CK_PlayerRewardProfiles_PendingLevelUps CHECK (PendingLevelUps >= 0),
    CONSTRAINT CK_PlayerRewardProfiles_Gold CHECK (Gold >= 0),
    CONSTRAINT CK_PlayerRewardProfiles_Materials CHECK (Materials >= 0),
    CONSTRAINT CK_PlayerRewardProfiles_InventoryJson CHECK (ISJSON(InventoryJson) = 1),
    CONSTRAINT CK_PlayerRewardProfiles_Chapter CHECK (Chapter >= 1),
    CONSTRAINT CK_PlayerRewardProfiles_CurrentStage CHECK (CurrentStage BETWEEN 1 AND 10),
    CONSTRAINT CK_PlayerRewardProfiles_UnlockedChapter CHECK (UnlockedChapter >= 1),
    CONSTRAINT CK_PlayerRewardProfiles_UnlockedStage CHECK (UnlockedStage BETWEEN 1 AND 10),
    CONSTRAINT CK_PlayerRewardProfiles_ClearedStageIdsJson CHECK (ISJSON(ClearedStageIdsJson) = 1)
  );

  INSERT dbo.LegacySaveArchives
    (ArchiveId, PlayerId, OriginalRevision, OriginalSaveJson, ArchivedAtUtc, Reason)
  SELECT NEWID(), save.PlayerId, save.Revision, save.SaveJson, SYSUTCDATETIME(), N'schema-v5-migration'
  FROM dbo.CloudSaves AS save
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.LegacySaveArchives AS archive
    WHERE archive.PlayerId = save.PlayerId AND archive.Reason = N'schema-v5-migration'
  );

  INSERT dbo.PlayerRewardProfiles
    (PlayerId, Level, Xp, XpToNext, PendingLevelUps, Gold, Materials, InventoryJson,
     Chapter, CurrentStage, UnlockedChapter, UnlockedStage, ClearedStageIdsJson, UpdatedAtUtc)
  SELECT save.PlayerId, 1, 0, 100, 0, 0, 0, N'[]', 1, 1, 1, 1, N'[]', SYSUTCDATETIME()
  FROM dbo.CloudSaves AS save
  WHERE NOT EXISTS (
    SELECT 1 FROM dbo.PlayerRewardProfiles AS profile WHERE profile.PlayerId = save.PlayerId
  );

  INSERT dbo.SchemaVersions (Version, Name)
  VALUES (5, N'authoritative-reward-profile');
END;

COMMIT TRANSACTION;
