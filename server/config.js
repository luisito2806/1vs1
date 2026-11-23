'use strict';

// Constantes del juego. Movimiento en px/segundo (todo usa dt).
// Se leen del entorno en cada llamada para poder sobreescribirlas en pruebas.
function getConfig() {
  const num = (name, def) => {
    const raw = process.env[name];
    const v = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(v) ? v : def;
  };
  return {
    PORT: num('PORT', 3000),

    // Escenario (mismo canvas lógico 800x450 que los proyectos base)
    WIDTH: 800,
    HEIGHT: 450,
    GROUND_Y: 392, // y del suelo (donde pisan los pies)
    // Plataformas de un solo sentido: se atraviesan desde abajo y se aterriza encima.
    PLATFORMS: [
      { x: 90, y: 300, w: 170 },
      { x: 540, y: 300, w: 170 },
      { x: 320, y: 215, w: 160 },
    ],

    // Cuerpo del personaje (hitbox más chica que el dibujo, como en sprite-colisiones)
    HIT_W: 34,
    HIT_H: 96,
    FOOT_W: 18, // ancho de apoyo sobre plataformas

    // Movimiento
    WALK_SPEED: 210,
    RUN_SPEED: 360,
    ACCEL_GROUND: 2600,
    ACCEL_AIR: 1400,
    FRICTION: 1800,
    GRAVITY: 2100,
    JUMP_VELOCITY: -780, // altura máx. ≈ 145 px
    JUMP_CUT: -320, // soltar el salto antes = salto corto

    // Combate
    MAX_HP: 100,
    BLOCK_DAMAGE: 0.2, // bloqueando se recibe el 20 % del daño
    ROUNDS_TO_WIN: num('ROUNDS_TO_WIN', 2), // al mejor de 3
    ROUND_TIME_MS: num('ROUND_TIME_MS', 60000),

    TICK_RATE: 60,
    STATE_RATE: 60,

    COUNTDOWN_MS: 3000,
    ROUND_END_MS: 2500,
    RECONNECT_GRACE_MS: num('RECONNECT_GRACE_MS', 10000),
    IDLE_KICK_MS: 60000, // sin pulsar "Listo" en READY
    INPUT_MAX_PER_SEC: 120,

    ALLOW_SAME_BROWSER: process.env.ALLOW_SAME_BROWSER === '1',
  };
}

module.exports = { getConfig };
