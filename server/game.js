'use strict';

// Lógica pura de la pelea: sin sockets ni timers. Unidades: px y segundos.
// Física y colisiones AABB basadas en sprite-colisiones (gravedad, salto, aterrizar
// sobre obstáculos), ahora con dos peleadores, golpes, bloqueo y vida.

const SIDES = ['p1', 'p2'];

// Cada golpe tiene arranque (no pega), frames activos (pega) y recuperación.
// reach: [desde, hasta] px delante del centro; box: [arriba, abajo] relativo a los pies.
const ATTACKS = {
  punch: { startup: 0.07, active: 0.1, recovery: 0.16, damage: 7, reach: [10, 58], box: [-82, -56], knockback: 230, lift: 0, stun: 0.28 },
  kick: { startup: 0.16, active: 0.12, recovery: 0.27, damage: 13, reach: [6, 66], box: [-58, -26], knockback: 440, lift: -280, stun: 0.5 },
};
for (const a of Object.values(ATTACKS)) a.total = a.startup + a.active + a.recovery;

const BUFFER_S = 0.15; // una acción pulsada un poco antes de poder hacerla no se pierde
const BUTTONS = ['left', 'right', 'jump', 'block', 'run', 'punch', 'kick'];
const ACTIONS = ['jump', 'punch', 'kick'];

const emptyInput = () => Object.fromEntries(BUTTONS.map((b) => [b, false]));
const NO_INPUT = Object.freeze(emptyInput());

// Normaliza lo que manda el cliente: solo booleanos `true` cuentan como pulsados.
function sanitizeInput(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const out = {};
  for (const b of BUTTONS) out[b] = msg[b] === true;
  return out;
}

function spawnX(side, cfg) {
  return side === 'p1' ? cfg.WIDTH * 0.36 : cfg.WIDTH * 0.64; // entre las plataformas
}

function createPlayer(side, cfg) {
  const p = { side };
  resetPlayer(p, cfg);
  return p;
}

function resetPlayer(p, cfg) {
  p.x = spawnX(p.side, cfg);
  p.y = cfg.GROUND_Y;
  p.vx = 0;
  p.vy = 0;
  p.facing = p.side === 'p1' ? 1 : -1;
  p.grounded = true;
  p.hp = cfg.MAX_HP;
  p.attack = null; // { type, t, hit }
  p.stun = 0;
  p.blockstun = 0;
  p.blocking = false;
  p.moving = false;
  p.ko = false;
  p.win = false;
  p.state = 'idle';
  p.input = emptyInput();
  p.buffer = { jump: 0, punch: 0, kick: 0 };
}

function createGame(cfg) {
  return {
    cfg,
    players: { p1: createPlayer('p1', cfg), p2: createPlayer('p2', cfg) },
    frozen: false, // true = nadie puede actuar (cuenta regresiva, fin de ronda)
    practice: false, // true = los golpes no quitan vida (mientras se espera rival)
  };
}

function resetRound(game) {
  for (const s of SIDES) resetPlayer(game.players[s], game.cfg);
}

function setInput(game, side, input) {
  const p = game.players[side];
  for (const a of ACTIONS) if (input[a] && !p.input[a]) p.buffer[a] = BUFFER_S;
  p.input = input;
}

function clearInput(game, side) {
  const p = game.players[side];
  p.input = emptyInput();
  p.buffer = { jump: 0, punch: 0, kick: 0 };
}

// ---------- Cajas de colisión ----------

function hurtBox(p, cfg) {
  return { l: p.x - cfg.HIT_W / 2, r: p.x + cfg.HIT_W / 2, t: p.y - cfg.HIT_H, b: p.y };
}

function attackBox(p, type) {
  const a = ATTACKS[type];
  const [n, f] = a.reach;
  return {
    l: p.facing === 1 ? p.x + n : p.x - f,
    r: p.facing === 1 ? p.x + f : p.x - n,
    t: p.y + a.box[0],
    b: p.y + a.box[1],
  };
}

const overlaps = (A, B) => A.l < B.r && A.r > B.l && A.t < B.b && A.b > B.t;

// ---------- Simulación ----------

function face(p, o) {
  if (Math.abs(o.x - p.x) > 2) p.facing = o.x > p.x ? 1 : -1;
}

function approach(v, target, delta) {
  if (v < target) return Math.min(target, v + delta);
  if (v > target) return Math.max(target, v - delta);
  return v;
}

function updatePlayer(game, p, o, dt) {
  const { cfg } = game;
  const inp = game.frozen || p.ko ? NO_INPUT : p.input;

  for (const k of ACTIONS) p.buffer[k] = game.frozen || p.ko ? 0 : Math.max(0, p.buffer[k] - dt);
  if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
  if (p.blockstun > 0) p.blockstun = Math.max(0, p.blockstun - dt);

  if (p.attack) {
    p.attack.t += dt;
    if (p.attack.t >= ATTACKS[p.attack.type].total) p.attack = null;
  }

  const canAct = !game.frozen && !p.ko && p.stun <= 0 && p.blockstun <= 0 && !p.attack;

  // --- Golpes (la patada tiene prioridad si se pulsan juntos) ---
  if (canAct) {
    const type = p.buffer.kick > 0 ? 'kick' : p.buffer.punch > 0 ? 'punch' : null;
    if (type) {
      face(p, o);
      p.attack = { type, t: 0, hit: false };
      p.buffer.punch = 0;
      p.buffer.kick = 0;
    }
  }

  // --- Bloqueo: en el suelo, quieto ---
  const wantsBlock = canAct && !p.attack && inp.block && p.grounded;
  p.blocking = wantsBlock || (p.blockstun > 0 && !p.ko);

  // --- Movimiento horizontal ---
  const free = canAct && !p.attack && !wantsBlock;
  let target = 0;
  let accel;
  if (free) {
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    target = dir * (inp.run ? cfg.RUN_SPEED : cfg.WALK_SPEED);
    accel = p.grounded ? cfg.ACCEL_GROUND : cfg.ACCEL_AIR;
    p.moving = dir !== 0;
    face(p, o); // como en los juegos de pelea: siempre mira al rival
  } else {
    accel = p.grounded ? cfg.FRICTION : 0; // en el aire se conserva el impulso
    p.moving = false;
  }
  p.vx = approach(p.vx, target, accel * dt);

  // --- Salto ---
  if (free && p.grounded && p.buffer.jump > 0) {
    p.vy = cfg.JUMP_VELOCITY;
    p.grounded = false;
    p.buffer.jump = 0;
  }
  if (!inp.jump && !p.grounded && p.stun <= 0 && !p.ko && p.vy < cfg.JUMP_CUT) p.vy = cfg.JUMP_CUT;

  // --- Eje X con paredes ---
  p.x += p.vx * dt;
  const minX = cfg.HIT_W / 2;
  const maxX = cfg.WIDTH - cfg.HIT_W / 2;
  if (p.x < minX) { p.x = minX; p.vx = 0; }
  if (p.x > maxX) { p.x = maxX; p.vx = 0; }

  // --- Eje Y: gravedad, aterrizar en suelo o plataforma (solo cayendo, desde arriba) ---
  const prevY = p.y;
  p.vy += cfg.GRAVITY * dt;
  p.y += p.vy * dt;
  let floor = cfg.GROUND_Y;
  if (p.vy >= 0) {
    for (const pl of cfg.PLATFORMS) {
      const overX = p.x + cfg.FOOT_W / 2 > pl.x && p.x - cfg.FOOT_W / 2 < pl.x + pl.w;
      if (overX && prevY <= pl.y + 0.5 && p.y >= pl.y) floor = Math.min(floor, pl.y);
    }
  }
  if (p.y >= floor) {
    p.y = floor;
    p.vy = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }
}

// Los cuerpos no se atraviesan: si se enciman, se empujan a partes iguales.
function separate(game, a, b) {
  const { cfg } = game;
  if (a.ko || b.ko) return;
  const vOverlap = a.y - cfg.HIT_H < b.y && b.y - cfg.HIT_H < a.y;
  const dx = b.x - a.x;
  if (!vOverlap || Math.abs(dx) >= cfg.HIT_W) return;
  const dir = dx !== 0 ? Math.sign(dx) : a.facing;
  const push = (cfg.HIT_W - Math.abs(dx)) / 2;
  a.x -= dir * push;
  b.x += dir * push;
  const minX = cfg.HIT_W / 2;
  const maxX = cfg.WIDTH - cfg.HIT_W / 2;
  const clamp = (p) => { p.x = Math.max(minX, Math.min(maxX, p.x)); };
  clamp(a);
  clamp(b);
  // Si uno quedó contra la pared, el otro absorbe todo el empuje.
  if (Math.abs(b.x - a.x) < cfg.HIT_W - 0.01) {
    const aAtWall = a.x <= minX || a.x >= maxX;
    if (aAtWall) b.x = a.x + dir * cfg.HIT_W;
    else a.x = b.x - dir * cfg.HIT_W;
    clamp(a);
    clamp(b);
  }
}

function attackConnects(game, p, o) {
  if (!p.attack || p.attack.hit || o.ko) return false;
  const a = ATTACKS[p.attack.type];
  const t = p.attack.t;
  if (t < a.startup || t >= a.startup + a.active) return false;
  return overlaps(attackBox(p, p.attack.type), hurtBox(o, game.cfg));
}

function applyHit(game, p, o, atk, events) {
  const { cfg } = game;
  const a = ATTACKS[atk.type];
  atk.hit = true;
  const box = attackBox(p, atk.type);
  const blocked = o.blocking && (p.x - o.x) * o.facing >= 0; // solo si mira hacia quien pega
  const damage = blocked ? Math.max(1, Math.round(a.damage * cfg.BLOCK_DAMAGE)) : a.damage;
  if (!game.practice) o.hp = Math.max(0, o.hp - damage);

  const dir = p.facing;
  if (blocked) {
    o.vx = dir * a.knockback * 0.35;
    o.blockstun = 0.18;
  } else {
    o.vx = dir * a.knockback;
    if (a.lift) { o.vy = a.lift; o.grounded = false; }
    o.stun = a.stun;
    o.attack = null; // un golpe interrumpe el ataque del rival
  }

  const hurt = hurtBox(o, cfg);
  events.push({
    type: 'hit',
    attacker: p.side,
    target: o.side,
    attack: atk.type,
    damage,
    blocked,
    hp: o.hp,
    x: Math.round((Math.max(box.l, hurt.l) + Math.min(box.r, hurt.r)) / 2),
    y: Math.round((Math.max(box.t, hurt.t) + Math.min(box.b, hurt.b)) / 2),
  });

  if (o.hp <= 0) {
    o.ko = true;
    o.attack = null;
    o.stun = 0;
    o.blockstun = 0;
    o.blocking = false;
    o.vx = dir * 380;
    o.vy = -460;
    o.grounded = false;
    events.push({ type: 'ko', loser: o.side, winner: p.side });
  }
}

function stateOf(p, cfg) {
  if (p.ko) return 'ko';
  if (p.win && p.grounded) return 'win';
  if (p.stun > 0) return 'hurt';
  if (p.attack) return p.attack.type;
  if (p.blocking) return 'block';
  if (!p.grounded) return 'jump';
  const speed = Math.abs(p.vx);
  if (speed > cfg.WALK_SPEED + 20) return 'run';
  if (p.moving || speed > 20) return 'walk';
  return 'idle';
}

// Avanza la simulación dt segundos. Devuelve eventos: { type: 'hit' | 'ko', ... }.
function step(game, dt) {
  const { p1, p2 } = game.players;
  const events = [];
  updatePlayer(game, p1, p2, dt);
  updatePlayer(game, p2, p1, dt);
  separate(game, p1, p2);

  // Primero se detectan ambos golpes y luego se aplican: si los dos pegan
  // en el mismo tick, cuentan los dos (intercambio), sin ventaja para p1.
  // Con el juego congelado (fin de ronda) ya no se cuentan golpes.
  const hits = [];
  if (!game.frozen) {
    if (attackConnects(game, p1, p2)) hits.push([p1, p2, p1.attack]);
    if (attackConnects(game, p2, p1)) hits.push([p2, p1, p2.attack]);
  }
  for (const [p, o, atk] of hits) applyHit(game, p, o, atk, events);

  p1.state = stateOf(p1, game.cfg);
  p2.state = stateOf(p2, game.cfg);
  return events;
}

module.exports = {
  SIDES,
  ATTACKS,
  BUTTONS,
  sanitizeInput,
  createGame,
  resetRound,
  setInput,
  clearInput,
  hurtBox,
  attackBox,
  step,
};
