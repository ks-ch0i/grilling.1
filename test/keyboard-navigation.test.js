import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyboardNavigation } from '../src/game/ui/keyboardNavigation.js';

class FakeKeyboard {
  handlers = new Map();

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) ?? new Set();
    handlers.add(handler);
    this.handlers.set(eventName, handlers);
    return this;
  }

  off(eventName, handler) {
    this.handlers.get(eventName)?.delete(handler);
    return this;
  }

  emit(eventName, event) {
    for (const handler of this.handlers.get(eventName) ?? []) handler(event);
  }
}

function createController() {
  const keyboard = new FakeKeyboard();
  return { keyboard, controller: createKeyboardNavigation({ input: { keyboard } }) };
}

function key(key, options = {}) {
  let prevented = false;
  return {
    event: {
      key,
      repeat: false,
      shiftKey: false,
      ...options,
      preventDefault() { prevented = true; },
    },
    wasPrevented: () => prevented,
  };
}

test('Tab and arrows cycle forward and backward through registered targets', () => {
  const { keyboard, controller } = createController();
  const calls = [];
  const register = (name) => controller.register(name, {
    activate: () => calls.push(`activate:${name}`),
    focus: () => calls.push(`focus:${name}`),
    blur: () => calls.push(`blur:${name}`),
  });
  register('first');
  register('second');
  register('third');

  const tab = key('Tab');
  keyboard.emit('keydown', tab.event);
  keyboard.emit('keydown', key('ArrowRight').event);
  keyboard.emit('keydown', key('ArrowDown').event);
  keyboard.emit('keydown', key('ArrowLeft').event);
  keyboard.emit('keydown', key('Tab', { shiftKey: true }).event);

  assert.equal(tab.wasPrevented(), true);
  assert.deepEqual(calls, [
    'focus:first',
    'blur:first', 'focus:second',
    'blur:second', 'focus:third',
    'blur:third', 'focus:second',
    'blur:second', 'focus:first',
  ]);
});

test('disabled controls are omitted from focus traversal', () => {
  const { keyboard, controller } = createController();
  const calls = [];
  controller.register('first', { activate: () => calls.push('first') });
  controller.register('disabled', { activate: () => calls.push('disabled'), enabled: false });
  controller.register('last', { activate: () => calls.push('last') });

  keyboard.emit('keydown', key('ArrowDown').event);
  keyboard.emit('keydown', key('ArrowDown').event);
  keyboard.emit('keydown', key('Enter').event);

  assert.deepEqual(calls, ['last']);
});

test('Enter and Space activate once per key press and prevent browser defaults', () => {
  const { keyboard, controller } = createController();
  let activations = 0;
  controller.register('button', { activate: () => { activations += 1; } });
  keyboard.emit('keydown', key('Tab').event);

  const enter = key('Enter');
  keyboard.emit('keydown', enter.event);
  keyboard.emit('keydown', key('Enter', { repeat: true }).event);
  keyboard.emit('keydown', key('Enter').event);
  keyboard.emit('keyup', key('Enter').event);
  const space = key(' ');
  keyboard.emit('keydown', space.event);
  keyboard.emit('keydown', key('Spacebar', { repeat: true }).event);

  assert.equal(enter.wasPrevented(), true);
  assert.equal(space.wasPrevented(), true);
  assert.equal(activations, 2);
});

test('reset blurs and removes all targets so refreshed controls start clean', () => {
  const { keyboard, controller } = createController();
  const calls = [];
  controller.register('old', {
    activate: () => calls.push('old:activate'),
    focus: () => calls.push('old:focus'),
    blur: () => calls.push('old:blur'),
  });
  keyboard.emit('keydown', key('Tab').event);
  controller.reset();
  keyboard.emit('keydown', key('Enter').event);
  controller.register('new', {
    activate: () => calls.push('new:activate'),
    focus: () => calls.push('new:focus'),
  });
  keyboard.emit('keydown', key('Tab').event);
  keyboard.emit('keyup', key('Enter').event);
  keyboard.emit('keydown', key('Enter').event);

  assert.deepEqual(calls, ['old:focus', 'old:blur', 'new:focus', 'new:activate']);
});

test('destroy removes key handlers, clears focus, and is safe to call twice', () => {
  const { keyboard, controller } = createController();
  const calls = [];
  controller.register('button', {
    activate: () => calls.push('activate'),
    focus: () => calls.push('focus'),
    blur: () => calls.push('blur'),
  });
  keyboard.emit('keydown', key('Tab').event);

  controller.destroy();
  controller.destroy();
  keyboard.emit('keydown', key('Enter').event);

  assert.deepEqual(calls, ['focus', 'blur']);
  assert.equal(keyboard.handlers.get('keydown').size, 0);
  assert.equal(keyboard.handlers.get('keyup').size, 0);
});
