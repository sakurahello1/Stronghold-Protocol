import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineupUnit, LineupThumb } from '../../public/js/screens/result.js';
import { ItemIcon } from '../../public/js/ui/gameComponents.js';
import { buildRecord, recordToResult } from '../../public/js/ui/stats.js';

function walk(v) {
  if (Array.isArray(v)) return v.flatMap(walk);
  if (!v || typeof v !== 'object') return [];
  return [v, ...walk(v.props?.children)];
}
test('equipment is below its operator, in order, including duplicate equipment', () => {
  const u = { id: 'chess', items: ['a', 'b', 'a', null, ''] };
  const node = LineupUnit({ u, gd: {} });
  const nodes = walk(node);
  assert.equal(node.props['data-chess'], u.id);
  assert.equal(nodes.find(v => v.type === LineupThumb).props.u, u);
  assert.deepEqual(nodes.filter(v => v.type === ItemIcon).map(v => v.props.itemId), ['a', 'b', 'a']);
  assert.ok(nodes.filter(v => v.type === ItemIcon).every(v => v.props.showTier === false));
});
test('missing and empty equipment do not create placeholder rows', () => {
  for (const items of [undefined, [], null]) {
    const nodes = walk(LineupUnit({ u: { id: 'chess', items }, gd: {} }));
    assert.ok(!nodes.some(v => v.props?.class === 'rcard__equipment'));
  }
});
test('full saved match records preserve equipment for the same settlement component', () => {
  const lineup = [{ id: 'chess', items: ['a', 'b', 'a', 'c'] }];
  const rec = buildRecord({ players: [{ playerId: 'p', lineup }] }, { myId: 'p', now: 1000 });
  const replay = recordToResult(rec);
  assert.deepEqual(replay.players[0].lineup[0].items, lineup[0].items);
  assert.deepEqual(walk(LineupUnit({ u: replay.players[0].lineup[0], gd: {} }))
    .filter(v => v.type === ItemIcon).map(v => v.props.itemId), lineup[0].items);
});
