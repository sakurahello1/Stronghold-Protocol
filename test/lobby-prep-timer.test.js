import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { validateC2S } from '../shared/protocol.js';
import { ERR } from '../shared/constants.js';
import { prepTimerOption, PrepTimerToggle } from '../public/js/screens/room.js';

test('prep timer protocol accepts booleans only; old servers hide the new checkbox', () => {
  for (const on of [true, false]) assert.equal(validateC2S({ t: 'room.setPrepTimer', on }), null);
  for (const on of [undefined, null, 0, 1, 'true', {}, []]) assert.notEqual(validateC2S({ t: 'room.setPrepTimer', on }), null);
  assert.equal(prepTimerOption({ hostId: 'h' }, 'h'), null);
  assert.equal(PrepTimerToggle({ option: null }), null);
  assert.deepEqual(prepTimerOption({ hostId: 'h', prepTimer: false }, 'h'), { on: false, editable: true });
  assert.deepEqual(prepTimerOption({ hostId: 'h', prepTimer: true }, 'g'), { on: true, editable: false });
  assert.equal(prepTimerOption({ hostId: 'h', prepTimer: true, inMatch: true }, 'h').editable, false);
});

test('host changes propagate, reset guest readiness, survive host changes and freeze at start', async t => {
  const started = [];
  class Recording extends StubMatch { constructor(opts) { super(opts); started.push(opts); } }
  const s = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, MatchClass: Recording });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await s.close(); });
  const player = async name => {
    const c = await TestClient.connect(`ws://127.0.0.1:${s.port}/ws`); clients.push(c); c.welcome = await c.hello(name); return c;
  };
  const ok = async (c, msg) => assert.equal((await c.request(msg)).t, 'ok', msg.t);
  const host = await player('Host'), guest = await player('Guest'), solo = await player('Solo');
  assert.equal((await guest.request({ t: 'room.setPrepTimer', on: false })).code, ERR.NOT_IN_ROOM);
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const room = await host.waitFor('room.state'); assert.equal(room.prepTimer, true);
  await ok(guest, { t: 'room.join', code: room.code }); await guest.waitFor('room.state');
  assert.equal((await guest.request({ t: 'room.setPrepTimer', on: false })).code, ERR.NOT_HOST);
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.setPrepTimer', on: false });
  const changed = await guest.waitFor('room.state', r => r.prepTimer === false);
  assert.equal(changed.seats.find(p => p?.playerId === guest.welcome.playerId).ready, false);
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.setPrepTimer', on: false });
  assert.equal(s.lobby.rooms.get(room.code).seatOf(guest.welcome.playerId).ready, true, 'same value does not reset readiness');
  await ok(host, { t: 'room.start' }); assert.equal(started[0].prepTimer, false);
  assert.equal((await host.request({ t: 'room.setPrepTimer', on: true })).code, ERR.ROOM_STARTED);
  await ok(host, { t: 'g.infoReady' }); await ok(guest, { t: 'g.infoReady' });
  await guest.waitFor('room.state', r => !r.inMatch && r.prepTimer === false);
  await ok(host, { t: 'room.leave' });
  const migrated = await guest.waitFor('room.state', r => r.hostId === guest.welcome.playerId);
  assert.equal(migrated.prepTimer, false);
  await ok(guest, { t: 'room.setPrepTimer', on: true });
  await ok(guest, { t: 'room.start' }); assert.equal(started[1].prepTimer, true);
  await ok(solo, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
  assert.equal((await solo.waitFor('room.state')).prepTimer, false);
  await ok(solo, { t: 'room.setPrepTimer', on: true });
  await ok(solo, { t: 'room.start' }); assert.equal(started[2].prepTimer, true);
});
