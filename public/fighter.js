// "Ronin": personaje propio dibujado por código (sin imágenes).
// Esqueleto simple (torso, cabeza, 2 brazos y 2 piernas con codo/rodilla) animado
// por poses. Se usa cuando no hay sprite sheet del jugador (ver sprite-config.js).
window.Fighter = (() => {
  'use strict';

  const THIGH = 22, SHIN = 21, TORSO = 30, UPPER = 17, FORE = 16, HEAD_R = 12;
  const SKIN = '#f1c27d';
  const SKIN_DARK = '#d29a57';
  const OUTLINE = '#120e18';

  const PALETTES = {
    p1: { gi: '#e5484d', giDark: '#a5262c', hair: '#1d1a24', pants: '#2c2438', pantsDark: '#1b1524', band: '#f5efe2', belt: '#15121b' },
    p2: { gi: '#3e8ef7', giDark: '#1f58b0', hair: '#ece6da', pants: '#262a3c', pantsDark: '#171a27', band: '#ffc53d', belt: '#15121b' },
  };
  const FLASH = { gi: '#ffffff', giDark: '#e6e6e6', hair: '#ffffff', pants: '#f0f0f0', pantsDark: '#dddddd', band: '#ffffff', belt: '#cccccc' };

  // Ángulos absolutos en radianes: 0 = hacia abajo, positivo = hacia adelante (+x).
  const STANCE = [-0.32, -0.12, 0.38, 0.12]; // [musloAtrás, espinillaAtrás, musloFrente, espinillaFrente]
  const lerp = (a, b, t) => a + (b - a) * t;

  // Extensión del golpe: atrás en el arranque, 1 en frames activos, regresa en la recuperación.
  function extension(ap, a) {
    if (!a) return 0;
    const k = ap * a.total;
    if (k < a.startup) {
      const w = k / a.startup;
      return w < 0.6 ? -0.35 * (w / 0.6) : lerp(-0.35, 1, (w - 0.6) / 0.4);
    }
    if (k < a.startup + a.active) return 1;
    return Math.max(0, 1 - (k - a.startup - a.active) / a.recovery);
  }

  function pose(v, t, attacks) {
    const P = { lean: 0.08, head: 0, legs: STANCE.slice(), arms: [0.5, 2.3, 0.8, 2.5], air: !v.g, ko: false };
    switch (v.st) {
      case 'idle': {
        const b = Math.sin(t * 3.2);
        P.arms = [0.5 + 0.05 * b, 2.3, 0.8 + 0.05 * b, 2.5];
        P.legs = [-0.32, -0.12 + 0.03 * b, 0.38, 0.12 + 0.03 * b];
        break;
      }
      case 'walk': {
        const p = t * 9, s = Math.sin(p);
        const tF = 0.05 + 0.42 * s, tB = 0.05 - 0.42 * s;
        P.legs = [tB, tB - 0.55 * Math.max(0, Math.cos(p)), tF, tF - 0.55 * Math.max(0, -Math.cos(p))];
        P.arms = [0.5 + 0.12 * s, 2.3, 0.8 - 0.12 * s, 2.5];
        P.lean = 0.12;
        break;
      }
      case 'run': {
        const p = t * 13, s = Math.sin(p);
        const tF = 0.3 + 0.8 * s, tB = 0.3 - 0.8 * s;
        P.legs = [tB, tB - 1.1 * Math.max(0, Math.cos(p)), tF, tF - 1.1 * Math.max(0, -Math.cos(p))];
        const uF = 0.2 - 0.9 * s, uB = 0.2 + 0.9 * s;
        P.arms = [uB, uB + 1.7, uF, uF + 1.7];
        P.lean = 0.35;
        break;
      }
      case 'jump':
        if (v.vy < -200) { // subiendo: rodillas arriba
          P.legs = [0.3, -0.6, 1.1, 0.2];
          P.arms = [-0.5, 0.2, 2.2, 2.8];
        } else { // cayendo: brazos abiertos
          P.legs = [-0.2, -0.5, 0.6, 0.1];
          P.arms = [-1.2, -1.0, 1.6, 1.9];
        }
        P.lean = 0.1;
        break;
      case 'punch': {
        const e = extension(v.ap, attacks.punch);
        P.arms = [0.4, 2.4, lerp(0.8, 1.62, e), lerp(2.5, 1.58, e)];
        P.legs = [-0.45, -0.2, 0.5, 0.25];
        P.lean = 0.08 + 0.22 * e;
        break;
      }
      case 'kick': {
        const e = extension(v.ap, attacks.kick);
        if (e < 0) P.legs = [-0.1, -0.05, 0.4 + 1.6 * -e, 0.1 - 1.0 * -e]; // rodilla recogida
        else P.legs = [-0.1, -0.05, lerp(0.4, 1.6, e), lerp(0.1, 1.7, e)];
        P.arms = [-0.6, 0.3, 1.0, 2.0];
        P.lean = 0.05 - 0.4 * Math.max(0, e);
        break;
      }
      case 'block':
        P.legs = [-0.45, -0.1, 0.65, 0.05];
        P.arms = [1.0, 2.85, 1.25, 3.0];
        P.lean = -0.05;
        P.head = 0.15;
        break;
      case 'hurt': {
        const w = Math.sin(t * 30) * 0.05;
        P.legs = [-0.25, -0.05, 0.35, 0.45];
        P.arms = [-0.8, -0.3, -0.4 + w, 0.3];
        P.lean = -0.45 + w;
        P.head = -0.35;
        break;
      }
      case 'ko':
        P.legs = [-0.15, -0.1, 0.2, 0.1];
        P.arms = [-2.2, -2.4, 2.4, 2.6];
        P.lean = -0.1;
        P.head = -0.2;
        P.ko = true;
        P.air = false;
        break;
      case 'win': {
        const b = Math.sin(t * 6);
        P.legs = [-0.4, -0.15, 0.4, 0.15];
        P.arms = [0.3, 1.9, 2.9 + 0.1 * b, 3.1];
        P.lean = 0;
        break;
      }
      default:
        break;
    }
    return P;
  }

  const tip = (x, y, a, L) => [x + Math.sin(a) * L, y + Math.cos(a) * L];

  function segment(ctx, x0, y0, x1, y1, w, color) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = w + 4;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }

  function dot(ctx, x, y, r, color) {
    ctx.fillStyle = OUTLINE;
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  function leg(ctx, hx, hy, thigh, shin, color) {
    const [kx, ky] = tip(hx, hy, thigh, THIGH);
    const [fx, fy] = tip(kx, ky, shin, SHIN);
    segment(ctx, hx, hy, kx, ky, 10, color);
    segment(ctx, kx, ky, fx, fy, 9, color);
    // Pie (sandalia) apuntando hacia adelante
    segment(ctx, fx - 1, fy - 1, fx + 6, fy - 1, 5, OUTLINE);
  }

  function arm(ctx, sx, sy, upper, fore, sleeve, skin) {
    const [ex, ey] = tip(sx, sy, upper, UPPER);
    const [hx, hy] = tip(ex, ey, fore, FORE);
    segment(ctx, sx, sy, ex, ey, 9, sleeve);
    segment(ctx, ex, ey, hx, hy, 7, skin);
    dot(ctx, hx, hy, 4.5, skin); // puño
  }

  function head(ctx, x, y, tilt, pal, t, ko) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);

    // Colas de la cinta (ondean hacia atrás)
    const wave = Math.sin(t * 10);
    ctx.lineCap = 'round';
    for (const [dy, amp] of [[-1, 4], [3, 6]]) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-HEAD_R + 2, -3);
      ctx.quadraticCurveTo(-HEAD_R - 10, dy - 2 + wave * 2, -HEAD_R - 20, dy + 4 + wave * amp);
      ctx.stroke();
      ctx.strokeStyle = pal.band;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }

    dot(ctx, 0, 0, HEAD_R, SKIN);

    // Pelo en picos, arriba y atrás
    ctx.fillStyle = pal.hair;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(HEAD_R * 0.9, -4);
    ctx.lineTo(HEAD_R * 0.55, -HEAD_R - 3);
    ctx.lineTo(HEAD_R * 0.1, -HEAD_R + 1);
    ctx.lineTo(-HEAD_R * 0.35, -HEAD_R - 5);
    ctx.lineTo(-HEAD_R * 0.6, -HEAD_R + 1);
    ctx.lineTo(-HEAD_R - 5, -HEAD_R + 2);
    ctx.lineTo(-HEAD_R - 1, -2);
    ctx.lineTo(-HEAD_R - 4, 4);
    ctx.lineTo(-HEAD_R + 2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cinta en la frente
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, HEAD_R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = pal.band;
    ctx.fillRect(-HEAD_R, -6, HEAD_R * 2, 5);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(-HEAD_R, -1.5, HEAD_R * 2, 1);
    ctx.restore();

    // Ojo y ceja (mira hacia adelante)
    if (ko) {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(3, 0); ctx.lineTo(8, 5);
      ctx.moveTo(8, 0); ctx.lineTo(3, 5);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(3.5, 0.5, 5.5, 4);
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(6.5, 0.5, 2.5, 4);
      ctx.fillRect(2.5, -0.8, 7, 1.4);
    }
    // Boca
    ctx.fillStyle = SKIN_DARK;
    ctx.fillRect(6, 7, 4, 1.5);
    ctx.restore();
  }

  /**
   * Dibuja al Ronin con el origen en los pies, mirando a la derecha.
   * v: { st, ap, vy, g }  t: segundos en el estado actual  attacks: tiempos de golpes.
   */
  function draw(ctx, side, v, t, attacks, opts = {}) {
    const pal = opts.flash ? FLASH : PALETTES[side] || PALETTES.p1;
    const P = pose(v, t, attacks || {});
    const [tB, sB, tF, sF] = P.legs;

    // Altura de cadera: en el suelo, la pierna más estirada toca el piso.
    const legH = (th, sh) => Math.cos(th) * THIGH + Math.cos(sh) * SHIN;
    const hipY = P.air ? -(THIGH + SHIN) + 2 : -Math.max(legH(tB, sB), legH(tF, sF));
    const hipX = 0;
    const [nx, ny] = [hipX + Math.sin(P.lean) * TORSO, hipY - Math.cos(P.lean) * TORSO];
    const shX = nx - Math.sin(P.lean) * 3;
    const shY = ny + Math.cos(P.lean) * 3;

    // Atrás → adelante
    arm(ctx, shX - 2, shY, P.arms[0], P.arms[1], pal.giDark, SKIN_DARK);
    leg(ctx, hipX - 2, hipY, tB, sB, pal.pantsDark);

    // Torso (gi) con cuello en V y cinturón
    segment(ctx, hipX, hipY, nx, ny, 18, pal.gi);
    ctx.save();
    ctx.translate(nx, ny);
    ctx.rotate(P.lean);
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.moveTo(-1, -2); ctx.lineTo(7, -2); ctx.lineTo(3, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.rotate(P.lean);
    ctx.fillStyle = pal.belt;
    ctx.fillRect(-10, -6, 20, 6);
    ctx.fillRect(-12, -3, 4, 10); // nudo colgando atrás
    ctx.restore();

    const hd = HEAD_R + 2;
    const headAngle = P.lean + P.head;
    head(ctx, nx + Math.sin(headAngle) * hd, ny - Math.cos(headAngle) * hd, P.head * 0.6, pal, t, P.ko);

    leg(ctx, hipX + 2, hipY, tF, sF, pal.pants);
    arm(ctx, shX + 2, shY, P.arms[2], P.arms[3], pal.gi, SKIN);
  }

  return { draw, PALETTES };
})();
