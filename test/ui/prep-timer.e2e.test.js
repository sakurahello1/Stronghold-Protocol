import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const executable = process.env.CHROME_PATH;
test('room checkbox is host-only, syncs guests, resets readiness, and is frozen into the real match', {
  skip: process.env.SP_E2E !== '1' || !executable || !fs.existsSync(executable), timeout: 240000,
}, async t => {
  const { startServer } = await import('../../server/index.js');
  const P = (await import('puppeteer-core')).default;
  const s = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, seedFn: () => 123 });
  t.diagnostic('server ready');
  let browser;
  try {
    browser = await P.launch({ executablePath: executable, headless: true, protocolTimeout: 30000,
      args: ['--no-sandbox', '--no-proxy-server', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const errors = [];
    const open = async name => {
      const context = await browser.createBrowserContext(); const p = await context.newPage();
      t.diagnostic(`${name}: page ready`);
      p.on('pageerror', e => errors.push(e.message));
      await p.setViewport({ width: 1366, height: 768 });
      await p.evaluateOnNewDocument(n => { localStorage.setItem('sp.name', n); sessionStorage.setItem('sp.entered', '1'); }, name);
      // This suite checks room controls, not GPU rendering; keep all three clients lightweight.
      await p.goto(`http://127.0.0.1:${s.port}/?render=fallback&board=2d`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online', { polling: 100 });
      t.diagnostic(`${name}: online`);
      return p;
    };
    const send = (p, type, args = {}) => p.evaluate(async (t, a) => (await import('/js/net.js')).net.request(t, a), type, args);
    const clickText = (p, text) => p.$$eval('.room-bar button', (buttons, t) => buttons.find(b =>
      (b.querySelector('.proto-start__label')?.textContent || b.textContent).trim() === t).click(), text);
    const host = await open('计时器房主');
    await send(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' });
    await host.waitForSelector('.rs-pill__gear'); await host.click('.rs-pill__gear');
    await host.waitForSelector('.prep-timer input');
    t.diagnostic('host timer visible');
    const code = await host.evaluate(() => window.__SP__.store.get().room.code);
    const guest = await open('计时器队友'); await send(guest, 'room.join', { code });
    await guest.waitForSelector('.rs-pill__gear'); await guest.click('.rs-pill__gear');
    await guest.waitForSelector('.prep-timer input');
    t.diagnostic('guest timer visible');
    assert.equal(await host.$eval('.prep-timer input', e => e.checked && !e.disabled), true);
    assert.equal(await guest.$eval('.prep-timer input', e => e.checked && e.disabled), true);
    await clickText(guest, '准备就绪');
    if (!await guest.$('.prep-timer input')) await guest.click('.rs-pill__gear');
    await host.waitForFunction(() => window.__SP__.store.get().room.seats.filter(Boolean).filter(p => p.playerId !== window.__SP__.store.get().me.playerId).every(p => p.ready));
    await host.bringToFront(); await host.click('.prep-timer input');
    await host.waitForFunction(() => window.__SP__.store.get().room.prepTimer === false, { polling: 100 });
    await guest.bringToFront();
    await guest.waitForFunction(() => !document.querySelector('.prep-timer input').checked, { polling: 100 });
    assert.equal(await guest.evaluate(() => {
      const st = window.__SP__.store.get(); return st.room.seats.find(p => p?.playerId === st.me.playerId).ready;
    }), false);
    assert.equal(s.lobby.rooms.get(code).prepTimer, false);
    t.diagnostic('toggle synced');
    await host.bringToFront();
    for (const [label, width, height] of [['desktop', 1366, 768], ['mobile', 844, 390]]) {
      await host.setViewport({ width, height });
      const box = await host.$eval('.prep-timer', e => {
        const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight };
      });
      assert.ok(box.x >= 0 && box.y >= 0 && box.right <= box.w + 1 && box.bottom <= box.h + 1, JSON.stringify(box));
      fs.mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
      await host.screenshot({ path: fileURLToPath(new URL(`../e2e/out/prep-timer-${label}.png`, import.meta.url)) });
    }
    await clickText(guest, '准备就绪');
    await host.bringToFront();
    await host.waitForFunction(() => window.__SP__.store.get().room.seats.filter(Boolean).every(p => p.ready || p.playerId === window.__SP__.store.get().me.playerId), { polling: 100 });
    await clickText(host, '开始模拟');
    await host.waitForFunction(() => !!window.__SP__.store.get().match.public);
    assert.equal(s.lobby.rooms.get(code).match.prepTimer, false);
    t.diagnostic('multiplayer started');
    // Solo uses the same host control, but defaults to the original untimed preparation.
    const solo = await open('独立计时测试'); await send(solo, 'room.create', { mode: 'solo', difficulty: 'NORMAL' });
    await solo.waitForSelector('.rs-pill__gear'); await solo.click('.rs-pill__gear');
    await solo.waitForSelector('.prep-timer input');
    assert.equal(await solo.$eval('.prep-timer input', e => e.checked), false);
    await solo.click('.prep-timer input');
    await solo.waitForFunction(() => window.__SP__.store.get().room.prepTimer === true);
    assert.ok(await solo.$eval('.solo-brief', e => e.textContent.includes('开启后单人也计时')));
    await clickText(solo, '开始模拟');
    await solo.waitForFunction(() => !!window.__SP__.store.get().match.public);
    const soloCode = await solo.evaluate(() => window.__SP__.store.get().room.code);
    assert.equal(s.lobby.rooms.get(soloCode).match.prepTimer, true);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await s.close(); }
});
