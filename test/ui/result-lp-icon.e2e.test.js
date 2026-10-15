import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRecord, recordToResult } from '../../public/js/ui/stats.js';

const executable = process.env.CHROME_PATH;

test('live results and saved replay show aligned LP towers for survivors and eliminated players', {
  skip: process.env.SP_E2E !== '1' || !executable || !fs.existsSync(executable), timeout: 120000,
}, async t => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  t.diagnostic('starting isolated server');
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  let browser;
  try {
    t.diagnostic('opening headless Chrome');
    browser = await puppeteer.launch({ executablePath: executable, headless: true, args: ['--disable-gpu'] });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    t.diagnostic('loading result styles');
    await page.setRequestInterception(true);
    page.on('request', request => {
      // A result fixture needs the page styles, not the lobby's socket/session/router startup.
      void (new URL(request.url()).pathname === '/js/main.js' ? request.abort() : request.continue());
    });
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
    const fixture = {
      modeId: 'mode_multi_normal', victory: true, roundsPassed: 14, teamLp: 27, teamLpAtFinal: 27,
      players: [
        { playerId: 'a', seat: 0, name: 'A', alive: true, lp: 10, lpAtFinal: 10 },
        { playerId: 'b', seat: 1, name: 'B', alive: true, lp: 17, lpAtFinal: 17 },
        { playerId: 'c', seat: 2, name: 'C', alive: false, lp: 0 },
      ],
    };
    const replay = recordToResult(buildRecord(fixture, { myId: 'a', now: 1000 }));
    for (const [scope, res] of [['live', fixture], ['replay', replay]]) {
      t.diagnostic(`rendering ${scope} result`);
      await page.evaluate(async result => {
        const { render, h } = await import('/vendor/preact.module.js');
        const { data } = await import('/js/data.js');
        const { ResultView } = await import('/js/screens/result.js');
        const { GAME_FILES } = await import('/js/ui/gameComponents.js');
        await data.loadAll(...GAME_FILES);
        let host = document.getElementById('lp-fixture');
        if (!host) { host = document.createElement('div'); host.id = 'lp-fixture'; document.body.replaceChildren(host); }
        render(h(ResultView, { res: result, myId: 'a', quiet: true, onBack: () => {} }), host);
      }, res);
      await page.waitForFunction(() => document.querySelectorAll('.rcard .rstat .lp').length === 3);
      for (const [label, width, height] of [['desktop', 1366, 768], ['mobile', 844, 390], ['narrow', 560, 800]]) {
        t.diagnostic(`checking ${scope}/${label}`);
        await page.setViewport({ width, height });
        const rows = await page.$$eval('.rcard .rstat .lp', groups => groups.map(group => {
          const icon = group.querySelector('.lp__icon')?.getBoundingClientRect();
          const number = group.querySelector('.lp__val');
          const value = number?.getBoundingClientRect();
          const cell = group.closest('.rstat').getBoundingClientRect();
          return { text: number?.textContent, icon: !!icon && icon.width > 0 && icon.height > 0,
            before: !!icon && !!value && icon.right <= value.left + 1,
            inside: !!icon && !!value && icon.left >= cell.left && value.right <= cell.right + 1,
            iconHeight: icon?.height };
        }));
        assert.deepEqual(rows.map(row => row.text), ['10(27/27)', '17(27/27)', '0']);
        assert.ok(rows.every(row => row.icon && row.before && row.inside), `${scope}/${label}: ${JSON.stringify(rows)}`);
        assert.ok(rows.every(row => Math.abs(row.iconHeight - rows[2].iconHeight) < 1), 'same icon size as eliminated players');
        fs.mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
        await page.screenshot({ path: fileURLToPath(new URL(`../e2e/out/result-lp-icon-${scope}-${label}.png`, import.meta.url)) });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
