// Carga opcional del sprite sheet del jugador (ver sprite-config.js).
// Si no hay imagen, Sprites.ready(side) es false y se dibuja el Ronin de fighter.js.
window.Sprites = (() => {
  'use strict';

  const cfg = window.SPRITE_CONFIG || {};
  const sheets = { p1: null, p2: null }; // { img, shared }
  const cache = new Map(); // src -> Promise<Image|null>

  function loadImage(src) {
    if (!cache.has(src)) {
      cache.set(src, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth ? img : null);
        img.onerror = () => resolve(null);
        img.src = src;
      }));
    }
    return cache.get(src);
  }

  // Espacio transparente bajo los pies en cada fila (px de la imagen), para que
  // el personaje pise el suelo sin importar cómo esté recortada la imagen.
  const padCache = new Map(); // img -> number[]
  function rowPads(img) {
    if (padCache.has(img)) return padCache.get(img);
    const rows = cfg.rows || 1;
    const ch = img.naturalHeight / rows;
    let pads = new Array(rows).fill(0);
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      pads = pads.map((_, r) => {
        const top = Math.floor(r * ch);
        for (let y = Math.floor((r + 1) * ch) - 1; y >= top; y--) {
          for (let x = 0; x < c.width; x++) if (data[(y * c.width + x) * 4 + 3] > 20) return (r + 1) * ch - 1 - y;
        }
        return 0;
      });
    } catch (_) { /* imagen de otro origen: sin ajuste */ }
    padCache.set(img, pads);
    return pads;
  }

  async function loadFor(side) {
    const images = cfg.images || {};
    if (images[side]) {
      const img = await loadImage(images[side]);
      if (img) { sheets[side] = { img, shared: false }; return; }
    }
    if (images.default) {
      const img = await loadImage(images.default);
      if (img) sheets[side] = { img, shared: true };
    }
  }

  if (cfg.enabled !== false) { loadFor('p1'); loadFor('p2'); }

  function resolveAnim(state) {
    const anims = cfg.anims || {};
    if (anims[state]) return { anim: anims[state], fixed: null, name: state };
    const fb = (cfg.fallback || {})[state];
    if (typeof fb === 'string' && anims[fb]) return { anim: anims[fb], fixed: null, name: fb };
    if (fb && typeof fb === 'object' && anims[fb.anim]) return { anim: anims[fb.anim], fixed: fb.frame || 0, name: fb.anim };
    return anims.idle ? { anim: anims.idle, fixed: 0, name: 'idle' } : null;
  }

  // Elige el cuadro: ciclos por tiempo, golpes por progreso, salto por velocidad vertical.
  function frameIndex(r, state, v, t) {
    const n = r.anim.frames || 1;
    if (r.fixed !== null) return Math.min(n - 1, r.fixed);
    if (state === 'punch' || state === 'kick') return Math.min(n - 1, Math.floor(v.ap * n));
    if (r.name === 'jump' && state === 'jump') {
      let i;
      if (v.vy < -600) i = 0; // despegando
      else if (v.vy < -250) i = 1; // subiendo
      else if (v.vy <= 150) i = 2; // punto más alto
      else i = 3; // cayendo
      return n >= 4 ? i : Math.round((i * (n - 1)) / 3);
    }
    return Math.floor(t * (r.anim.fps || 8)) % n;
  }

  return {
    ready(side) { return !!sheets[side]; },

    // Dibuja con el origen en los pies, mirando a la derecha (quien llama voltea y rota).
    draw(ctx, side, v, t) {
      const sheet = sheets[side];
      if (!sheet) return false;
      const r = resolveAnim(v.st);
      if (!r) return false;
      const { img } = sheet;
      const cw = img.naturalWidth / (cfg.cols || 1);
      const ch = img.naturalHeight / (cfg.rows || 1);
      const i = frameIndex(r, v.st, v, t);
      const scale = (cfg.height || ch) / ch;
      const dw = cw * scale;
      const dh = ch * scale;
      ctx.save();
      if (cfg.facesRight === false) ctx.scale(-1, 1);
      if (side === 'p2' && sheet.shared && cfg.p2Filter) ctx.filter = cfg.p2Filter;
      const row = r.anim.row || 0;
      const pad = cfg.footPad === 'auto' || cfg.footPad === undefined ? rowPads(img)[row] || 0 : cfg.footPad;
      ctx.drawImage(img, i * cw, row * ch, cw, ch, -dw / 2, -dh + pad * scale, dw, dh);
      ctx.restore();
      return true;
    },
  };
})();
