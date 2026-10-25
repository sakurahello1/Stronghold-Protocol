import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TestClient } from '../helpers/wsClient.js';

const executable = process.env.CHROME_PATH;
test('server lobby shows real rooms, joins before start, and spectates a running simulation', {
  skip: process.env.SP_E2E !== '1' || !executable || !fs.existsSync(executable), timeout: 120000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const P = (await import('puppeteer-core')).default;
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, seedFn: () => 123 });
  const hosts = []; let browser;
  const request = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok');
  const create = async (name, difficulty) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`); hosts.push(c);
    await c.hello(name); await request(c, { t: 'room.create', mode: 'coop', difficulty });
    return { client: c, code: (await c.waitFor('room.state')).code };
  };
  try {
    const ready = await create('准备中的房主', 'NORMAL');
    const running = await create('游戏中的房主', 'HARD');
    await request(ready.client, { t: 'room.addBot' });
    await request(running.client, { t: 'room.start' });
    browser = await P.launch({ executablePath: executable, headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', '大厅测试玩家'); sessionStorage.setItem('sp.entered', '1'); });
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hub-entry--coop', { visible: true });
    await page.click('.hub-entry--coop');
    await page.waitForSelector(`.server-rooms tr[data-room="${running.code}"]`);
    const selector = code => `.server-rooms tr[data-room="${code}"]`;
    const rows = await page.$$eval('.server-rooms tbody tr', list => list.map(row => ({
      code: row.dataset.room, text: row.textContent, disabled: [...row.querySelectorAll('button')].map(b => b.disabled),
    })));
    assert.ok(rows.find(r => r.code === ready.code).text.includes('准备中的房主'));
    assert.ok(rows.find(r => r.code === ready.code).text.includes('2/4'));
    assert.ok(rows.find(r => r.code === ready.code).text.includes('准备中'));
    assert.deepEqual(rows.find(r => r.code === ready.code).disabled, [false, false]);
    assert.ok(rows.find(r => r.code === running.code).text.includes('游戏中'));
    assert.ok(rows.find(r => r.code === running.code).text.includes('绝境模拟'));
    assert.deepEqual(rows.find(r => r.code === running.code).disabled, [true, false]);
    for (const [label, width, height] of [['desktop', 1366, 768], ['mobile', 844, 390]]) {
      await page.setViewport({ width, height });
      const layout = await page.$eval('.server-rooms', el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: innerWidth }));
      assert.ok(layout.left >= 0 && layout.right <= layout.width + 1);
      fs.mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL(`../e2e/out/server-rooms-${label}.png`, import.meta.url)) });
    }
    // Automatic refresh must show current settings, not a stale cached list.
    await request(ready.client, { t: 'room.setDifficulty', difficulty: 'ABYSS' });
    await page.waitForFunction(sel => document.querySelector(sel)?.textContent.includes('终极模拟'), { timeout: 10000 }, selector(ready.code));
    await page.click(`${selector(ready.code)} button:first-child`);
    await page.waitForFunction(code => window.__SP__.store.get().room?.code === code, {}, ready.code);
    let state = await page.evaluate(() => ({ room: window.__SP__.store.get().room, id: window.__SP__.store.get().me.playerId }));
    assert.ok(state.room.seats.some(s => s?.playerId === state.id));
    assert.ok(!state.room.spectators.some(s => s.playerId === state.id));
    await page.click('button[aria-label="离开同盟"]');
    // The router restores the lobby component with its alliance dialog still open on some transition frames.
    await page.waitForFunction(() => window.__SP__.store.get().room == null);
    if (!await page.$('.server-rooms')) {
      await page.waitForSelector('.hub-entry--coop', { visible: true });
      await page.click('.hub-entry--coop');
    }
    await page.waitForSelector(selector(running.code));
    await page.$eval(selector(running.code), row => [...row.querySelectorAll('button')].find(b => b.textContent.includes('观战')).click());
    await page.waitForFunction(code => {
      const s = window.__SP__.store.get();
      return s.room?.code === code && s.room.spectators.some(p => p.playerId === s.me.playerId) && !!s.match.public;
    }, {}, running.code);
    state = await page.evaluate(() => ({ room: window.__SP__.store.get().room, id: window.__SP__.store.get().me.playerId }));
    assert.ok(!state.room.seats.some(s => s?.playerId === state.id));
    assert.equal(state.room.inMatch, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await Promise.all(hosts.map(c => c.terminate())); await server.close();
  }
});
