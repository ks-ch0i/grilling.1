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

test('getMatchHistory returns player-perspective summaries and fetches one extra row', async () => {
  const rows = [{
    MatchId: MATCH_ID,
    CompletedAtUtc: new Date('2026-10-21T02:00:00.000Z'),
    OpponentDisplayName: 'Opponent',
    Outcome: 'loss',
    Rated: true,
    RatingBefore: 1000,
    RatingAfter: 984,
    OpponentRatingAfter: 1016,
  }];
  const mock = mockRequests(async () => ({ recordset: rows }));
  try {
    const repository = await loadRepository();
    const result = await repository.getMatchHistory(mock, PLAYER_B, { offset: 10, limit: 10 });

    assert.deepEqual(result, rows);
    assert.equal(mock.calls[0].parameters.PlayerId, PLAYER_B);
    assert.equal(mock.calls[0].parameters.Offset, 10);
    assert.equal(mock.calls[0].parameters.Limit, 11);
    assert.match(mock.calls[0].statement, /UNION ALL/i);
    assert.match(mock.calls[0].statement, /m\.Player1Id\s*=\s*@PlayerId[\s\S]*?m\.Status\s*=\s*N'completed'/i);
    assert.match(mock.calls[0].statement, /m\.Player2Id\s*=\s*@PlayerId[\s\S]*?m\.Status\s*=\s*N'completed'/i);
    assert.match(mock.calls[0].statement, /WHEN N'win' THEN N'loss' WHEN N'loss' THEN N'win'/i);
    assert.match(mock.calls[0].statement, /RatingBefore2 AS RatingBefore[\s\S]*?RatingAfter2 AS RatingAfter[\s\S]*?RatingAfter1 AS OpponentRatingAfter/i);
    assert.match(mock.calls[0].statement, /ORDER BY CompletedAtUtc DESC, MatchId DESC[\s\S]*?OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY/i);
    assert.match(mock.calls[0].statement, /COALESCE\(opponent\.DisplayName, N'Adventurer'\)/i);
    assert.match(mock.calls[0].statement, /m\.Rated AS Rated/i);
    assert.doesNotMatch(mock.calls[0].statement, /PvpRatedPairDays AS rated/i);
    assert.doesNotMatch(mock.calls[0].statement, /SnapshotJson|InputJson|\bSeed\b|TenantId|ObjectId/i);
  } finally {
    mock.restore();
  }
});

test('getMatchHistory rejects unsafe paging values', async () => {
  const mock = mockRequests(async () => ({ recordset: [] }));
  try {
    const repository = await loadRepository();
    await assert.rejects(repository.getMatchHistory(mock, PLAYER_A, { offset: -1, limit: 10 }), RangeError);
    await assert.rejects(repository.getMatchHistory(mock, PLAYER_A, { offset: 0, limit: 0 }), RangeError);
    assert.equal(mock.calls.length, 0);
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
      return { recordset: [{ MatchId: MATCH_ID, SimulatorVersion: 2, BalanceVersion: 2, Rated: false }] };
    }
    if (/INSERT dbo\.PvpMatchPayloads/i.test(statement)) return { recordset: [] };
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
    const payloadInsert = mock.calls.find((call) => /INSERT dbo\.PvpMatchPayloads/i.test(call.statement));
    assert.equal(write.kind, 'created');
    assert.equal(write.row.Player1SnapshotJson, SNAPSHOT_A);
    assert.equal(write.row.Player2SnapshotJson, SNAPSHOT_B);
    assert.match(snapshotRead.statement, /BalanceVersion/i);
    assert.equal(staleMatchCleanup.parameters.BalanceVersion, 2);
    assert.equal(staleMatchCleanup.parameters.SimulatorVersion, 2);
    assert.equal(matchInsert.parameters.BalanceVersion, 2);
    assert.match(matchInsert.statement, /SimulatorVersion,\s*BalanceVersion/i);
    assert.doesNotMatch(matchInsert.statement, /SnapshotJson|InputJson/i);
    assert.equal(payloadInsert.parameters.Player1SnapshotJson, SNAPSHOT_A);
    assert.equal(payloadInsert.parameters.Player2SnapshotJson, SNAPSHOT_B);
  } finally {
    mock.restore();
  }
});

test('getMatchForPlayer loads summary rating and nullable replay payload from the child table', async () => {
  const mock = mockRequests(async () => ({ recordset: [{ MatchId: MATCH_ID, Rated: true, InputJson: null }] }));
  try {
    const repository = await loadRepository();
    const row = await repository.getMatchForPlayer(mock, PLAYER_A, MATCH_ID);

    assert.equal(row.Rated, true);
    assert.equal(row.InputJson, null);
    assert.match(mock.calls[0].statement, /LEFT JOIN dbo\.PvpMatchPayloads AS payload ON payload\.MatchId = m\.MatchId/i);
    assert.match(mock.calls[0].statement, /payload\.Player1SnapshotJson, payload\.Player2SnapshotJson, payload\.InputJson/i);
    assert.match(mock.calls[0].statement, /m\.Rated/i);
    assert.doesNotMatch(mock.calls[0].statement, /PvpRatedPairDays AS pd/i);
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

test('completeRatedMatch writes input to payload and rated marker to the summary in one transaction', async () => {
  let status = 'issued';
  let rated = false;
  let inputJson = null;
  const rowForSelect = () => ({
    MatchId: MATCH_ID,
    Player1Id: PLAYER_A,
    Player2Id: PLAYER_B,
    Player1SnapshotRevision: 1,
    Player2SnapshotRevision: 1,
    Player1SnapshotJson: SNAPSHOT_A,
    Player2SnapshotJson: SNAPSHOT_B,
    Seed: 123456,
    SimulatorVersion: 2,
    BalanceVersion: 2,
    InputJson: inputJson,
    Outcome: status === 'completed' ? 'win' : null,
    RatingBefore1: 1000,
    RatingBefore2: 1000,
    RatingAfter1: status === 'completed' ? 1016 : null,
    RatingAfter2: status === 'completed' ? 984 : null,
    IssuedAtUtc: new Date('2026-10-22T00:00:00.000Z'),
    ExpiresAtUtc: new Date('2026-10-22T00:10:00.000Z'),
    CompletedAtUtc: status === 'completed' ? new Date('2026-10-22T00:01:00.000Z') : null,
    Status: status,
    Rated: rated,
  });
  const mock = mockRequests(async ({ statement, parameters }) => {
    if (/SELECT m\.MatchId[\s\S]*FROM dbo\.PvpMatches AS m/i.test(statement)) return { recordset: [rowForSelect()] };
    if (/SELECT PlayerId[\s\S]*FROM dbo\.Players WITH \(UPDLOCK, HOLDLOCK\)/i.test(statement)) {
      return { recordset: [{ PlayerId: PLAYER_A }, { PlayerId: PLAYER_B }] };
    }
    if (/IF NOT EXISTS[\s\S]*dbo\.PvpRatings/i.test(statement)) return { recordset: [] };
    if (/SELECT Rating FROM dbo\.PvpRatings/i.test(statement)) return { recordset: [{ Rating: 1000 }] };
    if (/SELECT TOP \(1\) MatchId[\s\S]*FROM dbo\.PvpRatedPairDays/i.test(statement)) return { recordset: [] };
    if (/INSERT dbo\.PvpRatedPairDays/i.test(statement)) return { recordset: [] };
    if (/UPDATE dbo\.PvpRatings/i.test(statement)) return { recordset: [] };
    if (/UPDATE dbo\.PvpMatchPayloads/i.test(statement)) {
      inputJson = parameters.InputJson;
      return { recordset: [] };
    }
    if (/UPDATE dbo\.PvpMatches/i.test(statement)) {
      status = 'completed';
      rated = parameters.Rated;
      assert.doesNotMatch(statement, /InputJson/i);
      return { recordset: [] };
    }
    throw new Error(`Unexpected SQL in PvP completion test: ${statement}`);
  });

  try {
    const repository = await loadRepository();
    const result = await repository.completeRatedMatch(mock, {
      player1Id: PLAYER_A,
      player2Id: PLAYER_B,
      matchId: MATCH_ID,
      inputJson: '[{"tick":0,"kind":"move","value":1}]',
      outcome: 'win',
      completedAtUtc: new Date('2026-10-22T00:01:00.000Z'),
    });

    assert.equal(result.kind, 'completed');
    assert.equal(result.row.Rated, true);
    assert.equal(result.row.InputJson, inputJson);
    assert.equal(mock.calls.find((call) => /UPDATE dbo\.PvpMatchPayloads/i.test(call.statement)).parameters.InputJson, inputJson);
    assert.equal(mock.calls.find((call) => /UPDATE dbo\.PvpMatches/i.test(call.statement)).parameters.Rated, true);
  } finally {
    mock.restore();
  }
});

test('rejectMatch stores invalid input in payload and terminal status in summary', async () => {
  let status = 'issued';
  let inputJson = null;
  const mock = mockRequests(async ({ statement, parameters }) => {
    if (/SELECT m\.MatchId[\s\S]*FROM dbo\.PvpMatches AS m/i.test(statement)) {
      return { recordset: [{
        MatchId: MATCH_ID, Player1Id: PLAYER_A, Player2Id: PLAYER_B,
        Player1SnapshotJson: SNAPSHOT_A, Player2SnapshotJson: SNAPSHOT_B,
        ExpiresAtUtc: new Date('2026-10-22T00:10:00.000Z'), Status: status,
        Outcome: status === 'rejected' ? 'invalid' : null,
        InputJson: inputJson, Rated: false,
      }] };
    }
    if (/UPDATE dbo\.PvpMatchPayloads/i.test(statement)) {
      inputJson = parameters.InputJson;
      return { recordset: [] };
    }
    if (/UPDATE dbo\.PvpMatches/i.test(statement)) {
      status = 'rejected';
      assert.doesNotMatch(statement, /InputJson/i);
      return { recordset: [] };
    }
    throw new Error(`Unexpected SQL in PvP rejection test: ${statement}`);
  });

  try {
    const repository = await loadRepository();
    const result = await repository.rejectMatch(mock, {
      player1Id: PLAYER_A,
      matchId: MATCH_ID,
      inputJson: '[]',
      completedAtUtc: new Date('2026-10-22T00:01:00.000Z'),
    });

    assert.equal(result.kind, 'rejected');
    assert.equal(result.row.Status, 'rejected');
    assert.equal(result.row.InputJson, '[]');
    assert.equal(mock.calls.find((call) => /UPDATE dbo\.PvpMatchPayloads/i.test(call.statement)).parameters.InputJson, '[]');
  } finally {
    mock.restore();
  }
});
