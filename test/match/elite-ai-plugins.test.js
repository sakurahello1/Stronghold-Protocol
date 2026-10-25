// The reviewed additive DIY plugin must work with the original elite policies, including an isolated match host.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getData, ROOT } from '../../server/data.js';
import { applyPatches } from '../../shared/plugins/patch.js';
import { eliteAiAllowed } from '../../shared/eliteAi.js';
import { eliteAiCompatible } from '../../server/plugins/eliteAiCompatibility.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { startServer } from '../../server/index.js';
import { ERR } from '../../shared/constants.js';
import { writePlugin } from '../helpers/pluginFixtures.js';
import { TestClient } from '../helpers/wsClient.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const base = getData({ log: quiet });
const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/optional-recruits.json', import.meta.url), 'utf8'));
const patched = applyPatches(base, fixture.ops, { pluginId: 'collab-recruits' });
assert.deepEqual(patched.problems, []);
const descriptor = { plugins: [{ id: 'collab-recruits', class: 'content' }] };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-elite-recruits-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const pluginsDir = path.join(tmp, 'plugins');
const manifest = { manifest: 2, version: '1.0.1', app: '*', api: 1, class: 'content', scope: ['room'], permissions: ['data.patch'], data: ['recruits.json'] };
writePlugin(path.join(pluginsDir, 'collab-recruits'), manifest, { 'recruits.json': fixture });
writePlugin(path.join(pluginsDir, 'other-rules'), manifest, { 'recruits.json': { patch: 1, ops: [] } });
const fallbackFixture = structuredClone(fixture);
fallbackFixture.ops.find(o => o.path?.join('.') === 'diy.operators').value.char_x_collab_recruits_makoto.bonds = ['emptyShip'];
const fallbackDir = path.join(tmp, 'fallback-plugins');
writePlugin(path.join(fallbackDir, 'collab-recruits'), manifest, { 'recruits.json': fallbackFixture });

test('elite AI capability admits only the reviewed additive records, never a plugin name alone', () => {
  assert.equal(eliteAiCompatible(descriptor, patched.data, base), true);
  const fallback = applyPatches(base, fallbackFixture.ops, { pluginId: 'collab-recruits' });
  assert.deepEqual(fallback.problems, []);
  assert.equal(eliteAiCompatible(descriptor, fallback.data, base), true, 'the installed neutral Makoto variant is also additive-only');
  assert.equal(eliteAiCompatible({ plugins: [...descriptor.plugins, { id: 'skin', class: 'cosmetic' }] }, patched.data, base), true);
  for (const extra of [
    { plugins: [{ id: 'other', class: 'content' }] },
    { plugins: [...descriptor.plugins, { id: 'other', class: 'content' }] },
    { plugins: [...descriptor.plugins, { id: 'script', class: 'script' }] },
    { trusted: {} }, { execution: {} }, { modes: [{ id: 'custom' }] }, { rules: { income: 99 } },
  ]) assert.equal(eliteAiCompatible({ ...descriptor, ...extra }, patched.data, base), false, JSON.stringify(extra));
  for (const mutate of [
    d => { d.chess = {}; },
    d => { d.bonds = {}; },
    d => { d.backups.diy.ownedPool.pop(); },
    d => { d.backups.units.char_x_collab_recruits_makoto.kitRef = 'other'; },
    d => { d.backups.diy.operators.char_x_collab_recruits_oblvns.bonds = ['lateranoShip']; },
    d => { d.backups.diy.operators.extra = {}; },
  ]) {
    const changed = structuredClone(patched.data);
    mutate(changed);
    assert.equal(eliteAiCompatible(descriptor, changed, base), false);
  }
  assert.equal(eliteAiCompatible(descriptor, null, base), false);
  const presentation = { ...patched.data, assets: { changed: true } };
  assert.equal(eliteAiCompatible(descriptor, presentation, base), true);
});

test('the shared room predicate preserves vanilla, unsupported-plugin and FUNNY boundaries', () => {
  for (const difficulty of ['NORMAL', 'HARD', 'FUNNY']) {
    assert.equal(eliteAiAllowed({ difficulty }), difficulty !== 'FUNNY');
    assert.equal(eliteAiAllowed({ difficulty, version: 'act2autochess' }), difficulty !== 'FUNNY');
    for (const version of ['act1autochess', 'act1autochess@V1_1', 'act2autochess@V2_1']) {
      assert.equal(eliteAiAllowed({ difficulty, version, content: { vanilla: true } }), false);
      assert.equal(eliteAiAllowed({ difficulty, version, content: { vanilla: false, eliteAiCompatible: true } }), false);
    }
    assert.equal(eliteAiAllowed({ difficulty, content: { vanilla: true } }), difficulty !== 'FUNNY');
    assert.equal(eliteAiAllowed({ difficulty, content: { vanilla: false } }), false);
    assert.equal(eliteAiAllowed({ difficulty, content: { vanilla: false, eliteAiCompatible: true } }), difficulty !== 'FUNNY');
  }
});

test('real lobby advertises compatibility, accepts both personas and retains content-ready and unsupported-plugin guards', { timeout: 60_000 }, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir, assetIndex: false });
  let c;
  try {
    c = await TestClient.connect(srv.url.replace('http', 'ws') + '/ws');
    await c.hello('Tester');
    // Like the existing lobby plugin suite: cold composition and host launch can exceed a normal 2 s reply window.
    const request = msg => c.request(msg, 15_000);
    const ok = async msg => {
      const reply = await request(msg);
      assert.equal(reply.t, 'ok', `${JSON.stringify(msg)}: ${JSON.stringify(reply)}`);
    };
    await ok({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    await ok({ t: 'room.setPlugins', plugins: [{ id: 'collab-recruits' }] });
    const state = await c.waitFor('room.state', s => s.content?.vanilla === false);
    assert.equal(state.content.eliteAiCompatible, true);
    assert.equal(eliteAiAllowed(state), true, 'the client can enable the recruitment button');
    const picks = { chess_char_5_diy1_a: { charId: 'char_x_collab_recruits_oblvns', skillIndex: 2 },
      chess_char_6_diy1_a: { charId: 'char_x_collab_recruits_makoto', skillIndex: 2 } };
    await ok({ t: 'room.diy', picks });
    await ok({ t: 'room.addBot', persona: 'arturia' });
    await ok({ t: 'room.addBot', persona: 'lavinia' });
    assert.equal((await request({ t: 'room.addBot', persona: 'arturia' })).code, ERR.ALREADY);
    assert.equal((await request({ t: 'room.start' })).code, ERR.CONTENT_NOT_READY);
    await ok({ t: 'room.setPlugins', plugins: [{ id: 'other-rules' }] });
    const unsupported = await c.waitFor('room.state', s => s.content?.plugins.some(p => p.id === 'other-rules'));
    assert.equal(eliteAiAllowed(unsupported), false);
    assert.equal((await request({ t: 'room.addBot', persona: 'arturia' })).code, ERR.BAD_TARGET, 'unsupported plugins cannot recruit elite AI either');
    await ok({ t: 'room.contentReady', cs: unsupported.content.cs });
    assert.equal((await request({ t: 'room.start' })).code, ERR.BAD_TARGET);
    await ok({ t: 'room.setPlugins', plugins: [{ id: 'collab-recruits' }] });
    await ok({ t: 'room.contentReady', cs: state.content.cs });
    await ok({ t: 'room.start' });
    await c.waitFor('m.public', () => true, 20_000);
    const own = await c.waitFor('m.private', () => true, 20_000);
    assert.deepEqual(own.diy, Object.fromEntries(Object.entries(picks).map(([slot, pick]) => [slot, { ...pick, uniEquipId: null }])), 'the real plugin host retains the human recruits alongside elite teammates');
  } finally {
    await c?.terminate();
    await srv.close();
  }
});

for (const transport of ['process', 'worker']) {
  test(`both elite policies finish a real plugin match in a ${transport} host`, { timeout: 240_000 }, async () => {
    const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(tmp, 'packs'), pluginsDir: transport === 'worker' ? fallbackDir : pluginsDir }, { log: quiet });
    registry.refresh(true);
    const contents = createContentSets({ registry, vanillaData: base, log: quiet });
    const resolved = contents.resolve(['collab-recruits']);
    assert.equal(resolved.ok, true, `${resolved.error || ''}: ${resolved.detail || ''}`);
    const { cs } = resolved.set;
    // RoomSets adds the registry-verified class to ContentSets' plugin identities.
    assert.equal(eliteAiCompatible({ ...resolved.set, plugins: descriptor.plugins }, contents.dataOf(cs), base), true, 'real composition, not just applyPatches');
    contents.hold(cs);
    const hostLogs = [];
    const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, (...args) => hostLogs.push(`${level}: ${args.join(' ')}`)]));
    const hosts = createMatchHosts({ contents, log, options: { transport, virtualTime: true, matchOptions: { botRehearsal: 0 } } });
    const messages = [];
    let end;
    const ended = new Promise(resolve => { end = resolve; });
    const seats = ['arturia', 'lavinia', null, null].map((botPersona, seat) => ({ seat, playerId: `ai_${seat}`, name: botPersona || `AI ${seat}`, isBot: true, connected: true, ...(botPersona ? { botPersona } : {}) }));
    let m;
    let timer;
    try {
      m = hosts.create(cs, { roomCode: 'ELITE', mode: 'coop', difficulty: 'NORMAL', modeId: 'mode_multi_normal', seats, spectators: [], seed: 7, matchNo: 1, cs, requireCs: true,
        send: (_pid, msg) => { messages.push(msg); return true; }, broadcast: msg => messages.push(msg), onEnd: end });
      m.start();
      const summary = await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${transport}: elite plugin match did not finish`)), 220_000); })]);
      assert.equal(typeof summary.victory, 'boolean', JSON.stringify({ summary, hostLogs: hostLogs.slice(-15) }));
      assert.ok(summary.roundsPassed >= 2, JSON.stringify(summary));
      const diag = await m.diag();
      assert.equal(diag.errorCount, 0, JSON.stringify(diag.errors));
      assert.equal(diag.simErrors, 0, 'battle simulation completed without errors');
      assert.equal(diag.cs, cs);
      const pubs = messages.filter(x => x.t === 'm.public');
      assert.ok(pubs.length > 10);
      assert.equal(pubs.at(-1).phase, 'RESULT');
      for (const kind of ['normal', 'unite', 'boss']) assert.ok(pubs.some(p => p.fields?.some(f => f.kind === kind)), `the ${kind} battle phase actually ran`);
      assert.ok(messages.some(x => JSON.stringify(x).includes('band_paganini')), 'Arturia selected her fixed band');
      assert.ok(messages.some(x => JSON.stringify(x).includes('band_chiave')), 'Lavinia selected her fixed band');
      console.log(`${transport}: elite plugin match finished, rounds=${summary.roundsPassed}, errors=${diag.errorCount}`);
    } finally {
      clearTimeout(timer);
      m?.dispose();
      hosts.close();
      contents.release(cs);
    }
  });
}
