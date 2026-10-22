import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrationPath = path.join(apiRoot, 'migrations', '001-initial-schema.sql');
const pvpVersionMigrationPath = path.join(apiRoot, 'migrations', '002-pvp-balance-version.sql');

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
