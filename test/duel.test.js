'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Duel } = require('../server/duel');

const press = (o = {}) => ({ left: false, right: false, jump: false, block: false, run: false, punch: false, kick: false, ...o });

function setup(opts = {}) {
  const events = [];
  const duel = new Duel({ RECONNECT_GRACE_MS: 1000, ...opts }, (e, p, side) => events.push({ e, p, side }));
  const names = () => events.map((x) => x.e);
  return { duel, events, names };
}

function startFighting(duel) {
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('p1');
  duel.ready('p2');
  duel.tick(duel.cfg.COUNTDOWN_MS);
  assert.equal(duel.phase, 'FIGHTING');
}

// Avanza en pasos de ~16 ms (como el servidor real).
function advance(duel, ms) {
  for (let t = 0; t < ms; t += 16) duel.tick(16);
}

function koRound(duel, winner) {
  const loser = winner === 'p1' ? 'p2' : 'p1';
  const g = duel.game.players;
  g[winner].x = 380;
  g[loser].x = 420;
  g[loser].hp = 1;
  duel.input(winner, press({ punch: true }));
  advance(duel, 300);
  duel.input(winner, press());
}

test('1º y 2º jugador reciben lados distintos; el 3º es rechazado', () => {
  const { duel } = setup();
  const a = duel.join('player-aaaa', 's1');
  const b = duel.join('player-bbbb', 's2');
  assert.deepEqual([a.side, b.side], ['p1', 'p2']);
  assert.equal(duel.canJoin('player-cccc'), false);
  const c = duel.join('player-cccc', 's3');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'duel_full');
});

test('fases: WAITING → READY → COUNTDOWN → FIGHTING', () => {
  const { duel } = setup();
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-aaaa', 's1');
  assert.equal(duel.phase, 'WAITING');
  duel.join('player-bbbb', 's2');
  assert.equal(duel.phase, 'READY');
  duel.ready('p1');
  assert.equal(duel.phase, 'READY');
  duel.ready('p2');
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(duel.cfg.COUNTDOWN_MS - 1);
  assert.equal(duel.phase, 'COUNTDOWN');
  duel.tick(2);
  assert.equal(duel.phase, 'FIGHTING');
});

test('mientras se espera rival se puede practicar y nadie pierde vida', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  const g = duel.game.players;
  g.p1.x = 380;
  g.p2.x = 420; // el slot vacío queda como Costalito
  duel.input('p1', press({ punch: true }));
  advance(duel, 400);
  assert.equal(g.p2.hp, 100);
  assert.equal(duel.game.practice, true);
});

test('en la cuenta regresiva nadie se mueve', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('p1');
  duel.ready('p2');
  const x0 = duel.game.players.p1.x;
  duel.input('p1', press({ right: true }));
  advance(duel, 1000);
  assert.equal(duel.game.players.p1.x, x0);
});

test('K.O. → ROUND_END → siguiente ronda con vida llena', () => {
  const { duel, names } = setup();
  startFighting(duel);
  koRound(duel, 'p1');
  assert.equal(duel.phase, 'ROUND_END');
  assert.equal(duel.rounds.p1, 1);
  assert.equal(duel.roundReason, 'ko');
  assert.ok(names().includes('round_over'));
  advance(duel, duel.cfg.ROUND_END_MS + 50);
  assert.equal(duel.phase, 'COUNTDOWN');
  assert.equal(duel.round, 2);
  assert.equal(duel.game.players.p2.hp, 100);
  assert.equal(duel.game.players.p2.ko, false);
});

test('gana el duelo quien llega a 2 rondas', () => {
  const { duel, events } = setup();
  startFighting(duel);
  koRound(duel, 'p2');
  advance(duel, duel.cfg.ROUND_END_MS + duel.cfg.COUNTDOWN_MS + 100);
  assert.equal(duel.phase, 'FIGHTING');
  koRound(duel, 'p2');
  advance(duel, duel.cfg.ROUND_END_MS + 50);
  assert.equal(duel.phase, 'GAME_OVER');
  assert.equal(duel.winner, 'p2');
  const go = events.find((x) => x.e === 'game_over');
  assert.deepEqual(go.p, { winner: 'p2', rounds: { p1: 0, p2: 2 }, reason: 'rounds' });
});

test('se acaba el tiempo: gana la ronda quien tenga más vida; con empate nadie', () => {
  const { duel } = setup({ ROUND_TIME_MS: 1000 });
  startFighting(duel);
  duel.game.players.p1.hp = 40;
  advance(duel, 1100);
  assert.equal(duel.phase, 'ROUND_END');
  assert.equal(duel.roundReason, 'time');
  assert.equal(duel.roundWinner, 'p2');

  advance(duel, duel.cfg.ROUND_END_MS + duel.cfg.COUNTDOWN_MS + 100);
  assert.equal(duel.phase, 'FIGHTING');
  advance(duel, 1100);
  assert.equal(duel.roundWinner, null);
  assert.deepEqual(duel.rounds, { p1: 0, p2: 1 });
});

test('revancha: ambos deben aceptar y se reinician las rondas', () => {
  const { duel } = setup({ ROUNDS_TO_WIN: 1 });
  startFighting(duel);
  koRound(duel, 'p1');
  advance(duel, duel.cfg.ROUND_END_MS + 50);
  assert.equal(duel.phase, 'GAME_OVER');
  duel.rematch('p1');
  assert.equal(duel.phase, 'GAME_OVER');
  duel.rematch('p2');
  assert.equal(duel.phase, 'COUNTDOWN');
  assert.deepEqual(duel.rounds, { p1: 0, p2: 0 });
  assert.equal(duel.round, 1);
});

test('desconexión: se pausa, el slot se reserva y nadie más entra; al volver recupera su lado', () => {
  const { duel, events } = setup();
  startFighting(duel);
  duel.leave('s1');
  assert.equal(duel.canJoin('player-cccc'), false, 'slot reservado');
  const x0 = duel.game.players.p2.x;
  duel.input('p2', press({ left: true }));
  advance(duel, 500);
  assert.equal(duel.game.players.p2.x, x0, 'pelea en pausa');
  assert.ok(events.some((x) => x.e === 'opponent_left' && x.side === 'p2'));
  const back = duel.join('player-aaaa', 's9');
  assert.equal(back.side, 'p1');
  assert.equal(back.reconnected, true);
  assert.equal(duel.phase, 'FIGHTING');
});

test('si no vuelve a tiempo, el rival gana por abandono y el slot se libera', () => {
  const { duel, events } = setup();
  startFighting(duel);
  duel.leave('s2');
  advance(duel, 1100);
  const go = events.find((x) => x.e === 'game_over');
  assert.equal(go.p.winner, 'p1');
  assert.equal(go.p.reason, 'abandon');
  assert.equal(duel.phase, 'WAITING');
  assert.equal(duel.canJoin('player-dddd'), true);
  assert.equal(duel.join('player-dddd', 's4').side, 'p2');
});

test('input inválido o de un slot vacío se ignora', () => {
  const { duel } = setup();
  duel.join('player-aaaa', 's1');
  assert.equal(duel.input('p1', 'basura'), false);
  assert.equal(duel.input('p1', null), false);
  assert.equal(duel.input('p2', press({ left: true })), false);
  assert.equal(duel.input('xx', press({ left: true })), false);
  assert.equal(duel.input('p1', { left: 1 }), true);
  assert.equal(duel.game.players.p1.input.left, false, '1 no es true');
});

test('expulsión por inactividad en READY', () => {
  const { duel, events } = setup({ IDLE_KICK_MS: 500 });
  duel.join('player-aaaa', 's1');
  duel.join('player-bbbb', 's2');
  duel.ready('p1');
  advance(duel, 600);
  const kick = events.find((x) => x.e === 'kick');
  assert.equal(kick.p.socketId, 's2');
  assert.equal(duel.slots.p2, null);
  assert.equal(duel.phase, 'WAITING');
});
