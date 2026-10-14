import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecord, recordToResult } from '../../public/js/ui/stats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executable = process.env.CHROME_PATH;
test('live settlement and saved replay keep equipment below its operator on desktop and mobile', {
  skip: process.env.SP_E2E !== '1' || !executable || !fs.existsSync(executable), timeout: 120000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: executable, headless: true });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' });
    const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/stats-results.json'), 'utf8'))['coop4-hard'];
    const items = fixture.players[0].lineup[0].items;
    fixture.players[0].lineup[0].items = [items[0], items[1], items[0], items[1]];
    const replay = recordToResult(buildRecord(fixture, { myId: fixture.players[0].playerId, now: 1000 }));
    for (const [scope, res] of [['live', fixture], ['replay', replay]]) {
      await page.evaluate(async result => {
        const { render, h } = await import('/vendor/preact.module.js');
        const { data } = await import('/js/data.js');
        const { ResultView } = await import('/js/screens/result.js');
        const { GAME_FILES } = await import('/js/ui/gameComponents.js');
        await data.loadAll(...GAME_FILES);
        let host = document.getElementById('equipment-fixture');
        if (!host) { host = document.createElement('div'); host.id = 'equipment-fixture'; document.body.replaceChildren(host); }
        render(h(ResultView, { res: result, myId: result.players[0].playerId, quiet: true, onBack: () => {} }), host);
      }, res);
      await page.waitForSelector('.rcard__unit');
      for (const [label, width, height] of [['desktop', 1366, 768], ['mobile', 844, 390]]) {
        await page.setViewport({ width, height });
        await page.$$eval('.rcard img', imgs => imgs.forEach(img => { img.loading = 'eager'; }));
        await page.waitForFunction(() => [...document.querySelectorAll('.rcard img')].every(img => img.complete), { timeout: 30000 });
        const equipment = await page.$$eval('.rcard__unit', units => units.map(unit => {
          const portrait = unit.querySelector(':scope > .uthumb').getBoundingClientRect();
          const column = unit.getBoundingClientRect();
          return [...unit.querySelectorAll('[data-item]')].map(item => {
            const box = item.getBoundingClientRect();
            return { id: item.dataset.item, below: box.top >= portrait.bottom, small: box.width < portrait.width,
              inside: box.left >= column.left - 1 && box.right <= column.right + 1,
              named: !!item.querySelector('.uthumb')?.title };
          });
        }));
        const expected = res.players.flatMap(p => p.lineup.slice(0, 10).map(u => u.items || []));
        assert.deepEqual(equipment.map(row => row.map(item => item.id)), expected);
        assert.ok(equipment.flat().length > 0);
        assert.ok(equipment.flat().every(item => item.below && item.small && item.inside && item.named), `${scope}/${label}`);
        const out = path.join(root, 'test/e2e/out'); fs.mkdirSync(out, { recursive: true });
        await page.screenshot({ path: path.join(out, `result-equipment-${scope}-${label}.png`) });
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await server.close(); }
});
