'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connectClient } = require('socket.io-client');
const { createServer } = require('../server/index');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withServer(fn, opts = {}) {
  const server = createServer({ RECONNECT_GRACE_MS: 300, ...opts });
  const port = await server.start(0);
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  const connect = (playerId) =>
    new Promise((resolve) => {
      const socket = connectClient(url, { auth: { playerId }, forceNew: true, reconnection: false, transports: ['websocket'] });
      const c = { socket, states: 0, lastState: null, joined: null, config: null, connected: false, error: null };
      socket.on('state', (s) => { c.states++; c.lastState = s; });
      socket.on('config', (cfg) => (c.config = cfg));
      socket.on('joined', (j) => (c.joined = j));
      socket.on('connect', () => (c.connected = true));
      socket.on('connect_error', (e) => { c.error = e.message; resolve(c); });
      socket.on('phase', () => { if (c.joined) resolve(c); });
      clients.push(c);
    });
  try {
    await fn({ server, connect, url });
  } finally {
    for (const c of clients) c.socket.close();
    await server.close();
  }
}

test('sirve la página del juego', () =>
  withServer(async ({ url }) => {
    const res = await fetch(url + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Duelo Ronin/);
  }));

test('1º y 2º cliente reciben lados distintos y la config del juego', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    assert.equal(a.joined.side, 'p1');
    assert.equal(b.joined.side, 'p2');
    assert.equal(a.config.MAX_HP, 100);
    assert.ok(a.config.ATTACKS.punch);
  }));

test('el 3º cliente recibe duel_full, no conecta y nunca recibe state', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
    assert.equal(c.connected, false);
    assert.equal(c.joined, null);
    await sleep(250);
    assert.ok(a.states > 0 && b.states > 0, 'los jugadores sí reciben state');
    assert.equal(c.states, 0, 'el rechazado nunca recibe state');
  }));

test('un 3º tampoco entra mientras un jugador está en gracia de reconexión', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const c = await connect('player-cccc');
    assert.equal(c.error, 'duel_full');
  }));

test('reconexión con el mismo playerId recupera el lado; tras la gracia se libera', () =>
  withServer(async ({ connect }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    a.socket.close();
    await sleep(80);
    const a2 = await connect('player-aaaa');
    assert.equal(a2.joined.side, 'p1');

    b.socket.close();
    await sleep(500);
    const n = await connect('player-dddd');
    assert.equal(n.joined.side, 'p2');
  }));

test('el input mueve al peleador en el servidor; basura se ignora', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    const x0 = server.duel.game.players.p1.x;
    a.socket.emit('input', 'basura');
    a.socket.emit('input', { right: 'si' });
    await sleep(150);
    assert.equal(server.duel.game.players.p1.x, x0);
    a.socket.emit('input', { right: true });
    await sleep(200);
    assert.ok(server.duel.game.players.p1.x > x0 + 10);
  }));

test('flujo completo: ambos listos → cuenta regresiva → FIGHTING', () =>
  withServer(async ({ connect, server }) => {
    const a = await connect('player-aaaa');
    const b = await connect('player-bbbb');
    a.socket.emit('ready');
    b.socket.emit('ready');
    await sleep(100);
    assert.equal(server.duel.phase, 'COUNTDOWN');
    await sleep(server.cfg.COUNTDOWN_MS + 200);
    assert.equal(server.duel.phase, 'FIGHTING');
    assert.equal(a.lastState.practice, false);
  }));
