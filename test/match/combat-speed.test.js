import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { combatSpeedModel } from '../../public/js/ui/combatSpeed.js';

const vote = (h, id, on = true) => h.m.handle(id, { t: 'g.combatSpeed', on });
function combat(options = {}) {
  const h = makeMatch({ humans: 2, clientCombat: true, clients: false, fake: true, instant: false,
    script: () => ({ duration: 60 }), ...options }).start();
  h.toPrep(1);
  h.m.guard(() => h.m.startCombat());
  return h;
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 0.002, `${message}: ${a} vs ${b}`);

for (const humans of [1, 2, 3, 4]) test(`2× vote: ${humans} humans require ${Math.max(1, humans - 1)} distinct votes`, () => {
  const h = combat({ humans, bots: 4 - humans });
  try {
    const required = Math.max(1, humans - 1);
    assert.equal(h.m.gameSpeed, 2);
    for (let i = 0; i < required; i++) {
      assert.deepEqual(vote(h, `p_${i}`), { ok: true });
      assert.deepEqual(vote(h, `p_${i}`), { ok: true }, 'repeated vote is idempotent');
      assert.equal(h.m.combatSpeedState().voters.length, i + 1);
      assert.equal(h.m.gameSpeed, i + 1 === required ? 4 : 2);
    }
    assert.equal(h.m.combatSpeedState().required, required);
    if (humans < 4) assert.ok(vote(h, 'ai_0').error);
    vote(h, 'p_0', false);
    assert.equal(h.m.gameSpeed, 2, 'withdrawal below the threshold restores the original rate');
    assert.equal(validateC2S({ t: 'g.combatSpeed', on: true }), null);
    assert.ok(validateC2S({ t: 'g.combatSpeed', on: 'true' }));
    assert.ok(h.m.setCombatSpeed(h.ps('p_0'), 1).error);
    assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});

test('mid-combat vote preserves elapsed/spec/authority and adjusts deadlines without scaling result grace', () => {
  const h = combat(); const m = h.m;
  try {
    const f = m.fields.find(f => f.authority === 'p_0');
    const spec = JSON.stringify(f.spec); const start = h.sched.now();
    const original = m.deadline;
    h.sched.advance(1000);
    const elapsed = m._fieldElapsed(f);
    vote(h, 'p_0');
    near(m._fieldElapsed(f), elapsed, 'no elapsed jump');
    assert.equal(m.deadline, start + 1000 + Math.round((original - start - 1000) / 2));
    near(f.deadlineTimer.at, f.startAt + f.spec.timeLimit / 4 * 1000 + 15000, '15 real second grace');
    const msg = h.lastTo('p_0', 'b.speed');
    assert.equal(msg.battleId, f.battleId); assert.equal(msg.speed, 4); near(msg.elapsed, elapsed, 'wire elapsed');
    assert.equal(f.authority, 'p_0'); assert.equal(JSON.stringify(f.spec), spec);
    h.sched.advance(1000);
    near(m._fieldElapsed(f), elapsed + 4, 'four game seconds per real second');
    const before = m._fieldElapsed(f); vote(h, 'p_0', false);
    near(m._fieldElapsed(f), before, 'withdrawal continuity');
    h.sched.advance(1000); near(m._fieldElapsed(f), before + 2, 'original pacing restored');
    const sync = m._startMsg(f, true);
    assert.equal(sync.speed, 2); near(sync.elapsed, m._fieldElapsed(f), 'reconnect clock');
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

test('server-run bot field releases its unchanged result on the retimed clock', () => {
  const h = combat({ humans: 1, bots: 1, script: () => ({ duration: 20 }) });
  try {
    const f = h.m.fields.find(f => f.players.includes('ai_0'));
    const result = f.result;
    h.sched.advance(1000); vote(h, 'p_0');
    assert.equal(f.result, result, 'no re-simulation');
    const wait = f.doneTimer.at - h.sched.now();
    near(wait, 4500, 'remaining 18 game seconds at rate 4');
    h.sched.advance(wait - 1); assert.equal(f.done, false);
    h.sched.advance(1); assert.equal(f.done, true);
    assert.equal(h.m.gameSpeed, 4, 'the human field still runs');
  } finally { h.m.dispose(); }
});

test('legacy server-streamed combat doubles fixed ticks, then restores them without resetting battles', () => {
  const h = combat({ clientCombat: false });
  try {
    const f = h.m.fields[0]; const battle = f.battle;
    const paced = expected => assert.ok(Math.abs(battle.time - expected) < 2 / 30, `${battle.time} vs ${expected}: within two fixed ticks`);
    h.sched.advance(1000); paced(2);
    vote(h, 'p_0'); h.sched.advance(1000); paced(6);
    vote(h, 'p_0', false); h.sched.advance(1000); paced(8);
    assert.equal(f.battle, battle); assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});

test('disconnect retains electorate/vote; elimination removes a vote and recomputes N-1', () => {
  const h = combat({ humans: 4 }); const m = h.m;
  try {
    vote(h, 'p_0'); vote(h, 'p_1'); assert.equal(m.gameSpeed, 2);
    m.onDisconnect('p_0'); m.flush(true);
    assert.equal(m.combatSpeedState().eligible.length, 4);
    assert.equal(m.combatSpeedState().voters.length, 2);
    h.ps('p_3').alive = false; m.markPublic(); m.flush(true);
    assert.equal(m.combatSpeedState().required, 2); assert.equal(m.gameSpeed, 4);
    h.ps('p_0').alive = false; m.markPublic(); m.flush(true);
    assert.deepEqual(m.combatSpeedState().voters, ['p_1']);
    assert.equal(m.combatSpeedState().required, 1);
    assert.ok(vote(h, 'p_0').error);
    h.ps('p_1').left = true; m.markPublic(); m.flush(true);
    assert.equal(m.gameSpeed, 2); assert.deepEqual(m.combatSpeedState().voters, []);
  } finally { m.dispose(); }
});

test('PREP and boss/settlement clocks remain untouched; only COMBAT and UNITE activate the vote', () => {
  const h = makeMatch({ humans: 2, prepTimer: true, fake: true, instant: false }).start();
  const m = h.m;
  try {
    h.toPrep(1); const deadline = m.deadline;
    vote(h, 'p_0'); assert.equal(m.gameSpeed, 2); assert.equal(m.deadline, deadline);
    m.guard(() => m.startCombat()); assert.equal(m.gameSpeed, 4);
    // Isolate the phase gate with live fields: none of the other phase clocks may be scaled.
    for (const phase of [PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.SETTLE, PHASE.PREP, PHASE.UNITE, PHASE.COMBAT]) {
      m.phase = phase; m.deadline = h.sched.now() + 10000; m.flush(true);
      assert.equal(m.gameSpeed, phase === PHASE.UNITE || phase === PHASE.COMBAT ? 4 : 2);
      if (phase !== PHASE.UNITE && phase !== PHASE.COMBAT) assert.equal(m.deadline, h.sched.now() + 10000);
    }
  } finally { m.dispose(); }
});

test('solo pause freezes a rate change and reconnect keeps the new rate without spending paused time', () => {
  const h = combat({ mode: 'solo', humans: 1 }); const m = h.m;
  try {
    const f = m.fields[0]; h.sched.advance(1000);
    m.handle('p_0', { t: 'g.pause', on: true });
    const gt = m._fieldElapsed(f);
    h.sched.advance(2000); vote(h, 'p_0'); h.sched.advance(2000);
    near(m._fieldElapsed(f), gt, 'paused rate change');
    assert.equal(f.deadlineTimer, null);
    m.handle('p_0', { t: 'g.pause', on: false });
    assert.equal(m._startMsg(f, true).speed, 4);
    h.sched.advance(1000); near(m._fieldElapsed(f), gt + 4, 'resumed accelerated clock');
    assert.ok(f.deadlineTimer); assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

test('HUD distinguishes personal selection, global activation and non-voting spectators', () => {
  const pub = { phase: PHASE.COMBAT, combatSpeedVote: { eligible: ['a', 'b'], voters: ['a'], required: 1, enabled: true, active: true } };
  assert.equal(combatSpeedModel(pub, 'a').selected, true);
  assert.equal(combatSpeedModel(pub, 'b').selected, false);
  assert.equal(combatSpeedModel(pub, 'b').active, true);
  assert.equal(combatSpeedModel(pub, 'viewer').canVote, false);
  assert.equal(combatSpeedModel({ ...pub, phase: PHASE.RESULT }, 'a').canVote, false);
  assert.equal(combatSpeedModel({}, 'a'), null);
});

test('real phase flow carries votes into UNITE, broadcasts to spectators, and resets speed at settlement', () => {
  const h = makeMatch({ humans: 3, spectators: ['viewer'], fake: true, clientCombat: true, instant: false,
    script: b => b.kind === 'normal' ? { leaks: { p_0: 4 } } : { duration: 8 } }).start();
  try {
    h.toPrep(1); vote(h, 'p_0'); vote(h, 'p_1');
    assert.ok(vote(h, 'viewer').error, 'spectator cannot vote');
    assert.ok(h.drive(() => h.m.phase === PHASE.UNITE));
    const f = h.m.fields[0]; assert.equal(f.kind, 'unite');
    assert.equal(h.m.gameSpeed, 4);
    const gt = h.m._fieldElapsed(f);
    vote(h, 'p_1', false); assert.equal(h.m.gameSpeed, 2);
    near(h.m._fieldElapsed(f), gt, 'UNITE clock continuity');
    assert.equal(h.lastTo('viewer', 'b.speed').speed, 2);
    assert.equal(h.lastTo('p_0', 'b.speed').battleId, f.battleId, 'leaker display also retimed');
    vote(h, 'p_1'); assert.equal(h.m.gameSpeed, 4);
    assert.ok(h.drive(() => h.m.phase === PHASE.SETTLE));
    assert.equal(h.m.gameSpeed, 2); assert.equal(h.m.combatSpeedState().enabled, true);
    assert.equal(h.m.combatSpeedState().active, false);
    assert.deepEqual(h.logs.error, []);
  } finally { h.m.dispose(); }
});
