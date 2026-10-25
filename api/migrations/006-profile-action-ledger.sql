-- Keep profile-economy commands idempotent across client retries.
SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = 6)
BEGIN
  CREATE TABLE dbo.PlayerProfileActions (
    PlayerId uniqueidentifier NOT NULL,
    ActionId uniqueidentifier NOT NULL,
    RequestJson nvarchar(2048) NOT NULL,
    ResultJson nvarchar(max) NOT NULL,
    AppliedAtUtc datetime2(7) NOT NULL,
    CONSTRAINT PK_PlayerProfileActions PRIMARY KEY (PlayerId, ActionId),
    CONSTRAINT FK_PlayerProfileActions_Players FOREIGN KEY (PlayerId) REFERENCES dbo.Players(PlayerId),
    CONSTRAINT CK_PlayerProfileActions_RequestJson CHECK (ISJSON(RequestJson) = 1),
    CONSTRAINT CK_PlayerProfileActions_ResultJson CHECK (ISJSON(ResultJson) = 1)
  );

  INSERT dbo.SchemaVersions (Version, Name)
  VALUES (6, N'profile-action-ledger');
END;

COMMIT TRANSACTION;
