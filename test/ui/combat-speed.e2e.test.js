import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const executable = process.env.CHROME_PATH;
test('2× HUD: four real browsers vote, withdraw, sync playback, exclude spectators, and fit desktop/mobile', {
  skip: process.env.SP_E2E !== '1' || !executable || !fs.existsSync(executable), timeout: 300000,
}, async t => {
  const { startServer } = await import('../../server/index.js');
  const P = (await import('puppeteer-core')).default;
  const s = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, seedFn: () => 123 });
  t.diagnostic('server ready');
  let browser;
  try {
    browser = await P.launch({ executablePath: executable, headless: true,
      args: ['--disable-gpu', '--no-proxy-server', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    t.diagnostic('browser ready');
    const errors = [];
    const open = async name => {
      const ctx = await browser.createBrowserContext(); const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(e.message));
      await p.setViewport({ width: 1366, height: 768 });
      await p.evaluateOnNewDocument(n => { localStorage.setItem('sp.name', n); sessionStorage.setItem('sp.entered', '1'); }, name);
      await p.goto(`http://127.0.0.1:${s.port}/?render=fallback&board=2d`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online', { polling: 100 });
      return p;
    };
    const send = (p, t, a = {}) => p.evaluate(async (t, a) => (await import('/js/net.js')).net.request(t, a), t, a);
    const host = await open('倍速房主'); await send(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' });
    t.diagnostic('host room ready');
    const code = await host.evaluate(() => window.__SP__.store.get().room.code);
    const players = [host];
    for (let i = 1; i < 4; i++) { const p = await open(`倍速队友${i}`); await send(p, 'room.join', { code }); players.push(p); await send(p, 'room.ready', { ready: true }); }
    const spectator = await open('倍速观众'); await send(spectator, 'room.spectate', { code });
    t.diagnostic('four players and spectator ready');
    await send(host, 'room.start');
    const m = s.lobby.rooms.get(code).match;
    // Exercise the real socket, UI and deterministic browser runner without waiting through unrelated drafts.
    m.guard(() => { m.prepTimer = false; m.startRound(1); m.enterPrep(); });
    assert.equal(m.errorCount, 0, JSON.stringify(m.errors));
    for (const p of [...players, spectator]) { await p.bringToFront(); await p.waitForSelector('[data-testid="combat-speed"]'); }
    t.diagnostic('HUD visible');
    await host.waitForFunction(() => window.__SP__.store.get().match.public.phase === 'PREP', { polling: 100 });
    const clickVote = async p => { await p.bringToFront(); await p.click('[data-testid="combat-speed"]'); };
    const votes = async n => {
      for (const p of [...players, spectator]) await p.waitForFunction(n => window.__SP__.store.get().match.public.combatSpeedVote.voters.length === n, { polling: 100 }, n);
    };
    assert.equal(await spectator.$eval('[data-testid="combat-speed"]', b => b.disabled), true);
    await clickVote(players[0]); await votes(1);
    await clickVote(players[1]); await votes(2);
    assert.equal(m.gameSpeed, 2);
    await clickVote(players[2]); await votes(3);
    assert.equal(m.combatSpeedState().enabled, true); assert.equal(m.gameSpeed, 2, 'PREP never speeds up');
    m.guard(() => { m.setDeadline(0, () => {}); m.startCombat(); });
    for (const p of [...players, spectator]) {
      await p.waitForFunction(() => window.__SP__.store.get().match.battle?.speed === 4, { polling: 100 });
      await p.waitForFunction(() => document.querySelector('[data-testid="combat-speed"]').dataset.active === 'true', { polling: 100 });
    }
    assert.equal(m.gameSpeed, 4);
    t.diagnostic('all clients accelerated');
    assert.equal(await players[3].$eval('[data-testid="combat-speed"]', b => b.getAttribute('aria-pressed')), 'false', 'global activation does not pretend everyone voted');
    for (const [label, width, height] of [['desktop', 1366, 768], ['mobile', 844, 390]]) {
      await host.bringToFront(); await host.setViewport({ width, height });
      const box = await host.$eval('[data-testid="combat-speed"]', e => {
        const r = e.getBoundingClientRect(); const ready = document.querySelector('.gtop__clock')?.getBoundingClientRect();
        return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight, clockTop: ready?.top };
      });
      assert.ok(box.x > box.w / 2 && box.y >= 0 && box.right <= box.w + 1 && box.bottom <= box.h, JSON.stringify(box));
      if (box.clockTop != null) assert.ok(box.bottom <= box.clockTop + 1, 'button does not cover the countdown');
      fs.mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
      await host.screenshot({ path: fileURLToPath(new URL(`../e2e/out/combat-speed-${label}.png`, import.meta.url)) });
    }
    await clickVote(players[2]); await votes(2);
    for (const p of [...players, spectator]) await p.waitForFunction(() => window.__SP__.store.get().match.battle?.speed === 2, { polling: 100 });
    assert.equal(m.gameSpeed, 2);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await s.close(); }
});
