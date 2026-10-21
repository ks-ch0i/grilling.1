import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RankingMarquee, formatRankingBoard, formatRankNotice } from '../src/game/ui/RankingMarquee.js';
import { createRankingClient, POLL_INTERVAL_MS, RETRY_DELAYS_MS } from '../src/game/domain/rankingClient.js';

function makeScheduler() {
  let nextId = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    timeouts,
    intervals,
    setTimeout(callback, delay) { const id=++nextId; timeouts.set(id,{callback,delay}); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(callback, delay) { const id=++nextId; intervals.set(id,{callback,delay}); return id; },
    clearInterval(id) { intervals.delete(id); },
    runTimeout(delay) {
      const entry = [...timeouts].find(([,timer]) => timer.delay === delay);
      assert.ok(entry, `expected a ${delay}ms timeout`);
      timeouts.delete(entry[0]);
      entry[1].callback();
    },
  };
}

function makeWindow() {
  const listeners = new Map();
  return {
    navigator:{ onLine:true },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    dispatch(name) { listeners.get(name)?.(); },
  };
}

function makeConnectionHarness() {
  const handlers = new Map();
  let reconnecting;
  let reconnected;
  let closed;
  const connection = {
    starts:0,
    stops:0,
    on(name, callback) { handlers.set(name, callback); },
    onreconnecting(callback) { reconnecting=callback; },
    onreconnected(callback) { reconnected=callback; },
    onclose(callback) { closed=callback; },
    async start() { this.starts+=1; },
    async stop() { this.stops+=1; closed?.(); },
    emit(name, payload) { handlers.get(name)?.(payload); },
    reconnecting() { reconnecting?.(); },
    reconnected() { return reconnected?.(); },
  };
  let builds=0;
  class HubConnectionBuilder {
    withUrl(url, options) { this.url=url; this.options=options; return this; }
    withAutomaticReconnect(delays) { this.delays=delays; return this; }
    build() { builds+=1; return connection; }
  }
  return { connection, signalR:{ HubConnectionBuilder }, get builds() { return builds; } };
}

function sceneObject() {
  return {
    active:true,
    text:'',
    setText(value) { this.text=value; return this; },
    setOrigin() { return this; },
    setScrollFactor() { return this; },
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    add() { return this; },
    destroy() { this.active=false; },
  };
}

function makeScene() {
  const events = {};
  const timers = { repeating:null, delayed:[] };
  return {
    events:{ once:(name, callback) => { events[name]=callback; } },
    time:{
      addEvent:(config) => { timers.repeating={ ...config, remove:() => { timers.repeating=null; } }; return timers.repeating; },
      delayedCall:(delay, callback) => { const entry={delay,callback,remove:() => { entry.removed=true; }}; timers.delayed.push(entry); return entry; },
    },
    add:{ container:() => sceneObject(), rectangle:() => sceneObject(), text:(_x,_y,text) => { const object=sceneObject(); object.text=text; return object; } },
    timers,
    shutdown:() => events.shutdown?.(),
  };
}

test('marquee formats five public rows in order and describes an empty board in Korean', () => {
  const snapshot = { stage:{ topFive:[
    { displayName:'기사1', chapter:2, stage:5, clearTimeMs:12345 },
    { displayName:'기사2', chapter:2, stage:4, clearTimeMs:15000 },
  ] } };
  const stage = formatRankingBoard(snapshot, 'stage', 'live');
  const empty = formatRankingBoard({ pvp:{ topFive:[] } }, 'pvp', 'offline');

  assert.ok(stage.indexOf('1. 기사1') < stage.indexOf('2. 기사2'));
  assert.match(stage, /실시간/);
  assert.match(empty, /아직 검증된 기록이 없습니다/);
  assert.match(empty, /오프라인 · 저장된 기록/);
});

test('rank notices explain an upward/downward change and re-entry without private IDs', () => {
  assert.match(formatRankNotice({ board:'stage', from:12, to:8 }), /4계단 상승/);
  assert.match(formatRankNotice({ board:'pvp', from:5, to:7 }), /2계단 하락/);
  assert.match(formatRankNotice({ board:'pvp', from:null, to:3 }), /랭킹 진입 · 3위/);
});

test('town inventory hint stays inside the shifted panel bottom edge', () => {
  const townScene = readFileSync(new URL('../src/game/scenes/TownScene.js', import.meta.url), 'utf8');
  assert.match(townScene, /this\.add\.text\(596, 608, inventory\.length > 10[\s\S]*?\)\.setOrigin\(0, 1\)/);
});

test('marquee rotates boards every eight seconds and resumes after a five-second rank notice', () => {
  const scene = makeScene();
  let observer;
  let unsubscribed=false;
  const client = { subscribe:(listener) => { observer=listener; listener({ stage:{topFive:[]},pvp:{topFive:[{displayName:'상대',rating:1100}]},connection:'live' }); return () => { unsubscribed=true; }; } };
  const marquee = new RankingMarquee(scene, client);

  assert.match(marquee.text.text, /스테이지 TOP 5/);
  assert.equal(scene.timers.repeating.delay, 8_000);
  scene.timers.repeating.callback();
  assert.match(marquee.text.text, /PvP TOP 5/);
  observer({ stage:{topFive:[]},pvp:{topFive:[{displayName:'상대',rating:1100}]},connection:'live',rankNotice:{id:1,board:'stage',from:9,to:4} });
  assert.match(marquee.text.text, /5계단 상승/);
  assert.equal(scene.timers.delayed.at(-1).delay, 5_000);
  scene.timers.delayed.at(-1).callback();
  assert.match(marquee.text.text, /PvP TOP 5/);
  scene.shutdown();
  assert.equal(unsubscribed, true);
  assert.equal(marquee.container.active, false);
});

test('ranking client uses one SignalR connection, hydrates on connect, polls only while disconnected and refreshes rank after events', async () => {
  const scheduler = makeScheduler();
  const windowObject = makeWindow();
  const signalR = makeConnectionHarness();
  const calls = [];
  let ranks = { stage:{ rank:8, chapter:2, stage:1, clearTimeMs:10000 }, pvp:{ rank:20, rating:1000 } };
  const apiClient = {
    apiBaseUrl:'/api',
    async getRankingTop(_account, board) {
      calls.push(`top:${board}`);
      return { status:200, board, revision:`${board}-r1`, generatedAtUtc:'2026-10-21T00:00:00.000Z', topFive:[] };
    },
    async getMyRanks() { calls.push('me'); return { status:200, ...structuredClone(ranks) }; },
  };
  const client = createRankingClient({
    apiClient, account:{ localAccountId:'account' }, getAccessToken:async()=>'api-token',
    loadSignalR:async()=>signalR.signalR, windowObject,
    setTimeoutImpl:scheduler.setTimeout, clearTimeoutImpl:scheduler.clearTimeout,
    setIntervalImpl:scheduler.setInterval, clearIntervalImpl:scheduler.clearInterval,
    now:()=>new Date('2026-10-21T01:00:00.000Z'),
  });
  const live = await client.connect();
  await client.connect();

  assert.equal(live, true);
  assert.equal(signalR.builds, 1);
  assert.equal(signalR.connection.starts, 1);
  assert.equal(client.getSnapshot().connection, 'live');
  assert.deepEqual(calls.slice(0, 3), ['top:stage', 'top:pvp', 'me']);
  signalR.connection.emit('stageTopChanged', { board:'stage', revision:'stage-r2', generatedAtUtc:'2026-10-21T00:00:01.000Z', topFive:[{rank:1,displayName:'Knight',chapter:3,stage:2,clearTimeMs:9000}] });
  assert.equal(client.getSnapshot().stage.revision, 'stage-r2');
  ranks = { ...ranks, stage:{ rank:5, chapter:3, stage:2, clearTimeMs:9000 } };
  scheduler.runTimeout(60);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.getSnapshot().rankNotice, {
    id:1, board:'stage', from:8, to:5, generatedAtUtc:'2026-10-21T01:00:00.000Z',
  });

  ranks = { ...ranks, stage:{ rank:6, chapter:3, stage:2, clearTimeMs:9000 } };
  signalR.connection.emit('stageTopChanged', { board:'stage', revision:'stage-r2', generatedAtUtc:'2026-10-21T00:00:02.000Z', topFive:[{rank:1,displayName:'Knight',chapter:3,stage:2,clearTimeMs:9000}] });
  assert.ok([...scheduler.timeouts.values()].some((timer) => timer.delay === 60));
  scheduler.runTimeout(60);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(client.getSnapshot().rankNotice, {
    id:2, board:'stage', from:5, to:6, generatedAtUtc:'2026-10-21T01:00:00.000Z',
  });

  signalR.connection.reconnecting();
  assert.equal(client.getSnapshot().connection, 'reconnecting');
  assert.equal([...scheduler.intervals.values()][0].delay, POLL_INTERVAL_MS);
  assert.equal(POLL_INTERVAL_MS, 60_000);
  assert.deepEqual(RETRY_DELAYS_MS, [1000, 2000, 4000, 8000, 16000, 30000]);
  windowObject.navigator.onLine=false;
  windowObject.dispatch('offline');
  assert.equal(client.getSnapshot().connection, 'offline');
  assert.equal(scheduler.intervals.size, 0);
  await client.dispose();
  assert.equal(signalR.connection.stops, 1);
});
