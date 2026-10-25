import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(apiRoot, 'migrations', '001-initial-schema.sql');
const pvpVersionMigrationPath = path.join(apiRoot, 'migrations', '002-pvp-balance-version.sql');
const pvpHistoryMigrationPath = path.join(apiRoot, 'migrations', '003-pvp-history-indexes.sql');
const pvpPayloadMigrationPath = path.join(apiRoot, 'migrations', '004-pvp-payload-retention.sql');
const rewardProfileMigrationPath = path.join(apiRoot, 'migrations', '005-authoritative-reward-profile.sql');

test('initial schema defines account, save, stage, snapshot and PvP contracts', () => {
  assert.ok(existsSync(migrationPath), 'the initial SQL migration must exist');
  const sql = readFileSync(migrationPath, 'utf8');
  const required = [
    /CREATE TABLE dbo\.SchemaVersions/i,
    /CREATE TABLE dbo\.Players/i,
    /UNIQUE\s*\(TenantId\s*,\s*ObjectId\)/i,
    /CREATE TABLE dbo\.CloudSaves/i,
    /SaveJson\s+nvarchar\s*\(max\)/i,
    /CREATE TABLE dbo\.StageRunTickets/i,
    /Seed\s+bigint/i,
    /SimulatorVersion\s+int/i,
    /CREATE TABLE dbo\.StageBests/i,
    /ClearTimeMs\s+bigint/i,
    /CREATE TABLE dbo\.PlayerSnapshots/i,
    /CREATE TABLE dbo\.PvpRatings/i,
    /Rating\s+int\s+NOT NULL\s+CONSTRAINT\s+DF_PvpRatings_Rating\s+DEFAULT\s+1000/i,
    /CREATE TABLE dbo\.PvpMatches/i,
    /Player1SnapshotJson\s+nvarchar\s*\(max\)/i,
    /Player2SnapshotJson\s+nvarchar\s*\(max\)/i,
    /ExpiresAtUtc\s+datetime2\(7\)\s+NOT NULL/i,
    /CREATE TABLE dbo\.PvpRatedPairDays/i,
    /PRIMARY KEY\s*\(MatchDateUtc\s*,\s*LowPlayerId\s*,\s*HighPlayerId\)/i,
    /UNIQUE\s+INDEX\s+UX_PvpRatedPairDays_MatchId/i,
    /IX_StageBests_Stage_Time/i,
  ];
  for (const pattern of required) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /\b(?:PASSWORD|SECRET)\b/i);
});

test('PvP balance-version migration labels existing data as v1 and records schema version 2', () => {
  assert.ok(existsSync(pvpVersionMigrationPath), 'the additive PvP balance-version migration must exist');
  const sql = readFileSync(pvpVersionMigrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE dbo\.PlayerSnapshots[\s\S]*?BalanceVersion\s+int\s+NOT NULL[\s\S]*?DEFAULT\s*\(?1\)?[\s\S]*?WITH VALUES/i);
  assert.match(sql, /ALTER TABLE dbo\.PvpMatches[\s\S]*?BalanceVersion\s+int\s+NOT NULL[\s\S]*?DEFAULT\s*\(?1\)?[\s\S]*?WITH VALUES/i);
  assert.match(sql, /CK_PlayerSnapshots_BalanceVersion[^;]*BalanceVersion\s*>=\s*1/i);
  assert.match(sql, /CK_PvpMatches_BalanceVersion[^;]*BalanceVersion\s*>=\s*1/i);
  assert.match(sql, /INSERT\s+dbo\.SchemaVersions\s*\(Version,\s*Name\)[\s\S]*?\b2\b/i);
  assert.match(sql, /IF\s+NOT\s+EXISTS[\s\S]*?Version\s*=\s*2/i);
});

test('PvP history migration adds idempotent player-perspective completion indexes', () => {
  assert.ok(existsSync(pvpHistoryMigrationPath), 'the PvP history indexes migration must exist');
  const sql = readFileSync(pvpHistoryMigrationPath, 'utf8');
  assert.match(sql, /IX_PvpMatches_Player1_Status_CompletedAt[\s\S]*?Player1Id,\s*Status,\s*CompletedAtUtc\s+DESC,\s*MatchId\s+DESC/i);
  assert.match(sql, /IX_PvpMatches_Player2_Status_CompletedAt[\s\S]*?Player2Id,\s*Status,\s*CompletedAtUtc\s+DESC,\s*MatchId\s+DESC/i);
  assert.equal((sql.match(/SELECT 1 FROM sys\.indexes/gi) ?? []).length, 2);
  assert.match(sql, /INSERT dbo\.SchemaVersions \(Version, Name\) VALUES \(3, N'pvp-history-indexes'\)/i);
});

test('PvP payload migration preserves rated summaries and copies replay data before dropping old columns', () => {
  assert.ok(existsSync(pvpPayloadMigrationPath), 'the PvP payload retention migration must exist');
  const sql = readFileSync(pvpPayloadMigrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE dbo\.PvpMatches[\s\S]*?ADD Rated bit NOT NULL[\s\S]*?DEFAULT \(0\)/i);
  assert.match(sql, /UPDATE match[\s\S]*?FROM dbo\.PvpMatches AS match[\s\S]*?JOIN dbo\.PvpRatedPairDays/i);
  assert.match(sql, /CREATE TABLE dbo\.PvpMatchPayloads[\s\S]*?Player1SnapshotJson nvarchar\(max\) NOT NULL[\s\S]*?Player2SnapshotJson nvarchar\(max\) NOT NULL[\s\S]*?InputJson nvarchar\(max\) NULL/i);
  assert.match(sql, /INSERT dbo\.PvpMatchPayloads[\s\S]*?FROM dbo\.PvpMatches/i);
  assert.match(sql, /COUNT_BIG\(\*\)[\s\S]*?THROW[\s\S]*?ALTER TABLE dbo\.PvpMatches DROP COLUMN Player1SnapshotJson, Player2SnapshotJson, InputJson/i);
  assert.match(sql, /VALUES \(4, N'pvp-payload-retention'\)/i);
});

test('reward profile migration archives original save bytes before default seeding', () => {
  assert.ok(existsSync(rewardProfileMigrationPath), 'the authoritative reward profile migration must exist');
  const sql = readFileSync(rewardProfileMigrationPath, 'utf8');
  assert.match(sql, /CREATE TABLE dbo\.PlayerRewardProfiles[\s\S]*?InventoryJson nvarchar\(max\)[\s\S]*?ClearedStageIdsJson nvarchar\(max\)/i);
  assert.match(sql, /CREATE TABLE dbo\.LegacySaveArchives[\s\S]*?OriginalRevision bigint[\s\S]*?OriginalSaveJson nvarchar\(max\)/i);
  const archiveAt = sql.indexOf('INSERT dbo.LegacySaveArchives');
  const profileAt = sql.indexOf('INSERT dbo.PlayerRewardProfiles');
  assert.ok(archiveAt >= 0 && profileAt > archiveAt, 'legacy bytes must be archived before canonical profiles are seeded');
  assert.match(sql.slice(archiveAt, profileAt), /save\.SaveJson[\s\S]*FROM dbo\.CloudSaves/i);
  assert.doesNotMatch(sql, /UPDATE\s+dbo\.CloudSaves|DELETE\s+FROM\s+dbo\.CloudSaves|DROP\s+COLUMN\s+SaveJson/i);
  assert.match(sql, /WHERE Reason = N'schema-v5-migration'/i);
  assert.match(sql, /VALUES \(5, N'authoritative-reward-profile'\)/i);
});
