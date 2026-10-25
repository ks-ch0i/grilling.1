-- Keep match history summaries after large replay payloads are removed.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 4)
BEGIN
  ALTER TABLE dbo.PvpMatches
    ADD Rated bit NOT NULL
      CONSTRAINT DF_PvpMatches_Rated DEFAULT (0) WITH VALUES;

  UPDATE match
  SET Rated = 1
  FROM dbo.PvpMatches AS match
  INNER JOIN dbo.PvpRatedPairDays AS pairDay ON pairDay.MatchId = match.MatchId;

  CREATE TABLE dbo.PvpMatchPayloads (
    MatchId uniqueidentifier NOT NULL CONSTRAINT PK_PvpMatchPayloads PRIMARY KEY,
    Player1SnapshotJson nvarchar(max) NOT NULL,
    Player2SnapshotJson nvarchar(max) NOT NULL,
    InputJson nvarchar(max) NULL,
    CONSTRAINT FK_PvpMatchPayloads_PvpMatches FOREIGN KEY (MatchId)
      REFERENCES dbo.PvpMatches(MatchId)
  );

  INSERT dbo.PvpMatchPayloads (MatchId, Player1SnapshotJson, Player2SnapshotJson, InputJson)
  SELECT MatchId, Player1SnapshotJson, Player2SnapshotJson, InputJson
  FROM dbo.PvpMatches;

  IF (SELECT COUNT_BIG(*) FROM dbo.PvpMatches) <>
     (SELECT COUNT_BIG(*) FROM dbo.PvpMatchPayloads)
    THROW 51004, 'PvP match payload copy is incomplete; source columns were not removed.', 1;

  ALTER TABLE dbo.PvpMatches DROP COLUMN Player1SnapshotJson, Player2SnapshotJson, InputJson;

  INSERT dbo.SchemaVersions (Version, Name)
  VALUES (4, N'pvp-payload-retention');
END;

COMMIT TRANSACTION;
