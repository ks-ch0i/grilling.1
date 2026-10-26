-- Persist idempotent PvP searches so issued matches can be cancelled until they start.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 8)
BEGIN
  CREATE TABLE dbo.PvpMatchSearches (
    SearchId uniqueidentifier NOT NULL CONSTRAINT PK_PvpMatchSearches PRIMARY KEY,
    PlayerId uniqueidentifier NOT NULL,
    Status nvarchar(16) NOT NULL,
    MatchId uniqueidentifier NULL,
    CreatedAtUtc datetime2(7) NOT NULL,
    UpdatedAtUtc datetime2(7) NOT NULL,
    SearchDeadlineAtUtc datetime2(7) NOT NULL,
    RetainUntilUtc datetime2(7) NULL,
    CONSTRAINT FK_PvpMatchSearches_Player FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
    CONSTRAINT FK_PvpMatchSearches_Match FOREIGN KEY (MatchId) REFERENCES dbo.PvpMatches(MatchId),
    CONSTRAINT CK_PvpMatchSearches_Status CHECK (
      Status IN (N'searching', N'matched', N'started', N'cancelled', N'no-opponent', N'expired')
    ),
    CONSTRAINT CK_PvpMatchSearches_MatchId CHECK (
      Status NOT IN (N'matched', N'started') OR MatchId IS NOT NULL
    ),
    CONSTRAINT CK_PvpMatchSearches_RetainUntil CHECK (
      (Status = N'searching' AND RetainUntilUtc IS NULL)
      OR (Status <> N'searching' AND RetainUntilUtc IS NOT NULL)
    )
  );

  CREATE INDEX IX_PvpMatchSearches_Status_Deadline
    ON dbo.PvpMatchSearches (Status, SearchDeadlineAtUtc)
    INCLUDE (PlayerId, MatchId);

  CREATE INDEX IX_PvpMatchSearches_RetainUntil
    ON dbo.PvpMatchSearches (RetainUntilUtc, SearchId)
    WHERE RetainUntilUtc IS NOT NULL;

  ALTER TABLE dbo.PvpMatches DROP CONSTRAINT CK_PvpMatches_Status;
  ALTER TABLE dbo.PvpMatches WITH CHECK
    ADD CONSTRAINT CK_PvpMatches_Status
    CHECK (Status IN (N'issued', N'started', N'completed', N'expired', N'rejected'));

  INSERT dbo.SchemaVersions (Version, Name)
  VALUES (8, N'pvp-search-state');
END;

COMMIT TRANSACTION;
