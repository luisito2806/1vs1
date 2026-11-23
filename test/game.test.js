'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getConfig } = require('../server/config');
const G = require('../server/game');

const DT = 1 / 60;
const press = (o = {}) => ({ left: false, right: false, jump: false, block: false, run: false, punch: false, kick: false, ...o });

function setup() {
  const cfg = getConfig();
  const game = G.createGame(cfg);
  return { cfg, game, p1: game.players.p1, p2: game.players.p2 };
}
function run(game, seconds) {
  const events = [];
  for (let t = 0; t < seconds; t += DT) events.push(...G.step(game, DT));
  return events;
}
// Pone a los dos peleadores frente a frente a cierta distancia, en el suelo.
function faceOff(game, dist) {
  const { p1, p2 } = game.players;
  p1.x = 400 - dist / 2;
  p2.x = 400 + dist / 2;
}

test('gravedad: tras brincar vuelve a caer al suelo', () => {
  const { game, cfg, p1 } = setup();
  p1.x = 40; // lejos de las plataformas
  G.setInput(game, 'p1', press({ jump: true }));
  G.step(game, DT);
  assert.equal(p1.grounded, false);
  assert.ok(p1.y < cfg.GROUND_Y);
  run(game, 1.5);
  assert.equal(p1.grounded, true);
  assert.equal(p1.y, cfg.GROUND_Y);
});

test('soltar el salto antes produce un salto más bajo', () => {
  const high = setup();
  G.setInput(high.game, 'p1', press({ jump: true }));
  let minHigh = Infinity;
  for (let i = 0; i < 60; i++) { G.step(high.game, DT); minHigh = Math.min(minHigh, high.p1.y); }

  const low = setup();
  G.setInput(low.game, 'p1', press({ jump: true }));
  G.step(low.game, DT);
  G.setInput(low.game, 'p1', press());
  let minLow = Infinity;
  for (let i = 0; i < 60; i++) { G.step(low.game, DT); minLow = Math.min(minLow, low.p1.y); }
  assert.ok(minLow > minHigh + 40, `${minLow} vs ${minHigh}`);
});

test('plataformas: se atraviesan desde abajo y se aterriza encima', () => {
  const { game, cfg, p1 } = setup();
  const pl = cfg.PLATFORMS[0];
  p1.x = pl.x + pl.w / 2;
  G.setInput(game, 'p1', press({ jump: true }));
  run(game, 1.5);
  assert.equal(p1.grounded, true);
  assert.equal(p1.y, pl.y, 'quedó parado sobre la plataforma');

  // Caminar fuera del borde: cae al suelo
  G.setInput(game, 'p1', press({ left: true }));
  run(game, 1.5);
  assert.equal(p1.y, cfg.GROUND_Y);
});

test('paredes: no se sale del escenario', () => {
  const { game, cfg, p1 } = setup();
  G.setInput(game, 'p1', press({ left: true, run: true }));
  run(game, 3);
  assert.equal(p1.x, cfg.HIT_W / 2);
});

test('los cuerpos no se atraviesan', () => {
  const { game, cfg, p1, p2 } = setup();
  G.setInput(game, 'p1', press({ right: true, run: true }));
  G.setInput(game, 'p2', press({ left: true, run: true }));
  run(game, 2);
  assert.ok(p2.x - p1.x >= cfg.HIT_W - 0.01, `distancia ${p2.x - p1.x}`);
  assert.ok(p1.x < p2.x, 'no se cruzaron');
});

test('siempre miran hacia el rival', () => {
  const { game, p1, p2 } = setup();
  p1.x = 600;
  p2.x = 200;
  G.step(game, DT);
  assert.equal(p1.facing, -1);
  assert.equal(p2.facing, 1);
});

test('puñetazo a corta distancia pega una sola vez; de lejos no pega', () => {
  const near = setup();
  faceOff(near.game, 50);
  G.setInput(near.game, 'p1', press({ punch: true }));
  const ev = run(near.game, 0.6).filter((e) => e.type === 'hit');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].attacker, 'p1');
  assert.equal(near.p2.hp, near.cfg.MAX_HP - G.ATTACKS.punch.damage);

  const far = setup();
  faceOff(far.game, 200);
  G.setInput(far.game, 'p1', press({ punch: true }));
  assert.equal(run(far.game, 0.6).filter((e) => e.type === 'hit').length, 0);
  assert.equal(far.p2.hp, far.cfg.MAX_HP);
});

test('la patada empuja y aturde al rival', () => {
  const { game, p1, p2 } = setup();
  faceOff(game, 60);
  const x0 = p2.x;
  G.setInput(game, 'p1', press({ kick: true }));
  const ev = run(game, 0.25).filter((e) => e.type === 'hit');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].attack, 'kick');
  assert.equal(p2.state, 'hurt');
  run(game, 0.3);
  assert.ok(p2.x > x0 + 20, 'salió empujado');
  assert.ok(p1.hp === 100);
});

test('bloquear mirando al atacante reduce el daño y no aturde', () => {
  const { game, cfg, p2 } = setup();
  faceOff(game, 50);
  G.setInput(game, 'p2', press({ block: true }));
  G.step(game, DT);
  G.setInput(game, 'p1', press({ kick: true }));
  const ev = run(game, 0.6).filter((e) => e.type === 'hit');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].blocked, true);
  assert.equal(p2.hp, cfg.MAX_HP - Math.round(G.ATTACKS.kick.damage * cfg.BLOCK_DAMAGE));
  assert.notEqual(p2.state, 'hurt');
});

test('en modo práctica los golpes no quitan vida', () => {
  const { game, cfg, p2 } = setup();
  game.practice = true;
  faceOff(game, 50);
  G.setInput(game, 'p1', press({ punch: true }));
  assert.equal(run(game, 0.6).filter((e) => e.type === 'hit').length, 1);
  assert.equal(p2.hp, cfg.MAX_HP);
});

test('con vida en 0 hay K.O.', () => {
  const { game, p2 } = setup();
  faceOff(game, 50);
  p2.hp = 5;
  G.setInput(game, 'p1', press({ punch: true }));
  const ev = run(game, 0.6);
  const ko = ev.find((e) => e.type === 'ko');
  assert.ok(ko);
  assert.deepEqual([ko.winner, ko.loser], ['p1', 'p2']);
  assert.equal(p2.ko, true);
  assert.equal(p2.state, 'ko');
});

test('juego congelado: no se mueve ni pega', () => {
  const { game, p1, p2 } = setup();
  game.frozen = true;
  faceOff(game, 50);
  const x0 = p1.x;
  G.setInput(game, 'p1', press({ right: true, punch: true }));
  const ev = run(game, 0.6);
  assert.equal(ev.length, 0);
  assert.equal(p1.x, x0);
  assert.equal(p2.hp, 100);
});

test('sanitizeInput solo acepta booleanos true', () => {
  assert.equal(G.sanitizeInput(null), null);
  assert.equal(G.sanitizeInput('basura'), null);
  assert.equal(G.sanitizeInput([1]), null);
  const i = G.sanitizeInput({ left: 1, right: 'true', punch: true, hack: true });
  assert.deepEqual(i, { left: false, right: false, jump: false, block: false, run: false, punch: true, kick: false });
});
