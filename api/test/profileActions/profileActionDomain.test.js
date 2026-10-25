import assert from 'node:assert/strict';
import { ProfileActionValidationError, validateProfileAction } from '../../src/domain/profileAction.js';
import { test } from 'node:test';

const validId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('validates and canonicalizes only the four supported profile commands', () => {
  assert.deepEqual(validateProfileAction({
    actionId: validId.toUpperCase(),
    expectedSaveRevision: 7,
    action: { type: 'equip-inventory-item', itemId: 'gear-1' },
  }), {
    actionId: validId,
    expectedSaveRevision: 7,
    action: { type: 'equip-inventory-item', itemId: 'gear-1' },
  });
  for (const type of ['dismantle-inventory-item', 'equip-inventory-item']) {
    assert.equal(validateProfileAction({ actionId: validId, expectedSaveRevision: 1, action: { type, itemId: 'x' } }).action.type, type);
  }
  for (const type of ['spend-gold', 'spend-materials']) {
    assert.equal(validateProfileAction({ actionId: validId, expectedSaveRevision: 1, action: { type, amount: 1 } }).action.type, type);
  }
});

test('rejects unrecognized commands, caller-supplied result fields and invalid ids or amounts', () => {
  const invalidBodies = [
    null,
    { actionId: 'not-a-uuid', expectedSaveRevision: 1, action: { type: 'spend-gold', amount: 1 } },
    { actionId: validId, expectedSaveRevision: 0, action: { type: 'spend-gold', amount: 1 } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'spend-gold', amount: 0 } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'spend-gold', amount: Number.MAX_SAFE_INTEGER + 1 } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'grant-gold', amount: 100 } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'spend-gold', amount: 1, balance: 999999 } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'equip-inventory-item', itemId: '' } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'equip-inventory-item', itemId: 'x'.repeat(129) } },
    { actionId: validId, expectedSaveRevision: 1, action: { type: 'equip-inventory-item', itemId: 'gear-1', inventory: [] } },
  ];
  for (const body of invalidBodies) {
    assert.throws(() => validateProfileAction(body), ProfileActionValidationError);
  }
});
