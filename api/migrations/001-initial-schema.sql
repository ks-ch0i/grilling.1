-- Apply this migration once and record its version in dbo.SchemaVersions.
CREATE TABLE dbo.SchemaVersions (
  Version int NOT NULL CONSTRAINT PK_SchemaVersions PRIMARY KEY,
  Name nvarchar(100) NOT NULL,
  AppliedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_SchemaVersions_AppliedAtUtc DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Players (
  PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_Players PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
  TenantId uniqueidentifier NOT NULL,
  ObjectId uniqueidentifier NOT NULL,
  DisplayName nvarchar(100) NULL,
  CreatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Players_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
  UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_Players_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Players_TenantId_ObjectId UNIQUE (TenantId, ObjectId)
);

CREATE TABLE dbo.CloudSaves (
  PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_CloudSaves PRIMARY KEY,
  SchemaVersion int NOT NULL,
  Revision bigint NOT NULL,
  SaveJson nvarchar(max) NOT NULL,
  UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_CloudSaves_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_CloudSaves_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT CK_CloudSaves_SchemaVersion CHECK (SchemaVersion >= 1),
  CONSTRAINT CK_CloudSaves_Revision CHECK (Revision >= 0)
);

CREATE TABLE dbo.StageRunTickets (
  RunId uniqueidentifier NOT NULL CONSTRAINT PK_StageRunTickets PRIMARY KEY,
  PlayerId uniqueidentifier NOT NULL,
  Chapter int NOT NULL,
  Stage int NOT NULL,
  Seed bigint NOT NULL,
  SimulatorVersion int NOT NULL,
  BalanceVersion int NOT NULL,
  PlayerSnapshotJson nvarchar(max) NOT NULL,
  IssuedAtUtc datetime2(7) NOT NULL,
  ExpiresAtUtc datetime2(7) NOT NULL,
  Status nvarchar(16) NOT NULL,
  CompletedAtUtc datetime2(7) NULL,
  CONSTRAINT FK_StageRunTickets_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT CK_StageRunTickets_Chapter CHECK (Chapter >= 1),
  CONSTRAINT CK_StageRunTickets_Stage CHECK (Stage BETWEEN 1 AND 10),
  CONSTRAINT CK_StageRunTickets_Seed CHECK (Seed BETWEEN 1 AND 4294967295),
  CONSTRAINT CK_StageRunTickets_Versions CHECK (SimulatorVersion >= 1 AND BalanceVersion >= 1),
  CONSTRAINT CK_StageRunTickets_Status CHECK (Status IN (N'issued', N'completed', N'expired', N'rejected'))
);

CREATE TABLE dbo.StageBests (
  PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_StageBests PRIMARY KEY,
  Chapter int NOT NULL,
  Stage int NOT NULL,
  ClearTimeMs bigint NOT NULL,
  RunId uniqueidentifier NOT NULL,
  UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_StageBests_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_StageBests_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT FK_StageBests_StageRunTickets FOREIGN KEY (RunId) REFERENCES dbo.StageRunTickets(RunId),
  CONSTRAINT CK_StageBests_Chapter CHECK (Chapter >= 1),
  CONSTRAINT CK_StageBests_Stage CHECK (Stage BETWEEN 1 AND 10),
  CONSTRAINT CK_StageBests_ClearTimeMs CHECK (ClearTimeMs > 0)
);

CREATE INDEX IX_StageBests_Stage_Time
  ON dbo.StageBests (Chapter, Stage, ClearTimeMs, PlayerId);

CREATE TABLE dbo.PlayerSnapshots (
  PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_PlayerSnapshots PRIMARY KEY,
  Revision bigint NOT NULL,
  SnapshotJson nvarchar(max) NOT NULL,
  UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_PlayerSnapshots_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_PlayerSnapshots_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT CK_PlayerSnapshots_Revision CHECK (Revision >= 0)
);

CREATE TABLE dbo.PvpRatings (
  PlayerId uniqueidentifier NOT NULL CONSTRAINT PK_PvpRatings PRIMARY KEY,
  Rating int NOT NULL CONSTRAINT DF_PvpRatings_Rating DEFAULT 1000,
  UpdatedAtUtc datetime2(7) NOT NULL CONSTRAINT DF_PvpRatings_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_PvpRatings_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId)
);

CREATE TABLE dbo.PvpMatches (
  MatchId uniqueidentifier NOT NULL CONSTRAINT PK_PvpMatches PRIMARY KEY,
  Player1Id uniqueidentifier NOT NULL,
  Player2Id uniqueidentifier NOT NULL,
  Player1SnapshotRevision bigint NOT NULL,
  Player2SnapshotRevision bigint NOT NULL,
  Seed bigint NOT NULL,
  SimulatorVersion int NOT NULL,
  InputJson nvarchar(max) NULL,
  Outcome nvarchar(16) NULL,
  RatingBefore1 int NOT NULL,
  RatingBefore2 int NOT NULL,
  RatingAfter1 int NULL,
  RatingAfter2 int NULL,
  IssuedAtUtc datetime2(7) NOT NULL,
  CompletedAtUtc datetime2(7) NULL,
  Status nvarchar(16) NOT NULL,
  CONSTRAINT FK_PvpMatches_Player1 FOREIGN KEY (Player1Id) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT FK_PvpMatches_Player2 FOREIGN KEY (Player2Id) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT CK_PvpMatches_DifferentPlayers CHECK (Player1Id <> Player2Id),
  CONSTRAINT CK_PvpMatches_Seed CHECK (Seed BETWEEN 1 AND 4294967295),
  CONSTRAINT CK_PvpMatches_SimulatorVersion CHECK (SimulatorVersion >= 1),
  CONSTRAINT CK_PvpMatches_Status CHECK (Status IN (N'issued', N'completed', N'expired', N'rejected'))
);

CREATE INDEX IX_PvpMatches_Player1_Status_IssuedAt
  ON dbo.PvpMatches (Player1Id, Status, IssuedAtUtc DESC);
CREATE INDEX IX_PvpMatches_Player2_Status_IssuedAt
  ON dbo.PvpMatches (Player2Id, Status, IssuedAtUtc DESC);

CREATE TABLE dbo.PvpRatedPairDays (
  MatchDateUtc date NOT NULL,
  LowPlayerId uniqueidentifier NOT NULL,
  HighPlayerId uniqueidentifier NOT NULL,
  MatchId uniqueidentifier NOT NULL,
  CONSTRAINT PK_PvpRatedPairDays PRIMARY KEY (MatchDateUtc, LowPlayerId, HighPlayerId),
  CONSTRAINT FK_PvpRatedPairDays_LowPlayer FOREIGN KEY (LowPlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT FK_PvpRatedPairDays_HighPlayer FOREIGN KEY (HighPlayerId) REFERENCES dbo.Players(PlayerId),
  CONSTRAINT FK_PvpRatedPairDays_Match FOREIGN KEY (MatchId) REFERENCES dbo.PvpMatches(MatchId),
  CONSTRAINT CK_PvpRatedPairDays_PlayerOrder CHECK (LowPlayerId < HighPlayerId)
);

INSERT INTO dbo.SchemaVersions (Version, Name)
VALUES (1, N'initial-schema');
