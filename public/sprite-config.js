// ============================================================================
//  IMAGEN DEL JUGADOR (sprite sheet)
// ----------------------------------------------------------------------------
//  1. Pon tu imagen en  public/img/jugador.png  (fondo transparente).
//  2. Ajusta abajo cuántas columnas y filas tiene y qué fila es cada animación.
//  3. Recarga la página. Si la imagen no existe o no carga, se usa el
//     personaje "Ronin" dibujado por código (fighter.js), así el juego
//     siempre funciona.
//
//  Formato esperado: cuadrícula de celdas del mismo tamaño, el personaje
//  mirando a la DERECHA y con los pies en la parte de abajo de cada celda
//  (igual que el sprite sheet de sprite-colisiones: 5 columnas x 4 filas).
// ============================================================================
window.SPRITE_CONFIG = {
  enabled: true,

  images: {
    default: 'img/jugador.png',
    // Opcional: una imagen distinta para cada jugador.
    // p1: 'img/jugador1.png',
    // p2: 'img/jugador2.png',
  },

  // Si ambos usan la misma imagen, el jugador 2 se pinta con otro tono para distinguirlos.
  p2Filter: 'hue-rotate(170deg) saturate(1.2)',

  cols: 5, // columnas del sprite sheet
  rows: 4, // filas del sprite sheet
  height: 108, // alto en pantalla de una celda (px); la hitbox mide 96
  footPad: 'auto', // espacio vacío bajo los pies: 'auto' lo detecta solo, o pon un número (px de la imagen)
  facesRight: true, // false si tu personaje mira a la izquierda en la imagen

  // Animaciones que trae la imagen: fila (empezando en 0), cuántos cuadros y velocidad.
  anims: {
    idle: { row: 0, frames: 5, fps: 6 },
    walk: { row: 1, frames: 5, fps: 8 },
    run: { row: 2, frames: 5, fps: 13 },
    jump: { row: 3, frames: 5 },
    // Si tu imagen tiene más filas, agrégalas, por ejemplo:
    // punch: { row: 4, frames: 4 },
    // kick:  { row: 5, frames: 4 },
    // block: { row: 6, frames: 1 },
    // hurt:  { row: 7, frames: 2, fps: 10 },
  },

  // Qué usar cuando la imagen no tiene una animación (nombre o { anim, frame } fijo).
  fallback: {
    run: 'walk',
    punch: { anim: 'run', frame: 2 },
    kick: { anim: 'jump', frame: 2 },
    block: { anim: 'idle', frame: 0 },
    hurt: { anim: 'jump', frame: 4 },
    ko: { anim: 'idle', frame: 0 },
    win: 'idle',
  },
};
