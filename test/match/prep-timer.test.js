import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { phaseTotalSeconds } from '../../public/js/ui/gameLogic/phases.js';

for (const [mode, humans, bots] of [['solo', 1, 0], ['coop', 1, 0], ['coop', 1, 3], ['coop', 2, 0], ['coop', 4, 0]]) {
  for (const on of [false, true]) test(`PREP timer ${on}: ${mode}, ${humans} humans, ${bots} bots`, () => {
    const h = makeMatch({ mode, humans, bots, prepTimer: on, fake: true, instant: false }).start();
    const m = h.m;
    try {
      h.toPrep(1);
      const seconds = mode === 'solo' ? m.gd.roundCfg(m.round).prepTimeData : m.gd.prepTime(m.round);
      const wait = seconds * 1000;
      assert.ok(wait > 0);
      assert.equal(m.prepTimer, on);
      const pub = m.publicView();
      assert.equal(pub.prepTimer, on);
      if (on) assert.equal(phaseTotalSeconds(pub, m.gd.config), seconds, 'HUD gauge uses the actual configured duration');
      if (on) {
        assert.equal(m.deadline - h.sched.now(), wait);
        h.sched.advance(wait - 1); assert.equal(m.phase, PHASE.PREP);
        h.sched.advance(1); assert.notEqual(m.phase, PHASE.PREP, 'timeout really ends PREP');
      } else {
        assert.equal(m.deadline, 0);
        h.sched.advance(wait * 2 + 1000);
        assert.equal(m.phase, PHASE.PREP, 'untimed preparation does not auto-end');
        for (const ps of m.alivePlayers()) if (!ps.isBot) m.handle(ps.playerId, { t: 'g.ready', ready: true });
        h.sched.advance(0);
        assert.notEqual(m.phase, PHASE.PREP, 'everyone ready still ends an untimed phase');
      }
      assert.ok(m.deadline > 0, 'the combat timer is not disabled');
      h.invariants(); assert.deepEqual(h.logs.error, []);
    } finally { m.dispose(); }
  });
}

test('omitted options preserve legacy solo/single-human/multi-human timing', () => {
  for (const humans of [1, 2]) {
    const h = makeMatch({ mode: 'coop', humans, fake: true }).start();
    try {
      h.toPrep(1); assert.equal(h.m.prepTimer, null); assert.equal(h.m.deadline > 0, humans > 1);
      assert.equal(Object.hasOwn(h.m.publicView(), 'prepTimer'), false, 'legacy wire shape is unchanged');
    }
    finally { h.m.dispose(); }
  }
});

test('explicitly enabled timer stays positive even if optional raw duration is missing or invalid', () => {
  const h = makeMatch({ mode: 'solo', prepTimer: true, fake: true });
  try {
    for (const raw of [undefined, null, 0, -1, NaN, Infinity]) {
      h.m.gd.roundCfg = () => ({ prepTime: null, prepTimeData: raw });
      assert.equal(h.m.gd.prepTime(1), null, 'legacy untimed data stays untimed');
      assert.equal(h.m.gd.prepTime(1, { force: true }), 90, 'explicit timing has a finite positive fallback');
    }
  } finally { h.m.dispose(); }
});

test('explicit PREP setting never changes briefing or strategy-draft timers', () => {
  for (const humans of [1, 2]) for (const prepTimer of [false, true]) {
    const h = makeMatch({ mode: 'coop', humans, prepTimer, fake: true }).start();
    try {
      assert.equal(h.m.phase, PHASE.INFO_CHECK);
      assert.equal(h.m.deadline > 0, humans > 1);
      for (const ps of h.m.humans()) h.m.handle(ps.playerId, { t: 'g.infoReady' });
      h.run(() => h.m.phase === PHASE.BAND_DRAFT);
      assert.equal(h.m.phase, PHASE.BAND_DRAFT);
      assert.equal(h.m.deadline > 0, humans > 1);
    } finally { h.m.dispose(); }
  }
});
