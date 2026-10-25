-- Persist stage replay idempotency and reward receipts without rewriting old terminal rows.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 7)
BEGIN
  IF COL_LENGTH(N'dbo.StageRunTickets', N'InputJson') IS NULL
    ALTER TABLE dbo.StageRunTickets ADD InputJson nvarchar(max) NULL;

  IF COL_LENGTH(N'dbo.StageRunTickets', N'Outcome') IS NULL
    ALTER TABLE dbo.StageRunTickets ADD Outcome nvarchar(16) NULL;

  IF COL_LENGTH(N'dbo.StageRunTickets', N'RewardJson') IS NULL
    ALTER TABLE dbo.StageRunTickets ADD RewardJson nvarchar(max) NULL;

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_StageRunTickets_Outcome'
      AND parent_object_id = OBJECT_ID(N'dbo.StageRunTickets')
  )
    ALTER TABLE dbo.StageRunTickets WITH CHECK
      ADD CONSTRAINT CK_StageRunTickets_Outcome
      CHECK (Outcome IS NULL OR Outcome IN (N'clear', N'death', N'invalid', N'incomplete'));

  IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE name = N'CK_StageRunTickets_RewardJson'
      AND parent_object_id = OBJECT_ID(N'dbo.StageRunTickets')
  )
    ALTER TABLE dbo.StageRunTickets WITH CHECK
      ADD CONSTRAINT CK_StageRunTickets_RewardJson
      CHECK (RewardJson IS NULL OR ISJSON(RewardJson) = 1);

  INSERT dbo.SchemaVersions (Version, Name)
  VALUES (7, N'stage-result-reward-persistence');
END;

COMMIT TRANSACTION;
