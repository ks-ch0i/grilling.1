import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createInitialState } from '../src/game/domain/stateFactory.js';

class FakeElement {
  hidden = true;
  textContent = '';
  listeners = new Map();
  children = [];
  classList = {
    add() {},
    remove() {},
    toggle() {},
  };

  addEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  async click() {
    for (const listener of this.listeners.get('click') ?? []) await listener();
  }

  replaceChildren(...children) {
    this.children = children;
  }

  append(child) {
    this.children.push(child);
  }

  setAttribute() {}
}

class MemoryStorage {
  values = new Map();

  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function createEnvironment() {
  const descriptors = Object.fromEntries(['document', 'window', 'localStorage', 'fetch'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]));
  const selectors = [
    '#game', '#auth-gate', '#auth-message', '#sign-in-button', '#retry-auth-button',
    '#account-choices', '#account-status', '#save-warning',
  ];
  const elements = new Map(selectors.map((selector) => [selector, new FakeElement()]));
  const windowListeners = new Map();
  const document = {
    body: { classList: new FakeElement().classList, append() {} },
    addEventListener() {},
    querySelector(selector) { return elements.get(selector) ?? null; },
    createElement() { return new FakeElement(); },
  };
  const window = {
    navigator: { onLine: false },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(eventName, listener) {
      const listeners = windowListeners.get(eventName) ?? new Set();
      listeners.add(listener);
      windowListeners.set(eventName, listeners);
    },
    removeEventListener(eventName, listener) { windowListeners.get(eventName)?.delete(listener); },
    clearTimeout() {},
    setTimeout() { return 1; },
  };

  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = new MemoryStorage();
  globalThis.fetch = async () => ({
    status: 200,
    async json() { return { revision: 1, state: createInitialState() }; },
  });

  return {
    elements,
    windowListeners,
    restore() {
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

const moduleEnvironment = createEnvironment();
const { startApplication } = await import('../src/main.js?application-startup-test');
moduleEnvironment.restore();

function createAuth() {
  const account = {
    tenantId: 'tenant-id',
    localAccountId: 'object-id',
    idTokenClaims: { oid: 'object-id' },
    username: 'test@example.invalid',
  };
  return {
    account,
    initializeAuth: async () => ({ status: 'signed-in', account }),
    selectAccount: () => ({ account }),
    signInInteractively: async () => ({ status: 'signed-in', account }),
    getApiAccessToken: async () => 'test-access-token',
  };
}

function createFakeGame() {
  return {
    events: {
      handlers: new Map(),
      once(eventName, handler) { this.handlers.set(eventName, handler); },
    },
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for application startup state.');
}

test('startup keeps the auth gate visible until the async game factory resolves', async (t) => {
  const environment = createEnvironment();
  t.after(environment.restore);
  let resolveFactory;
  let startedFactory;
  const factoryStarted = new Promise((resolve) => { startedFactory = resolve; });
  const gamePromise = new Promise((resolve) => { resolveFactory = resolve; });
  const game = createFakeGame();
  let factoryCalls = 0;
  let optionsSeen;
  const auth = createAuth();

  const application = await startApplication({
    auth,
    createGameInstance: (options) => {
      factoryCalls += 1;
      optionsSeen = options;
      assert.equal(environment.windowListeners.get('offline')?.size ?? 0, 0, 'ranking must not connect before the game is ready');
      startedFactory();
      return gamePromise.then((resolvedGame) => {
        resolvedGame.events.once('destroy', () => options.rankingClient.dispose());
        return resolvedGame;
      });
    },
  });
  await factoryStarted;

  assert.equal(environment.elements.get('#auth-gate').hidden, false);
  assert.equal(application.getGame(), null);
  assert.equal(factoryCalls, 1);
  assert.equal(optionsSeen.account, auth.account);
  assert.equal(optionsSeen.gameState.progression.chapter, createInitialState().progression.chapter);
  assert.equal(typeof optionsSeen.saveState, 'function');

  resolveFactory(game);
  await waitFor(() => application.getGame() === game && environment.elements.get('#auth-gate').hidden);
  assert.equal(environment.windowListeners.get('offline')?.size, 1, 'ranking connects after game creation');

  await game.events.handlers.get('destroy')();
  assert.equal(environment.windowListeners.get('offline')?.size ?? 0, 0, 'game destruction disposes ranking listeners');
});

test('game factory failure exposes retry and a later attempt can start the same account', async (t) => {
  const environment = createEnvironment();
  t.after(environment.restore);
  const auth = createAuth();
  const game = createFakeGame();
  let factoryCalls = 0;

  const application = await startApplication({
    auth,
    createGameInstance: async (options) => {
      factoryCalls += 1;
      if (factoryCalls === 1) throw new Error('runtime chunk unavailable');
      game.events.once('destroy', () => options.rankingClient.dispose());
      return game;
    },
  });
  await waitFor(() => !environment.elements.get('#retry-auth-button').hidden);

  assert.equal(application.getGame(), null);
  assert.match(environment.elements.get('#auth-message').textContent, /게임 런타임/);
  assert.equal(environment.elements.get('#auth-gate').hidden, false);

  await environment.elements.get('#retry-auth-button').click();
  await waitFor(() => application.getGame() === game && environment.elements.get('#auth-gate').hidden);

  assert.equal(factoryCalls, 2);
  assert.equal(environment.windowListeners.get('offline')?.size, 1);
  await game.events.handlers.get('destroy')();
});

test('Phaser and the Scene graph are dynamically imported by the game factory', async () => {
  const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import\s+Phaser\s+from\s+['"]phaser['"]/m);
  assert.doesNotMatch(source, /^import\s+\{\s*createGameConfig\s*\}\s+from/m);
  assert.match(source, /await import\(['"]phaser['"]\)/);
  assert.match(source, /await import\(['"]\.\/game\/config\.js['"]\)/);
});
