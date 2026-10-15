import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultLp } from '../../public/js/screens/result.js';
import { LpTower, Sprite } from '../../public/js/ui/gameComponents.js';
import { normalizeResult } from '../../public/js/ui/gameLogic/result.js';
import { buildRecord, recordToResult } from '../../public/js/ui/stats.js';

function nodes(v) {
  if (v == null || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.flatMap(nodes);
  return [v, ...nodes(v.props?.children)];
}
function text(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return v.map(text).join('');
  return text(v.props?.children);
}
const result = teamLp => ({
  modeId: 'mode_multi_normal', teamLp, teamLpAtFinal: 27,
  players: [
    { playerId: 'a', seat: 0, alive: true, lp: 10, lpAtFinal: 10 },
    { playerId: 'b', seat: 1, alive: true, lp: 17, lpAtFinal: 17 },
    { playerId: 'c', seat: 2, alive: false, lp: 0 },
  ],
});

function checkDetailed(p, expected) {
  const view = ResultLp({ p });
  const icon = nodes(view).find(v => v.type === Sprite);
  const standard = nodes(LpTower({ value: 0, size: 'sm' })).find(v => v.type === Sprite);
  assert.ok(icon, 'detailed final LP keeps the standard tower icon');
  assert.equal(icon.props.k, standard.props.k);
  assert.equal(icon.props.class, standard.props.class);
  assert.equal(icon.props.fallback.type, standard.props.fallback.type);
  assert.deepEqual(icon.props.fallback.props, standard.props.fallback.props);
  assert.equal(text(view), `剩余生命${expected}`);
  const group = nodes(view).find(v => v.props?.class === 'lp lp--sm rstat__lp-value');
  assert.ok(group, 'icon and complete LP text stay in one unbroken group');
}

test('surviving players keep the tower before the complete personal/team LP display', () => {
  const players = normalizeResult(result(27)).players;
  checkDetailed(players[0], '10(27/27)');
  checkDetailed(players[1], '17(27/27)');
});

test('zero team LP and eliminated players retain their existing numbers and tower', () => {
  const players = normalizeResult(result(0)).players;
  checkDetailed(players[0], '10(0/27)');
  const eliminated = nodes(ResultLp({ p: players[2] })).find(v => v.type === LpTower);
  assert.equal(eliminated?.props.value, 0);
});

test('saved replay uses the same detailed tower; solo and legacy results retain LpTower', () => {
  const record = buildRecord(result(27), { myId: 'a', now: 1000 });
  const p = normalizeResult(recordToResult(record)).players[0];
  checkDetailed(p, '10(27/27)');
  for (const args of [{ p, solo: true }, { p: { lp: 12 } }]) {
    assert.ok(nodes(ResultLp(args)).some(v => v.type === LpTower));
  }
  assert.equal(ResultLp({ p: { lp: null } }), null);
});
