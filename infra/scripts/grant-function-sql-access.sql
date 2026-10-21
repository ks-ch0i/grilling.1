-- Run after 001-initial-schema.sql, connected to the dedicated database as its Entra administrator.
-- Example: sqlcmd -S <server>.database.windows.net -d <database> -G -v FunctionAppName="<function-app-name>" -i infra/scripts/grant-function-sql-access.sql

SET NOCOUNT ON;

DECLARE @functionAppName sysname = N'$(FunctionAppName)';
IF @functionAppName = N'REPLACE-WITH-FUNCTION-APP-NAME'
  THROW 51000, 'Set FunctionAppName to the dedicated Function App name before running this script.', 1;

DECLARE @quotedPrincipal nvarchar(258) = QUOTENAME(@functionAppName);
IF @quotedPrincipal IS NULL
  THROW 51001, 'FunctionAppName is not a valid SQL principal name.', 1;

IF USER_ID(@functionAppName) IS NULL
BEGIN
  DECLARE @createUserSql nvarchar(max) = N'CREATE USER ' + @quotedPrincipal + N' FROM EXTERNAL PROVIDER;';
  EXEC sys.sp_executesql @createUserSql;
END;

DECLARE @grantSql nvarchar(max) = N'GRANT CONNECT TO ' + @quotedPrincipal + N';';
EXEC sys.sp_executesql @grantSql;

DECLARE @tables table (SchemaName sysname NOT NULL, TableName sysname NOT NULL);
INSERT INTO @tables (SchemaName, TableName)
VALUES
  (N'dbo', N'Players'),
  (N'dbo', N'CloudSaves'),
  (N'dbo', N'StageRunTickets'),
  (N'dbo', N'StageBests'),
  (N'dbo', N'PlayerSnapshots'),
  (N'dbo', N'PvpRatings'),
  (N'dbo', N'PvpMatches'),
  (N'dbo', N'PvpRatedPairDays');

DECLARE @schemaName sysname;
DECLARE @tableName sysname;
DECLARE tableCursor CURSOR LOCAL FAST_FORWARD FOR
  SELECT SchemaName, TableName FROM @tables;
OPEN tableCursor;
FETCH NEXT FROM tableCursor INTO @schemaName, @tableName;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @grantSql = N'GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::'
    + QUOTENAME(@schemaName) + N'.' + QUOTENAME(@tableName)
    + N' TO ' + @quotedPrincipal + N';';
  EXEC sys.sp_executesql @grantSql;
  FETCH NEXT FROM tableCursor INTO @schemaName, @tableName;
END;
CLOSE tableCursor;
DEALLOCATE tableCursor;
