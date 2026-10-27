import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInitialState } from '../src/game/domain/stateFactory.js';
import { runProfileSpendPreview } from '../src/game/domain/profileActionClient.js';
import { createProfileActionRequestExecutor } from '../src/game/domain/profileActionRequest.js';
import { renderTownEquipmentPreview } from '../src/game/ui/equipmentAppearance.js';

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

test('Town appearance preview uses only the equipped rarity and is reconstructed from current state', () => {
  const images = [];
  const scene = { add:{
    container(x, y) {
      return { type:'Container', x, y, children:[], add(child) { this.children.push(child); } };
    },
    image(x, y, key, frame) {
      const image = {
        x,y,key,frame,width:256,height:256,
        setOrigin(...origin) { this.origin=origin; return this; },
        setScale(scale) { this.scale=scale; return this; },
        setVisible(visible) { this.visible=visible; return this; },
        setTexture(nextKey) { this.key=nextKey; return this; },
        setFrame(nextFrame) { this.frame=nextFrame; return this; },
        setFlipX(flipX) { this.flipX=flipX; return this; },
        destroy() {},
      };
      images.push(image);
      return image;
    },
  } };
  const current = state();
  current.equipment.helmet = { ...current.equipment.helmet, rarity:'legendary', level:20 };

  const first = renderTownEquipmentPreview(scene, current.equipment);
  const firstHelmet = first.knightAppearance.layers.find(({ slot }) => slot === 'helmet').image;
  assert.equal(firstHelmet.key, 'gear-helmet-legendary');
  assert.equal(firstHelmet.frame, 10);
  current.equipment.helmet = { ...current.equipment.helmet, rarity:'common' };
  const second = renderTownEquipmentPreview(scene, current.equipment);
  assert.notEqual(second.knightAppearance, first.knightAppearance);
  const secondHelmet = second.knightAppearance.layers.find(({ slot }) => slot === 'helmet').image;
  assert.equal(secondHelmet.key, 'gear-helmet-common');
  assert.equal(secondHelmet.frame, 10);
});
