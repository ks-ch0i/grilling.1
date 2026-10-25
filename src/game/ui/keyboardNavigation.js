const FORWARD_KEYS = new Set(['tab', 'arrowdown', 'arrowright']);
const BACKWARD_KEYS = new Set(['arrowup', 'arrowleft']);

function normalizeKey(event) {
  if (event.key === ' ' || event.key === 'Spacebar') return 'space';
  return String(event.key ?? '').toLowerCase();
}

export function createKeyboardNavigation(scene) {
  const keyboard = scene?.input?.keyboard;
  if (!keyboard || typeof keyboard.on !== 'function' || typeof keyboard.off !== 'function') {
    throw new TypeError('scene.input.keyboard must support on/off event handlers');
  }

  let targets = [];
  let focusedIndex = -1;
  let destroyed = false;
  const pressedActivationKeys = new Set();

  function focusIndex(nextIndex) {
    if (nextIndex === focusedIndex) return;
    if (focusedIndex >= 0) targets[focusedIndex]?.blur();
    focusedIndex = nextIndex;
    if (focusedIndex >= 0) targets[focusedIndex]?.focus();
  }

  function moveFocus(direction) {
    if (targets.length === 0) return;
    const nextIndex = focusedIndex < 0
      ? (direction > 0 ? 0 : targets.length - 1)
      : (focusedIndex + direction + targets.length) % targets.length;
    focusIndex(nextIndex);
  }

  function onKeyDown(event) {
    const key = normalizeKey(event);
    if (FORWARD_KEYS.has(key)) {
      event.preventDefault?.();
      moveFocus(key === 'tab' && event.shiftKey ? -1 : 1);
      return;
    }
    if (BACKWARD_KEYS.has(key)) {
      event.preventDefault?.();
      moveFocus(-1);
      return;
    }
    if (key !== 'enter' && key !== 'space') return;

    event.preventDefault?.();
    if (event.repeat || pressedActivationKeys.has(key)) return;
    pressedActivationKeys.add(key);
    if (focusedIndex >= 0) targets[focusedIndex]?.activate();
  }

  function onKeyUp(event) {
    pressedActivationKeys.delete(normalizeKey(event));
  }

  keyboard.on('keydown', onKeyDown);
  keyboard.on('keyup', onKeyUp);

  function register(target, { activate, focus, blur, enabled = true } = {}) {
    if (destroyed) throw new Error('keyboard navigation has been destroyed');
    if (!enabled) return () => {};
    if (!target || typeof activate !== 'function') {
      throw new TypeError('an enabled target and activate callback are required');
    }
    const existingIndex = targets.findIndex((entry) => entry.target === target);
    if (existingIndex >= 0) return () => unregister(target);
    targets.push({
      target,
      activate,
      focus: typeof focus === 'function' ? focus : () => {},
      blur: typeof blur === 'function' ? blur : () => {},
    });
    return () => unregister(target);
  }

  function unregister(target) {
    const index = targets.findIndex((entry) => entry.target === target);
    if (index < 0) return;
    if (index === focusedIndex) focusIndex(-1);
    targets.splice(index, 1);
    if (focusedIndex > index) focusedIndex -= 1;
  }

  function reset() {
    if (focusedIndex >= 0) targets[focusedIndex]?.blur();
    targets = [];
    focusedIndex = -1;
    pressedActivationKeys.clear();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try {
      reset();
    } finally {
      keyboard.off('keydown', onKeyDown);
      keyboard.off('keyup', onKeyUp);
    }
  }

  return { register, reset, destroy };
}
