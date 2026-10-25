const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export class ProfileActionValidationError extends Error {
  constructor(message = 'The profile action is invalid.') {
    super(message);
    this.name = 'ProfileActionValidationError';
    this.code = 'invalid-action';
  }
}

function invalid(message) {
  throw new ProfileActionValidationError(message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalAction(value) {
  if (!isPlainObject(value) || typeof value.type !== 'string') invalid();
  if (value.type === 'equip-inventory-item' || value.type === 'dismantle-inventory-item') {
    if (!hasOnlyKeys(value, ['type', 'itemId']) || typeof value.itemId !== 'string' ||
        value.itemId.length < 1 || value.itemId.length > 128) invalid();
    return { type: value.type, itemId: value.itemId };
  }
  if (value.type === 'spend-gold' || value.type === 'spend-materials') {
    if (!hasOnlyKeys(value, ['type', 'amount']) || !Number.isSafeInteger(value.amount) || value.amount < 1) invalid();
    return { type: value.type, amount: value.amount };
  }
  invalid();
}

export function validateProfileAction(body) {
  if (!isPlainObject(body) || !hasOnlyKeys(body, ['actionId', 'expectedSaveRevision', 'action']) ||
      typeof body.actionId !== 'string' || !UUID_PATTERN.test(body.actionId) ||
      !Number.isSafeInteger(body.expectedSaveRevision) || body.expectedSaveRevision < 1) invalid();
  return {
    actionId: body.actionId.toLowerCase(),
    expectedSaveRevision: body.expectedSaveRevision,
    action: canonicalAction(body.action),
  };
}
