import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { Lobby, Room } from '../server/lobby.js';
import { HEAVY_TYPES } from '../server/net.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { C2S, S2C } from '../shared/protocol.js';

async function setup(t) {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, MatchClass: StubMatch });
  const clients = [];
  t.after(async () => { await Promise.all(clients.map(c => c.terminate())); await server.close(); });
  const connect = async name => {
    const c = await TestClient.connect(`ws://127.0.0.1:${server.port}/ws`); clients.push(c);
    if (name) c.welcome = await c.hello(name);
    return c;
  };
  return { server, connect };
}
async function ok(c, msg) { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; }
async function create(c, mode = 'coop', difficulty = 'NORMAL') {
  await ok(c, { t: 'room.create', mode, difficulty });
  return c.waitFor('room.state', r => r.hostId === c.welcome.playerId && r.mode === mode);
}
async function list(c, page = 0) {
  await ok(c, { t: 'room.list', page });
  return c.waitFor('room.list', r => r.page === page);
}

test('directory protocol bounds page size and participates in existing heavy-request protection', () => {
  assert.ok(S2C.includes('room.list')); assert.ok(HEAVY_TYPES.has('room.list'));
  assert.ok(C2S['room.list'].$optional.includes('page'));
  for (const page of [0, 1, 10000]) assert.ok(C2S['room.list'].page(page));
  for (const page of [-1, 1.2, 10001, '0', Infinity, NaN]) assert.equal(C2S['room.list'].page(page), false);
});

test('listing requires hello, supports empty servers, and does not join a room', async t => {
  const { server, connect } = await setup(t);
  const anonymous = await connect();
  assert.equal((await anonymous.request({ t: 'room.list' })).code, ERR.BAD_MSG);
  const reader = await connect('浏览者');
  assert.deepEqual(await list(reader), { t: 'room.list', page: 0, pages: 1, total: 0, rooms: [] });
  assert.equal(server.lobby.rooms.size, 0);
  assert.equal(server.lobby.registry.byId(reader.welcome.playerId).roomCode, null);
});

test('room summaries expose host/mode/difficulty/occupied seats/status, never private fields', async t => {
  const { connect } = await setup(t);
  const host = await connect('房主甲'), solo = await connect('单人乙'), reader = await connect('浏览者');
  const coop = await create(host, 'coop', 'HARD'); await ok(host, { t: 'room.addBot' });
  const single = await create(solo, 'solo', 'FUNNY');
  const snapshot = await list(reader);
  assert.equal(snapshot.total, 2);
  const row = snapshot.rooms.find(r => r.code === coop.code);
  assert.deepEqual(row, { code: coop.code, hostName: '房主甲', mode: 'coop', difficulty: 'HARD', players: 2,
    capacity: 4, inMatch: false, spectators: 0, spectatorCapacity: 2, canJoin: true, canSpectate: true });
  const singleRow = snapshot.rooms.find(r => r.code === single.code);
  assert.equal(singleRow.players, 1); assert.equal(singleRow.capacity, 1);
  assert.equal(singleRow.canJoin, false); assert.equal(singleRow.canSpectate, false);
  assert.ok(!JSON.stringify(snapshot).includes(host.welcome.token));
  for (const entry of snapshot.rooms) {
    assert.ok(!Object.hasOwn(entry, 'playerId')); assert.ok(!Object.hasOwn(entry, 'seats'));
    assert.ok(!Object.hasOwn(entry, 'ownerKey')); assert.ok(!Object.hasOwn(entry, 'loadout'));
  }
});

test('pre-game join works, running rooms reject player joins but accept spectators without a player seat', async t => {
  const { server, connect } = await setup(t);
  const host = await connect('房主'), guest = await connect('参战者'), reader = await connect('观战者');
  const room = await create(host);
  await ok(guest, { t: 'room.join', code: room.code });
  assert.equal((await list(reader)).rooms[0].players, 2);
  await ok(guest, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.start' });
  let row = (await list(reader)).rooms[0];
  assert.equal(row.inMatch, true); assert.equal(row.canJoin, false); assert.equal(row.canSpectate, true);
  const late = await connect('迟到参战者');
  assert.equal((await late.request({ t: 'room.join', code: room.code })).code, ERR.ROOM_STARTED);
  await ok(reader, { t: 'room.spectate', code: room.code });
  const state = await reader.waitFor('room.state', r => r.inMatch && r.spectators.length === 1);
  assert.equal(state.seats.filter(Boolean).length, 2);
  assert.equal(state.seats.some(s => s?.playerId === reader.welcome.playerId), false);
  assert.equal((await reader.request({ t: 'g.refresh' })).code, ERR.SPECTATOR);
  row = (await list(late)).rooms[0]; assert.equal(row.spectators, 1); assert.equal(row.players, 2);
  await ok(late, { t: 'room.spectate', code: room.code });
  const observer = await connect('额外浏览者');
  row = (await list(observer)).rooms[0]; assert.equal(row.canSpectate, false);
  assert.equal((await observer.request({ t: 'room.spectate', code: room.code })).code, ERR.ROOM_FULL);
  assert.equal(server.lobby.rooms.get(room.code).spectators.length, 2);
});

test('full rooms, difficulty changes, host migration and disposal appear in fresh snapshots', async t => {
  const { connect } = await setup(t);
  const host = await connect('原房主'), next = await connect('新房主'), reader = await connect('浏览者');
  const room = await create(host);
  await ok(next, { t: 'room.join', code: room.code });
  await ok(host, { t: 'room.addBot' }); await ok(host, { t: 'room.addBot' });
  let row = (await list(reader)).rooms[0]; assert.equal(row.players, 4); assert.equal(row.canJoin, false);
  assert.equal((await reader.request({ t: 'room.join', code: room.code })).code, ERR.ROOM_FULL);
  await ok(host, { t: 'room.setDifficulty', difficulty: 'ABYSS' });
  assert.equal((await list(reader)).rooms[0].difficulty, 'ABYSS');
  await ok(host, { t: 'room.leave' });
  row = (await list(reader)).rooms[0]; assert.equal(row.hostName, '新房主'); assert.equal(row.canJoin, true);
  await ok(next, { t: 'room.leave' });
  assert.equal((await list(reader)).total, 0);
  assert.equal((await reader.request({ t: 'room.join', code: room.code })).code, ERR.ROOM_NOT_FOUND);
});

test('directory pages are bounded, stable, and do not mutate room state', () => {
  const lobby = new Lobby({ registry: {} });
  for (let i = 0; i < 45; i++) {
    const room = new Room(String(i).padStart(4, 'A'), 'coop', 'NORMAL', i);
    room.hostId = `secret${i}`; room.seats[0] = { playerId: room.hostId, name: `Host ${i}`, left: false };
    lobby.rooms.set(room.code, room);
  }
  const frames = [], session = { connected: true, ws: { readyState: 1, bufferedAmount: 0, send: raw => frames.push(JSON.parse(raw)) } };
  for (const page of [0, 1, 2, 3]) lobby.listRooms(session, { page });
  assert.deepEqual(frames.map(f => f.rooms.length), [20, 20, 5, 0]);
  assert.ok(frames.every(f => f.total === 45 && f.pages === 3));
  assert.equal(frames[0].rooms[0].hostName, 'Host 44');
  assert.equal(new Set(frames.flatMap(f => f.rooms.map(r => r.code))).size, 45);
  assert.equal(lobby.rooms.size, 45);
});

test('gameplay-plugin directory rows show the selected mode without exposing content or settings', () => {
  const lobby = new Lobby({ registry: {} });
  const room = new Room('MOD1', 'coop', 'HARD', 0);
  room.hostId = 'private-id';
  room.seats[0] = { playerId: room.hostId, name: 'Plugin Host', left: false };
  room.content = { vanilla: false, cs: 'a'.repeat(64), modeId: 'mode_x_test',
    modes: [{ id: 'mode_x_test', name: 'Custom <mode> ' + 'x'.repeat(100) }],
    plugins: [{ id: 'test', settings: { secret: 'not-in-directory' } }] };
  lobby.rooms.set(room.code, room);
  let frame;
  const session = { connected: true, ws: { readyState: 1, bufferedAmount: 0, send: raw => { frame = JSON.parse(raw); } } };
  lobby.listRooms(session);
  const row = frame.rooms[0];
  assert.equal(row.modded, true);
  assert.equal(row.modeName, room.content.modes[0].name.slice(0, 80));
  assert.equal(row.canJoin, true);
  assert.equal(row.canSpectate, true);
  for (const privateValue of [room.hostId, room.content.cs, 'not-in-directory']) {
    assert.equal(JSON.stringify(frame).includes(privateValue), false);
  }
  for (const key of ['cs', 'plugins', 'settings', 'content', 'modeId']) assert.equal(Object.hasOwn(row, key), false);
});
