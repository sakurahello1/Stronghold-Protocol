import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { WorkerSimHost, WORKER_LOAD_TIMEOUT_MS, WORKER_TIMEOUT_MS } from '../../public/js/battle/simHost.js';
import { createStore, initialState } from '../../public/js/store.js';
import { fixtureSet, fixtureSpec, scriptSet } from '../helpers/simHostFixture.js';

const waitFor = async predicate => {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < 15000, 'worker diagnostic condition became true');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};
function setup(set, factory) {
  const store = createStore(initialState), commands = [], ports = [], failures = [], sent = [];
  const workerFactory = () => {
    const worker = new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
    const port = { terminated: 0, postMessage: message => { commands.push(message.method); worker.postMessage(message); },
      terminate: () => { port.terminated++; worker.terminate(); } };
    worker.on('message', data => port.onmessage?.({ data }));
    worker.on('error', error => port.onerror?.(error));
    ports.push(port);
    return port;
  };
  const runner = createBattleRunner({ store, workerFactory: factory || workerFactory,
    contentFor: async cs => cs === set.cs ? set : null, simContent: () => set, vanillaCs: () => 'b'.repeat(64),
    net: { on: () => () => {}, send() {}, request: async (kind, fields) => { sent.push({ kind, ...fields }); } },
    raf: () => 1, caf() {}, setInterval: () => 1, clearInterval() {}, doc: null, now: () => 1000,
    toast: text => failures.push(text) });
  const phase = (name, round = 1) => store.set(s => ({ room: { content: { vanilla: false, cs: set.cs } },
    match: { ...s.match, public: { phase: name, round } } }));
  return { runner, phase, ports, commands, failures, sent };
}

test('data-only engine warms during briefing and is reused next round without leaking battle state', { timeout: 60000 }, async t => {
  const set = fixtureSet(), spec = { ...fixtureSpec(), cs: set.cs };
  const s = setup(set);
  t.after(() => s.runner.dispose());
  s.phase('INFO_CHECK');
  await waitFor(() => s.ports.length === 1 && !s.runner.stats().battles);
  s.phase('BAND_DRAFT');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(s.ports.length, 1, 'briefing -> band draft preserves the warming worker');
  assert.equal(s.ports[0].terminated, 0);
  s.phase('PREP');
  await s.runner.onStart({ battleId: 'first', fieldId: 'n:p1', authoritative: true, spec: { ...spec, battleId: 'first' } });
  const first = s.runner._entries.get('first');
  assert.ok(first);
  const host = first.host;
  await host.step(8, {});
  const firstTick = host.battle.tickCount;
  assert.ok(firstTick > 0);
  host.statsCache.set(999, { old: true });
  s.phase('COMBAT');
  s.phase('PREP', 2);
  await s.runner.onStart({ battleId: 'second', fieldId: 'n:p1', authoritative: true, spec: { ...spec, battleId: 'second' } });
  const second = s.runner._entries.get('second');
  assert.equal(second.host, host, 'same content/engine, a new Battle');
  assert.equal(host.battle.tickCount, 0);
  assert.equal(host.statsCache.size, 0);
  assert.equal(s.ports.length, 1);
  assert.equal(s.commands.filter(x => x === 'load').length, 1);
  assert.equal(s.commands.filter(x => x === 'stop').length, 0, 'upstream start replaces the battle and clears its caches');
  assert.equal(s.commands.filter(x => x === 'start').length, 2);
  const fresh = new WorkerSimHost({ workerFactory: () => {
    const worker = new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
    const port = { postMessage: value => worker.postMessage(value), terminate: () => worker.terminate() };
    worker.on('message', data => port.onmessage?.({ data })); worker.on('error', error => port.onerror?.(error));
    return port;
  } });
  t.after(() => fresh.stop());
  await fresh.load(set.cs, set); await fresh.start({ ...spec, battleId: 'second' });
  assert.deepEqual(host.packet, fresh.packet, 'a reused worker starts exactly like a fresh one');
  while (!host.battle.finished) assert.deepEqual(await host.step(8, {}), await fresh.step(8, {}));
  assert.deepEqual(host.compactResult(), fresh.compactResult());
  assert.deepEqual(s.failures, []);
  s.phase('RESULT', 2);
  assert.equal(s.ports[0].terminated, 1, 'match end destroys the engine');
});

test('leaving while an engine warms cancels its RPC without a false takeover or notification', async () => {
  let port;
  const s = setup(fixtureSet(), () => (port = { terminated: 0, postMessage() {}, terminate() { this.terminated++; } }));
  s.phase('INFO_CHECK');
  await waitFor(() => !!port);
  s.runner.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(port.terminated, 1);
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.sent, []);
});

test('a background load failure is silent and the next prep can warm a new worker', async t => {
  const ports = [];
  const s = setup(fixtureSet(), () => {
    const attempt = ports.length;
    const port = { terminated: 0, terminate() { this.terminated++; }, postMessage(message) {
      queueMicrotask(() => {
        if (!attempt) port.onerror?.(new Error('cold module load failed'));
        else port.onmessage?.({ data: { id: message.id, value: { install: false } } });
      });
    } };
    ports.push(port);
    return port;
  });
  t.after(() => s.runner.dispose());
  s.phase('INFO_CHECK');
  await waitFor(() => ports[0]?.terminated === 1);
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.sent, []);
  s.phase('PREP');
  await waitFor(() => ports.length === 2);
  assert.equal(ports[1].terminated, 0);
  assert.deepEqual(s.failures, []);
  assert.deepEqual(s.sent, []);
});

test('script sets are not warmed before battle, and the execution watchdog remains 2 seconds', async () => {
  const s = setup(scriptSet('export default function(){}'));
  s.phase('INFO_CHECK');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(s.ports.length, 0);
  assert.equal(WORKER_TIMEOUT_MS, 2000);
  assert.equal(WORKER_LOAD_TIMEOUT_MS, 60000);
  s.runner.dispose();
});
