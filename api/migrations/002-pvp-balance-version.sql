-- Keep legacy PvP snapshots and matches readable while isolating new balance rules.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

ALTER TABLE dbo.PlayerSnapshots
  ADD BalanceVersion int NOT NULL
    CONSTRAINT DF_PlayerSnapshots_BalanceVersion DEFAULT (1) WITH VALUES;
ALTER TABLE dbo.PlayerSnapshots
  ADD CONSTRAINT CK_PlayerSnapshots_BalanceVersion CHECK (BalanceVersion >= 1);

ALTER TABLE dbo.PvpMatches
  ADD BalanceVersion int NOT NULL
    CONSTRAINT DF_PvpMatches_BalanceVersion DEFAULT (1) WITH VALUES;
ALTER TABLE dbo.PvpMatches
  ADD CONSTRAINT CK_PvpMatches_BalanceVersion CHECK (BalanceVersion >= 1);

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 2)
  INSERT dbo.SchemaVersions (Version, Name) VALUES (2, N'pvp-balance-version');

COMMIT TRANSACTION;
