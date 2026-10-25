import assert from 'node:assert/strict';
import { createInitialState } from '../../../src/game/domain/gear.js';
import { test } from 'node:test';

const identityA = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  objectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
const identityB = { ...identityA, objectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const env = {
  ENTRA_TENANT_ID: identityA.tenantId,
  ENTRA_API_AUDIENCE: 'api://knight-run-test',
  SQL_SERVER_FQDN: 'knight-run.database.windows.net',
  SQL_DATABASE: 'KnightRun',
};

function makeArchiveRepository() {
  const players = new Map([
    [`${identityA.tenantId}/${identityA.objectId}`, 'player-a'],
    [`${identityB.tenantId}/${identityB.objectId}`, 'player-b'],
  ]);
  let itemNumber = 0;
  const state = createInitialState(() => `legacy-gear-${++itemNumber}`);
  state.player.xp = 950;
  state.gold = 12345;
  state.materials = 800;
  state.progression.unlockedChapter = 6;
  const originalSaveJson = JSON.stringify(state);
  const archives = new Map([['player-a', {
    OriginalRevision: 17n,
    OriginalSaveJson: originalSaveJson,
    ArchivedAtUtc: new Date('2026-10-21T02:00:00.000Z'),
    Reason: 'schema-v5-migration',
  }]]);
  return {
    archives,
    originalSaveJson,
    async findPlayerIdByIdentity(_pool, identity) {
      return players.get(`${identity.tenantId}/${identity.objectId}`) ?? null;
    },
    async getLegacySaveArchiveByPlayerId(_pool, playerId) {
      return archives.get(playerId) ?? null;
    },
  };
}

async function loadService() {
  return import('../../src/services/legacySaveRecoveryService.js');
}

async function loadFunction() {
  return import('../../src/functions/legacySaveRecovery.js');
}

test('legacy recovery returns the owner archive as unverified without changing original bytes', async () => {
  const repository = makeArchiveRepository();
  const { getLegacySave } = await loadService();
  const result = await getLegacySave({}, identityA, { repository });

  assert.equal(result.status, 200);
  assert.equal(result.archive.schemaVersion, 2);
  assert.equal(result.archive.revision, 17);
  assert.equal(result.archive.state.player.xp, 950);
  assert.equal(result.archive.state.gold, 12345);
  assert.equal(result.archive.state.materials, 800);
  assert.equal(result.archive.state.progression.unlockedChapter, 6);
  assert.equal(result.archive.trust, 'unverified');
  assert.equal(repository.archives.get('player-a').OriginalSaveJson, repository.originalSaveJson);
});

test('legacy recovery is identity scoped and returns 404 for missing accounts or archives', async () => {
  const repository = makeArchiveRepository();
  const { getLegacySave } = await loadService();

  assert.deepEqual(await getLegacySave({}, identityB, { repository }), {
    status: 404, code: 'legacy-save-not-found',
  });
  assert.deepEqual(await getLegacySave({}, { ...identityA, objectId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { repository }), {
    status: 404, code: 'legacy-save-not-found',
  });
});

test('legacy recovery Function authenticates, returns the archive envelope, and registers the route', async () => {
  const { createLegacySaveRecoveryHandlers, registerLegacySaveRecoveryFunction } = await loadFunction();
  const calls = [];
  const handlers = createLegacySaveRecoveryHandlers({
    env,
    credential: { getToken: async () => ({ token: 'unused' }) },
    authenticate: async (_request, config) => {
      assert.equal(config.tenantId, env.ENTRA_TENANT_ID);
      return identityA;
    },
    sqlPoolProvider: async (config) => {
      calls.push(config);
      return { id: 'pool' };
    },
    service: {
      getLegacySave: async (_pool, identity) => {
        assert.equal(identity, identityA);
        return { status: 200, archive: { schemaVersion: 2, revision: 17, state: {}, trust: 'unverified' } };
      },
    },
  });
  const response = await handlers.get(new Request('https://game.internal/api/profile/legacy-save'));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), {
    archive: { schemaVersion: 2, revision: 17, state: {}, trust: 'unverified' },
  });
  assert.equal(calls.length, 1);

  const routes = [];
  registerLegacySaveRecoveryFunction({ http: (name, options) => routes.push({ name, options }) }, {
    env, credential: {}, authenticate: async () => identityA, sqlPoolProvider: async () => ({}),
    service: { getLegacySave: async () => ({ status: 404, code: 'legacy-save-not-found' }) },
  });
  assert.deepEqual(routes.map(({ options }) => [options.route, ...options.methods]), [
    ['profile/legacy-save', 'GET'],
  ]);
  assert.equal(routes[0].options.authLevel, 'anonymous');
});
