SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.PvpMatches')
    AND name = N'IX_PvpMatches_Player1_Status_CompletedAt'
)
  CREATE INDEX IX_PvpMatches_Player1_Status_CompletedAt
    ON dbo.PvpMatches (Player1Id, Status, CompletedAtUtc DESC, MatchId DESC)
    INCLUDE (Player2Id, Outcome, RatingBefore1, RatingBefore2, RatingAfter1, RatingAfter2);

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'dbo.PvpMatches')
    AND name = N'IX_PvpMatches_Player2_Status_CompletedAt'
)
  CREATE INDEX IX_PvpMatches_Player2_Status_CompletedAt
    ON dbo.PvpMatches (Player2Id, Status, CompletedAtUtc DESC, MatchId DESC)
    INCLUDE (Player1Id, Outcome, RatingBefore1, RatingBefore2, RatingAfter1, RatingAfter2);

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 3)
  INSERT dbo.SchemaVersions (Version, Name) VALUES (3, N'pvp-history-indexes');

COMMIT TRANSACTION;
