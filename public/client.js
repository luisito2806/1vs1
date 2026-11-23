(() => {
  'use strict';

  // Valores por defecto hasta recibir 'config' del servidor (la fuente de verdad).
  let CFG = {
    WIDTH: 800, HEIGHT: 450, GROUND_Y: 392, PLATFORMS: [], HIT_W: 34, HIT_H: 96, MAX_HP: 100, ROUNDS_TO_WIN: 2,
    ATTACKS: {},
  };
  const W = 800, H = 450;
  const INTERP_DELAY = 50; // ms de buffer (el servidor manda 60 snapshots/s)
  const SNAP_DIST = 150; // si un peleador salta más que esto (reinicio de ronda) no se interpola
  const SIDES = ['p1', 'p2'];
  const COLORS = { p1: '#e5484d', p2: '#3e8ef7' };
  const NAMES = { p1: 'Jugador 1', p2: 'Jugador 2' };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const elTitle = document.getElementById('overlay-title');
  const elSub = document.getElementById('overlay-sub');
  const btnReady = document.getElementById('btn-ready');
  const btnRematch = document.getElementById('btn-rematch');
  const btnReload = document.getElementById('btn-reload');
  const elRole = document.getElementById('role');
  const elPing = document.getElementById('ping');

  let storedId = null;
  try { storedId = sessionStorage.getItem('roninPlayerId'); } catch (_) { /* sin storage */ }

  const socket = io({ auth: { playerId: storedId } });

  let mySide = null;
  let phase = null; // último payload de 'phase'
  let phaseAt = 0;
  let full = false;
  let kicked = false;
  let opponentGrace = null; // { until }
  let abandonWinAt = -1e9;
  let fightAt = -1e9; // cuándo empezó FIGHTING (para mostrar "¡PELEA!")
  let snaps = [];
  let showHitboxes = false;
  let shake = 0;
  const particles = [];
  const popups = [];
  const anim = {
    p1: { st: null, since: 0, ghost: 100, flashUntil: 0 },
    p2: { st: null, since: 0, ghost: 100, flashUntil: 0 },
  };

  // ---------- Sonido (WebAudio, sin archivos) ----------

  const sfx = (() => {
    let ac = null;
    let muted = false;
    function ensure() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ac = new AC();
      }
      if (ac && ac.state === 'suspended') ac.resume();
    }
    function tone(freq, dur, type, vol, slideTo) {
      if (!ac || muted) return;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ac.currentTime + dur);
      g.gain.setValueAtTime(vol, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + dur);
    }
    function noise(dur, vol, cutoff) {
      if (!ac || muted) return;
      const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource();
      const f = ac.createBiquadFilter();
      const g = ac.createGain();
      src.buffer = buf;
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      g.gain.value = vol;
      src.connect(f).connect(g).connect(ac.destination);
      src.start();
    }
    return {
      ensure,
      toggle() { muted = !muted; return muted; },
      punch() { noise(0.08, 0.35, 1800); tone(170, 0.08, 'square', 0.12, 60); },
      kick() { noise(0.14, 0.45, 900); tone(110, 0.14, 'square', 0.16, 40); },
      block() { tone(950, 0.06, 'triangle', 0.15, 600); },
      ko() { noise(0.35, 0.45, 600); tone(220, 0.7, 'sawtooth', 0.15, 40); },
      beep(hi) { tone(hi ? 880 : 440, 0.12, 'sine', 0.15); },
    };
  })();

  // ---------- Red ----------

  socket.on('config', (c) => { CFG = c; buildBackground(); });

  socket.on('joined', ({ side, playerId }) => {
    mySide = side;
    try { sessionStorage.setItem('roninPlayerId', playerId); } catch (_) { /* ignore */ }
    elRole.textContent = `Eres el ${NAMES[side]} (${side === 'p1' ? 'rojo' : 'azul'})`;
    elRole.className = side;
  });

  socket.on('connect_error', (err) => {
    if (err && err.message === 'duel_full') {
      full = true;
      elRole.textContent = 'Sin cupo: solo pueden jugar 2';
      elRole.className = '';
      socket.disconnect(); // sin reintentos
    } else {
      elRole.textContent = 'Reconectando…';
    }
    updateOverlay();
  });
  socket.on('duel_full', () => { full = true; socket.disconnect(); updateOverlay(); });
  socket.on('kicked', () => {
    kicked = true;
    mySide = null;
    elRole.textContent = 'Expulsado por inactividad';
    elRole.className = '';
    updateOverlay();
  });
  socket.on('disconnect', () => { if (!full && !kicked) elRole.textContent = 'Reconectando…'; });

  socket.on('phase', (p) => {
    const prev = phase && phase.phase;
    phase = p;
    phaseAt = performance.now();
    if (p.phase === 'FIGHTING' && prev !== 'FIGHTING') fightAt = performance.now();
    if (p.phase === 'WAITING') opponentGrace = null; // el slot del rival se liberó
    btnReady.disabled = false;
    btnRematch.disabled = false;
    updateOverlay();
  });

  socket.on('state', (s) => {
    snaps.push({ at: performance.now(), s });
    if (snaps.length > 40) snaps.shift();
  });

  socket.on('hit', (e) => {
    const now = performance.now();
    if (!e.blocked) anim[e.target].flashUntil = now + 120;
    spawnSparks(e.x, e.y, e.blocked, e.attack === 'kick');
    popups.push({ x: e.x, y: e.y - 14, text: e.blocked ? `-${e.damage} BLOQUEO` : `-${e.damage}`, life: 0.8, max: 0.8, color: e.blocked ? '#9fd3ff' : '#ffd166' });
    shake = Math.max(shake, e.blocked ? 2 : e.attack === 'kick' ? 7 : 4);
    if (e.blocked) sfx.block();
    else if (e.attack === 'kick') sfx.kick();
    else sfx.punch();
  });

  socket.on('round_over', (r) => {
    if (r.reason === 'ko' || r.reason === 'double_ko') { shake = 12; sfx.ko(); }
  });

  socket.on('game_over', (g) => {
    if (g.reason === 'abandon' && g.winner === mySide) abandonWinAt = performance.now();
  });

  socket.on('opponent_left', ({ graceMs }) => {
    opponentGrace = { until: performance.now() + graceMs };
    updateOverlay();
  });
  socket.on('opponent_back', () => { opponentGrace = null; updateOverlay(); });

  btnReady.addEventListener('click', () => { sfx.ensure(); socket.emit('ready'); btnReady.disabled = true; });
  btnRematch.addEventListener('click', () => { sfx.ensure(); socket.emit('rematch'); btnRematch.disabled = true; });
  btnReload.addEventListener('click', () => location.reload());

  setInterval(() => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(2000).emit('latency', (err) => {
      elPing.textContent = err ? '— ms' : `${Math.round(performance.now() - t0)} ms`;
    });
  }, 2000);

  // ---------- Input ----------
  // Se manda el estado de los botones solo cuando cambia; el servidor decide todo.

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'block', KeyS: 'block',
    ShiftLeft: 'run', ShiftRight: 'run',
    KeyJ: 'punch', KeyZ: 'punch',
    KeyK: 'kick', KeyX: 'kick',
  };
  const heldCodes = new Set();
  let sentKey = '';

  function syncInput() {
    const inp = { left: false, right: false, jump: false, block: false, run: false, punch: false, kick: false };
    for (const code of heldCodes) inp[KEYMAP[code]] = true;
    const key = JSON.stringify(inp);
    if (key !== sentKey) {
      sentKey = key;
      if (mySide) socket.emit('input', inp);
    }
  }

  window.addEventListener('keydown', (e) => {
    sfx.ensure();
    if (e.code === 'KeyH' && !e.repeat) showHitboxes = !showHitboxes;
    if (e.code === 'KeyM' && !e.repeat) sfx.toggle();
    if (e.code === 'Enter' && !e.repeat) {
      if (!btnReady.hidden && !btnReady.disabled) btnReady.click();
      else if (!btnRematch.hidden && !btnRematch.disabled) btnRematch.click();
    }
    if (!KEYMAP[e.code]) return;
    e.preventDefault();
    heldCodes.add(e.code);
    syncInput();
  });
  window.addEventListener('keyup', (e) => {
    if (!KEYMAP[e.code]) return;
    heldCodes.delete(e.code);
    syncInput();
  });
  window.addEventListener('blur', () => { heldCodes.clear(); syncInput(); });
  socket.on('connect', () => { sentKey = ''; syncInput(); });

  // ---------- Overlay ----------

  function show(mode, title, sub, { ready = false, rematch = false, reload = false } = {}) {
    overlay.className = `overlay ${mode}`;
    elTitle.textContent = title;
    elSub.textContent = sub || '';
    btnReady.hidden = !ready;
    btnRematch.hidden = !rematch;
    btnReload.hidden = !reload;
  }
  function hideOverlay() { overlay.className = 'overlay hidden'; }

  const who = (side) => (side === mySide ? 'ti' : NAMES[side]);

  function updateOverlay() {
    const now = performance.now();
    if (full) return show('full', 'Duelo lleno', 'Ya hay 2 jugadores peleando y no se admiten espectadores. Intenta más tarde.');
    if (kicked) return show('full', 'Expulsado por inactividad', 'No pulsaste "Listo" a tiempo.', { reload: true });
    if (!phase) return show('full', 'Conectando…', '');

    const inProgress = ['COUNTDOWN', 'FIGHTING', 'ROUND_END'].includes(phase.phase);
    if (opponentGrace) {
      const s = Math.max(0, Math.ceil((opponentGrace.until - now) / 1000));
      return inProgress
        ? show('full', 'Rival desconectado', `Pelea en pausa. Si no vuelve en ${s} s ganas por abandono.`)
        : show('banner', 'Rival desconectado', `Esperando reconexión (${s} s)…`);
    }

    switch (phase.phase) {
      case 'WAITING':
        if (now - abandonWinAt < 6000) return show('banner', '¡Ganaste por abandono!', 'Tu rival se fue. Esperando a un nuevo rival…');
        return show('banner', 'Esperando rival…', 'Comparte esta página con otra persona. Mientras, practica con el Costalito.');
      case 'READY': {
        const iAmReady = mySide && phase.ready[mySide];
        return show(
          'banner',
          iAmReady ? 'Esperando al rival…' : '¡Rival encontrado!',
          iAmReady ? 'Tú ya estás listo.' : 'Pulsa "Listo" (o Enter) cuando quieras pelear.',
          { ready: !iAmReady }
        );
      }
      case 'COUNTDOWN': {
        const left = Math.max(0, phase.endsInMs - (now - phaseAt));
        return show('clear', String(Math.max(1, Math.ceil(left / 1000))), `Ronda ${phase.round}`);
      }
      case 'FIGHTING':
        if (now - fightAt < 700) return show('clear', '¡PELEA!', '');
        return hideOverlay();
      case 'ROUND_END': {
        const title = { ko: 'K.O.', double_ko: 'Doble K.O.', time: '¡Tiempo!' }[phase.roundReason] || '';
        const sub = phase.roundWinner ? `Ronda para ${who(phase.roundWinner)}` : 'Empate: nadie gana la ronda';
        return show('clear', title, sub);
      }
      case 'GAME_OVER': {
        const won = phase.winner === mySide;
        const iWant = mySide && phase.rematch[mySide];
        return show(
          'full',
          won ? '¡Ganaste el duelo!' : 'Perdiste el duelo',
          `Rondas ${phase.rounds.p1} – ${phase.rounds.p2}` + (iWant ? ' · esperando al rival para la revancha' : ''),
          { rematch: !iWant }
        );
      }
      default:
        return hideOverlay();
    }
  }

  // Refresca textos que dependen del tiempo (cuenta regresiva, gracia, "¡PELEA!")
  let lastOverlayKey = '';
  function updateOverlayTick(now) {
    if (!phase) return;
    let key = phase.phase;
    if (phase.phase === 'COUNTDOWN') key += Math.ceil((phase.endsInMs - (now - phaseAt)) / 1000);
    if (phase.phase === 'FIGHTING') key += now - fightAt < 700 ? 'go' : '';
    if (phase.phase === 'WAITING') key += now - abandonWinAt < 6000 ? 'ab' : '';
    if (opponentGrace) key += 'g' + Math.ceil((opponentGrace.until - now) / 1000);
    if (key !== lastOverlayKey) {
      if (phase.phase === 'COUNTDOWN' && lastOverlayKey.startsWith('COUNTDOWN')) sfx.beep(false);
      if (key === 'FIGHTINGgo') sfx.beep(true);
      lastOverlayKey = key;
      updateOverlay();
    }
  }

  // ---------- Interpolación ----------

  const lerp = (a, b, t) => a + (b - a) * t;

  function interpolated(now) {
    if (!snaps.length) return null;
    const target = now - INTERP_DELAY;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].at <= target) { a = snaps[i]; b = snaps[i + 1] || null; break; }
    }
    if (!a) return snaps[0].s;
    if (!b) return a.s;
    const t = (target - a.at) / (b.at - a.at || 1);
    const players = {};
    for (const s of SIDES) {
      const A = a.s.players[s], B = b.s.players[s];
      const jump = Math.hypot(B.x - A.x, B.y - A.y) > SNAP_DIST;
      players[s] = jump ? B : { ...B, x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t) };
    }
    return { ...b.s, players };
  }

  // ---------- Fondo (se dibuja una vez en un canvas aparte) ----------

  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;

  function buildBackground() {
    const g = bg.getContext('2d');
    const GY = CFG.GROUND_Y;

    const sky = g.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, '#1c1436');
    sky.addColorStop(0.55, '#7a3b6b');
    sky.addColorStop(1, '#f08a5d');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // Estrellas
    g.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 137.5) % W, y = (i * 53.3) % 150;
      g.fillRect(x, y, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
    }

    // Sol poniente
    const sun = g.createRadialGradient(400, 250, 10, 400, 250, 120);
    sun.addColorStop(0, 'rgba(255,214,140,0.95)');
    sun.addColorStop(0.45, 'rgba(255,170,110,0.55)');
    sun.addColorStop(1, 'rgba(255,140,100,0)');
    g.fillStyle = sun;
    g.fillRect(250, 110, 300, 280);
    g.fillStyle = '#ffd98a';
    g.beginPath(); g.arc(400, 250, 46, 0, Math.PI * 2); g.fill();

    // Montañas lejanas
    const mountains = (base, amp, wl, color, phase0) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, GY);
      for (let x = 0; x <= W; x += 6) {
        g.lineTo(x, base - amp * (0.55 + 0.3 * Math.sin(x / wl + phase0) + 0.15 * Math.sin(x / (wl * 0.37) + 1.7)));
      }
      g.lineTo(W, GY);
      g.closePath();
      g.fill();
    };
    mountains(GY - 60, 150, 120, '#4a2a55', 0.4);
    mountains(GY - 20, 90, 80, '#321d3f', 2.1);

    // Pagodas en silueta
    const pagoda = (cx, base, s) => {
      g.fillStyle = '#1d1226';
      for (let i = 0; i < 3; i++) {
        const y = base - i * 34 * s;
        const w = (70 - i * 14) * s;
        g.fillRect(cx - w * 0.32, y - 26 * s, w * 0.64, 26 * s);
        g.beginPath();
        g.moveTo(cx - w * 0.75, y - 22 * s);
        g.quadraticCurveTo(cx, y - 40 * s, cx + w * 0.75, y - 22 * s);
        g.lineTo(cx + w * 0.55, y - 30 * s);
        g.lineTo(cx - w * 0.55, y - 30 * s);
        g.closePath();
        g.fill();
      }
      g.fillRect(cx - 1.5 * s, base - 128 * s, 3 * s, 30 * s);
    };
    pagoda(110, GY, 0.9);
    pagoda(700, GY, 1.1);

    // Piso de madera del dojo
    const floor = g.createLinearGradient(0, GY, 0, H);
    floor.addColorStop(0, '#8a5a36');
    floor.addColorStop(1, '#4b2e1c');
    g.fillStyle = floor;
    g.fillRect(0, GY, W, H - GY);
    g.fillStyle = '#c08552';
    g.fillRect(0, GY, W, 4);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const y = GY + 4 + row * 14;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      for (let x = (row % 2) * 60; x < W; x += 120) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 14); g.stroke();
      }
    }

    // Plataformas (vigas de madera con soportes)
    for (const p of CFG.PLATFORMS) {
      g.fillStyle = '#3a2416';
      g.fillRect(p.x + 14, p.y + 12, 6, 16);
      g.fillRect(p.x + p.w - 20, p.y + 12, 6, 16);
      g.fillStyle = '#a66a3d';
      g.fillRect(p.x, p.y, p.w, 12);
      g.fillStyle = '#d19a63';
      g.fillRect(p.x, p.y, p.w, 3);
      g.strokeStyle = '#2a190e';
      g.lineWidth = 2;
      g.strokeRect(p.x + 1, p.y + 1, p.w - 2, 11);
      // Linterna colgante
      const lx = p.x + p.w / 2;
      g.strokeStyle = '#2a190e';
      g.beginPath(); g.moveTo(lx, p.y + 12); g.lineTo(lx, p.y + 22); g.stroke();
      g.fillStyle = '#e5484d';
      g.beginPath(); g.ellipse(lx, p.y + 31, 8, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,220,150,0.5)';
      g.beginPath(); g.ellipse(lx, p.y + 31, 4, 7, 0, 0, Math.PI * 2); g.fill();
    }
  }
  buildBackground();

  // ---------- Efectos ----------

  function spawnSparks(x, y, blocked, big) {
    const n = blocked ? 8 : big ? 16 : 11;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (blocked ? 120 : 200) + Math.random() * (big ? 260 : 160);
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.25 + Math.random() * 0.2, max: 0.45,
        color: blocked ? '#9fd3ff' : i % 3 ? '#ffd166' : '#ffffff',
        size: blocked ? 2 : 3,
      });
    }
  }

  function updateEffects(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.life -= dt;
      p.y -= 40 * dt;
      if (p.life <= 0) popups.splice(i, 1);
    }
    shake = Math.max(0, shake - 40 * dt);
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Peleadores ----------

  function floorUnder(v) {
    let y = CFG.GROUND_Y;
    for (const p of CFG.PLATFORMS) {
      if (v.x > p.x && v.x < p.x + p.w && p.y >= v.y - 1 && p.y < y) y = p.y;
    }
    return y;
  }

  function drawFighter(side, v, now, absent) {
    const a = anim[side];
    if (a.st !== v.st) { a.st = v.st; a.since = now; }
    const t = (now - a.since) / 1000;

    // Sombra (se achica al subir)
    const fy = floorUnder(v);
    const air = Math.max(0, fy - v.y);
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.35 - air / 500)})`;
    ctx.beginPath();
    ctx.ellipse(v.x, fy + 2, Math.max(8, 24 - air / 8), 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    if (absent) ctx.globalAlpha = 0.4;
    ctx.translate(v.x, v.y);
    ctx.scale(v.f, 1);
    if (v.st === 'ko') { // cae de espaldas
      const k = Math.min(1, t * 4);
      ctx.translate(0, -8 * k);
      ctx.rotate(-1.45 * k);
    }
    const flash = now < a.flashUntil || (v.st === 'hurt' && t < 0.1);
    if (Sprites.ready(side)) {
      if (flash && Math.floor(now / 50) % 2) ctx.globalAlpha *= 0.35; // parpadeo al recibir golpe
      Sprites.draw(ctx, side, v, t);
    } else {
      Fighter.draw(ctx, side, v, t, CFG.ATTACKS, { flash });
    }
    ctx.restore();

    // Etiqueta sobre la cabeza
    if (v.st !== 'ko') {
      const label = absent ? 'COSTALITO' : side === mySide ? 'TÚ' : side === 'p1' ? 'J1' : 'J2';
      const ty = v.y - CFG.HIT_H - 26;
      ctx.font = '800 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeText(label, v.x, ty);
      ctx.fillStyle = absent ? '#aaa' : COLORS[side];
      ctx.fillText(label, v.x, ty);
      if (side === mySide) {
        ctx.beginPath();
        ctx.moveTo(v.x - 5, ty + 4); ctx.lineTo(v.x + 5, ty + 4); ctx.lineTo(v.x, ty + 10);
        ctx.closePath();
        ctx.fill();
      }
    }

    if (showHitboxes) drawHitboxes(v);
  }

  function drawHitboxes(v) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00aaff';
    ctx.strokeRect(v.x - CFG.HIT_W / 2, v.y - CFG.HIT_H, CFG.HIT_W, CFG.HIT_H);
    const A = CFG.ATTACKS[v.st];
    if (A) {
      const k = v.ap * A.total;
      const active = k >= A.startup && k < A.startup + A.active;
      const [n, f] = A.reach;
      const l = v.f === 1 ? v.x + n : v.x - f;
      ctx.strokeStyle = active ? '#ff2d2d' : 'rgba(255,120,120,0.5)';
      ctx.strokeRect(l, v.y + A.box[0], f - n, A.box[1] - A.box[0]);
    }
  }

  // ---------- HUD ----------

  function drawHud(s, now, dt) {
    const practice = !s || s.practice;
    const bw = 300, bh = 16, by = 16;
    for (const side of SIDES) {
      const v = s && s.players[side];
      const hp = v ? v.hp : CFG.MAX_HP;
      const a = anim[side];
      a.ghost = hp > a.ghost ? hp : Math.max(hp, a.ghost - 45 * dt);
      const x = side === 'p1' ? 20 : W - 20 - bw;
      const frac = hp / CFG.MAX_HP;
      const gfrac = a.ghost / CFG.MAX_HP;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - 3, by - 3, bw + 6, bh + 6);
      ctx.fillStyle = '#3a1820';
      ctx.fillRect(x, by, bw, bh);
      // La barra del J2 se vacía hacia la derecha (espejo)
      const fill = (f, color) => {
        ctx.fillStyle = color;
        if (side === 'p1') ctx.fillRect(x + bw * (1 - f), by, bw * f, bh);
        else ctx.fillRect(x, by, bw * f, bh);
      };
      fill(gfrac, '#f5efe2');
      fill(frac, frac > 0.3 ? COLORS[side] : '#ff9f1c');
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, by, bw, 4);

      // Nombre y rondas ganadas
      const occupied = phase && phase.occupied[side];
      const name = (occupied ? NAMES[side] : 'Costalito') + (side === mySide ? ' (tú)' : '');
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = side === 'p1' ? 'left' : 'right';
      ctx.fillStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      const nx = side === 'p1' ? x : x + bw;
      ctx.strokeText(name, nx, by + bh + 17);
      ctx.fillText(name, nx, by + bh + 17);

      const won = phase ? phase.rounds[side] : 0;
      for (let i = 0; i < CFG.ROUNDS_TO_WIN; i++) {
        const cx = side === 'p1' ? x + bw - 8 - i * 18 : x + 8 + i * 18;
        ctx.beginPath();
        ctx.arc(cx, by + bh + 12, 6, 0, Math.PI * 2);
        ctx.fillStyle = i < won ? '#ffc53d' : 'rgba(0,0,0,0.5)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffc53d';
        ctx.stroke();
      }
    }

    // Reloj central
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(W / 2 - 34, 8, 68, 40);
    ctx.strokeStyle = '#ffc53d';
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 34, 8, 68, 40);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    if (practice) {
      ctx.font = '800 11px system-ui, sans-serif';
      ctx.fillText('PRÁCTICA', W / 2, 33);
    } else {
      const tl = s ? s.timeLeft : 0;
      ctx.font = '800 26px system-ui, sans-serif';
      ctx.fillStyle = tl <= 10 && phase && phase.phase === 'FIGHTING' && Math.floor(now / 250) % 2 ? '#ff6b6b' : '#fff';
      ctx.fillText(String(tl), W / 2, 38);
      if (phase) {
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.fillStyle = '#ffc53d';
        ctx.fillText(`RONDA ${phase.round}`, W / 2, 62);
      }
    }
  }

  // ---------- Bucle de render ----------

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    updateOverlayTick(now);
    updateEffects(dt);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    ctx.drawImage(bg, 0, 0);

    if (showHitboxes) {
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1;
      for (const p of CFG.PLATFORMS) ctx.strokeRect(p.x, p.y, p.w, 12);
    }

    const s = full ? null : interpolated(now);
    if (s) {
      // Primero el rival y al final el propio, para verse siempre encima.
      const order = mySide === 'p1' ? ['p2', 'p1'] : ['p1', 'p2'];
      for (const side of order) {
        const absent = phase && !phase.occupied[side];
        drawFighter(side, s.players[side], now, absent);
      }
    }
    drawEffects();
    ctx.restore();

    if (!full) drawHud(s, now, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  updateOverlay();
})();
