import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/game/domain/stateFactory.js';
import { createRankedRunClient } from '../src/game/domain/rankedRunClient.js';

function state() {
  let id = 0;
  return createInitialState(() => `battle-reward-${++id}`);
}

test('a rejected stage result preserves provisional rewards in the unverified shadow', async () => {
  let mode = 'verified-online';
  let activeState = state();
  let savedShadow = null;
  const installs = [];
  const inputs = [{ tick:12, kind:'move', value:1 }];
  const client = createRankedRunClient({
    apiClient:{ submitStageResult:async(_account, _runId, body) => {
      assert.deepEqual(body, { inputs });
      return { status:422, code:'run-not-cleared' };
    } },
    account:{},
    getCurrentState:() => activeState,
    getMode:() => mode,
    saveState:(nextState) => {
      activeState = structuredClone(nextState);
      if (mode !== 'verified-online') savedShadow = structuredClone(nextState);
      return { ok:true };
    },
    selectLocalShadow:async(_reason, options) => {
      assert.equal(options.preferExisting, false);
      mode = 'offline-unverified';
      return { ok:true, state:structuredClone(activeState), mode };
    },
    installVerifiedState:async(envelope) => { installs.push(envelope); return { ok:true, ...envelope }; },
    isOnline:() => true,
  });
  const provisional = state();
  provisional.gold = 45;
  provisional.player.xp = 19;
  provisional.inventory.push({ ...provisional.equipment.helmet, id:'provisional-drop' });
  activeState = provisional;

  const result = await client.submitResult({ runId:'run-1' }, inputs);

  assert.equal(result.verified, false);
  assert.equal(result.code, 'run-not-cleared');
  assert.equal(mode, 'offline-unverified');
  assert.deepEqual(savedShadow, provisional);
  assert.deepEqual(installs, []);
});

test('a verified stage response replaces provisional rewards with the canonical state exactly', async () => {
  const provisional = state();
  provisional.gold = 18;
  provisional.player.xp = 12;
  const canonical = structuredClone(provisional);
  canonical.gold = 26;
  canonical.player.xp = 31;
  canonical.progression.clearedStageIds = ['1-1'];
  const installed = [];
  const client = createRankedRunClient({
    apiClient:{ submitStageResult:async() => ({
      status:200,
      verified:true,
      outcome:'clear',
      clearTimeMs:42000,
      revision:8,
      state:canonical,
      rewards:{ outcome:'clear', xpGranted:19, goldGranted:8, drops:[] },
    }) },
    account:{},
    getMode:() => 'verified-online',
    isOnline:() => true,
    applyVerifiedState:async(envelope) => { installed.push(envelope); return { ok:true, ...envelope }; },
  });

  const result = await client.submitResult({ runId:'run-2' }, []);

  assert.equal(result.verified, true);
  assert.deepEqual(result.state, canonical);
  assert.equal(result.state.gold, 26);
  assert.equal(result.state.player.xp, 31);
  assert.deepEqual(installed, [{ revision:8, state:canonical }]);
});
