import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/game/domain/stateFactory.js';
import { runProfileSpendPreview } from '../src/game/domain/profileActionClient.js';
import { createProfileActionRequestExecutor } from '../src/game/domain/profileActionRequest.js';

function state() {
  let id = 0;
  return createInitialState(() => `town-profile-${++id}`);
}

test('profile action retries reuse the action ID until the UI action succeeds', async () => {
  const calls = [];
  let nextId = 0;
  let first = true;
  const execute = createProfileActionRequestExecutor({
    createActionId:() => `action-${++nextId}`,
    applyProfileAction:async(action, options) => {
      calls.push({ action, ...options });
      if (first) {
        first = false;
        return { ok:false, error:'save-revision-conflict' };
      }
      return { ok:true, state:state() };
    },
  });
  const action = { type:'spend-materials', amount:10 };

  assert.equal((await execute(action)).ok, false);
  assert.equal((await execute(action)).ok, true);
  assert.equal(calls[0].actionId, calls[1].actionId);
  assert.equal(calls[0].actionId, 'action-1');
  await execute(action);
  assert.equal(calls[2].actionId, 'action-2');
});

test('a server spend commits canonical balances and only client-owned equipment preview fields', async () => {
  const current = state();
  current.materials = 40;
  const serverState = structuredClone(current);
  serverState.materials = 30;
  const calls = [];
  const execute = createProfileActionRequestExecutor({
    createActionId:() => 'action-spend',
    applyProfileAction:async(action, options) => {
      calls.push({ action, ...options });
      return { ok:true, revision:4, state:serverState };
    },
  });

  const result = await runProfileSpendPreview(
    current,
    { type:'upgrade-gear', itemId:current.equipment.helmet.id },
    execute,
    { serverProfile:true },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].action, { type:'spend-materials', amount:10 });
  assert.equal(calls[0].actionId, 'action-spend');
  assert.equal(result.state.materials, 30);
  assert.deepEqual(result.state.equipment, result.preview.state.equipment);
  assert.equal(result.state.gold, serverState.gold);
  assert.equal(result.state.inventory.length, serverState.inventory.length);
});
