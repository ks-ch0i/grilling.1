import assert from 'node:assert/strict';
import sql from 'mssql';
import { test } from 'node:test';

const PLAYER_A = 'aaaaaaaa-1111-4111-8111-111111111111';
const PLAYER_B = 'bbbbbbbb-2222-4222-8222-222222222222';
const MATCH_ID = 'cccccccc-3333-4333-8333-333333333333';
const SNAPSHOT_A = JSON.stringify({ character: { level: 1 }, equipment: {}, combat: {} });
const SNAPSHOT_B = JSON.stringify({ character: { level: 2 }, equipment: {}, combat: {} });

async function loadRepository() {
  try {
    return await import('../../src/repositories/pvpRepository.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') assert.fail(`Expected PvP repository module: ${error.message}`);
    throw error;
  }
}

function mockRequests(respond) {
  const originalRequest = sql.Request;
  const calls = [];
  class FakeRequest {
    constructor(connection) {
      this.connection = connection;
      this.parameters = {};
    }
    input(name, _type, value) {
      this.parameters[name] = value;
      return this;
    }
    async query(statement) {
      const call = { statement, parameters: { ...this.parameters } };
      calls.push(call);
      return respond(call);
    }
  }
  sql.Request = FakeRequest;
  return {
    calls,
    restore() { sql.Request = originalRequest; },
    request() { return new FakeRequest(this); },
  };
}

test('getPlayerSnapshot reads the balance version column', async () => {
  const mock = mockRequests(async () => ({ recordset: [{ PlayerId: PLAYER_A, Revision: 4, SnapshotJson: SNAPSHOT_A, BalanceVersion: 2 }] }));
  try {
    const repository = await loadRepository();
    const row = await repository.getPlayerSnapshot(mock, PLAYER_A);

    assert.equal(row.BalanceVersion, 2);
    assert.match(mock.calls[0].statement, /SELECT\s+PlayerId,\s*Revision,\s*SnapshotJson,\s*BalanceVersion,\s*UpdatedAtUtc/i);
  } finally {
    mock.restore();
  }
});

test('snapshot upsert persists an explicit balance version', async () => {
  const mock = mockRequests(async () => ({ recordset: [{ PlayerId: PLAYER_A, Revision: 5, SnapshotJson: SNAPSHOT_A, BalanceVersion: 2 }] }));
  try {
    const repository = await loadRepository();
    const row = await repository.savePlayerSnapshot({}, {
      playerId: PLAYER_A,
      revision: 5,
      snapshotJson: SNAPSHOT_A,
      balanceVersion: 2,
      updatedAtUtc: new Date('2026-10-22T00:00:00.000Z'),
    });

    assert.equal(row.BalanceVersion, 2);
    assert.equal(mock.calls[0].parameters.BalanceVersion, 2);
    assert.match(mock.calls[0].statement, /BalanceVersion\s*=\s*@BalanceVersion/i);
    assert.match(mock.calls[0].statement, /INSERT dbo\.PlayerSnapshots\s*\([^)]*BalanceVersion[^)]*\)/i);
  } finally {
    mock.restore();
  }
});

test('candidate query excludes snapshots outside the requested balance version', async () => {
  const mock = mockRequests(async () => ({ recordset: [] }));
  try {
    const repository = await loadRepository();
    await repository.findOpponentCandidate(mock, {
      playerId: PLAYER_A,
      playerRating: 1000,
      window: 100,
      nowUtc: new Date('2026-10-22T00:00:00.000Z'),
      balanceVersion: 2,
      simulatorVersion: 2,
    });

    assert.equal(mock.calls[0].parameters.BalanceVersion, 2);
    assert.match(mock.calls[0].statement, /ps\.BalanceVersion\s*=\s*@BalanceVersion/i);
  } finally {
    mock.restore();
  }
});

test('createMatch rechecks both locked snapshot versions and inserts a versioned match ticket', async () => {
  const snapshotRows = [
    { PlayerId: PLAYER_A, Revision: 3, SnapshotJson: SNAPSHOT_A, BalanceVersion: 2 },
    { PlayerId: PLAYER_B, Revision: 8, SnapshotJson: SNAPSHOT_B, BalanceVersion: 2 },
  ];
  const mock = mockRequests(async ({ statement }) => {
    if (/FROM dbo\.Players WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) return { recordset: [{ PlayerId: PLAYER_A }, { PlayerId: PLAYER_B }] };
    if (/FROM dbo\.PlayerSnapshots WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) return { recordset: snapshotRows };
    if (/IF NOT EXISTS[\s\S]*dbo\.PvpRatings/i.test(statement)) return { recordset: [] };
    if (/SELECT Rating FROM dbo\.PvpRatings/i.test(statement)) return { recordset: [{ Rating: 1000 }] };
    if (/FROM dbo\.PvpRatedPairDays WITH/i.test(statement)) return { recordset: [] };
    if (/UPDATE dbo\.PvpMatches[\s\S]*Status = N'expired'/i.test(statement)) return { recordset: [] };
    if (/FROM dbo\.PvpMatches WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) return { recordset: [] };
    if (/INSERT dbo\.PvpMatches/i.test(statement)) {
      return { recordset: [{ MatchId: MATCH_ID, SimulatorVersion: 2, BalanceVersion: 2 }] };
    }
    throw new Error(`Unexpected SQL in PvP repository test: ${statement}`);
  });

  try {
    const repository = await loadRepository();
    const write = await repository.createMatch({}, {
      matchId: MATCH_ID,
      player1Id: PLAYER_A,
      player2Id: PLAYER_B,
      player1SnapshotRevision: 3,
      player2SnapshotRevision: 8,
      window: 100,
      seed: 123456,
      simulatorVersion: 2,
      balanceVersion: 2,
      issuedAtUtc: new Date('2026-10-22T00:00:00.000Z'),
      expiresAtUtc: new Date('2026-10-22T00:10:00.000Z'),
    });

    const snapshotRead = mock.calls.find((call) => /FROM dbo\.PlayerSnapshots WITH/i.test(call.statement));
    const staleMatchCleanup = mock.calls.find((call) => /UPDATE dbo\.PvpMatches[\s\S]*Status = N'expired'/i.test(call.statement));
    const matchInsert = mock.calls.find((call) => /INSERT dbo\.PvpMatches/i.test(call.statement));
    assert.equal(write.kind, 'created');
    assert.match(snapshotRead.statement, /BalanceVersion/i);
    assert.equal(staleMatchCleanup.parameters.BalanceVersion, 2);
    assert.equal(staleMatchCleanup.parameters.SimulatorVersion, 2);
    assert.equal(matchInsert.parameters.BalanceVersion, 2);
    assert.match(matchInsert.statement, /SimulatorVersion,\s*BalanceVersion/i);
  } finally {
    mock.restore();
  }
});

test('createMatch rejects a snapshot version changed after candidate search before rating writes', async () => {
  const snapshotRows = [
    { PlayerId: PLAYER_A, Revision: 3, SnapshotJson: SNAPSHOT_A, BalanceVersion: 2 },
    { PlayerId: PLAYER_B, Revision: 8, SnapshotJson: SNAPSHOT_B, BalanceVersion: 1 },
  ];
  const mock = mockRequests(async ({ statement }) => {
    if (/FROM dbo\.Players WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) return { recordset: [{ PlayerId: PLAYER_A }, { PlayerId: PLAYER_B }] };
    if (/FROM dbo\.PlayerSnapshots WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) return { recordset: snapshotRows };
    return { recordset: [] };
  });

  try {
    const repository = await loadRepository();
    const write = await repository.createMatch({}, {
      matchId: MATCH_ID,
      player1Id: PLAYER_A,
      player2Id: PLAYER_B,
      player1SnapshotRevision: 3,
      player2SnapshotRevision: 8,
      window: 100,
      seed: 123456,
      simulatorVersion: 2,
      balanceVersion: 2,
      issuedAtUtc: new Date('2026-10-22T00:00:00.000Z'),
      expiresAtUtc: new Date('2026-10-22T00:10:00.000Z'),
    });

    assert.equal(write.kind, 'snapshot-changed');
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});
