'use strict';

const { getConfig } = require('./config');
const G = require('./game');

const { SIDES } = G;
const opposite = (s) => (s === 'p1' ? 'p2' : 'p1');
const IN_PROGRESS = new Set(['COUNTDOWN', 'FIGHTING', 'ROUND_END']);
const PRACTICE = new Set(['WAITING', 'READY']);

/**
 * Estado del duelo: dos slots (p1/p2), fases, rondas y reglas de entrada.
 * No conoce sockets: recibe ids y avisa por `emit(event, payload, side?)`.
 * El tiempo avanza solo con tick(dtMs) para que sea determinista y testeable.
 *
 * Fases: WAITING → READY → COUNTDOWN → FIGHTING → ROUND_END → (COUNTDOWN | GAME_OVER)
 */
class Duel {
  constructor(opts = {}, emit = () => {}) {
    this.cfg = { ...getConfig(), ...opts };
    this.emit = emit;
    this.game = G.createGame(this.cfg);
    this.slots = { p1: null, p2: null };
    this.rounds = { p1: 0, p2: 0 };
    this.round = 1;
    this.roundLeftMs = this.cfg.ROUND_TIME_MS;
    this.roundWinner = null; // 'p1' | 'p2' | null (empate)
    this.roundReason = null; // 'ko' | 'time' | 'double_ko'
    this.winner = null;
    this.phase = 'WAITING';
    this.phaseMs = 0;
    this._applyPhaseRules();
  }

  // ---------- Entrada (cupo de 2) ----------

  _findByPlayer(playerId) {
    if (this.cfg.ALLOW_SAME_BROWSER) return null; // solo desarrollo
    return SIDES.find((s) => this.slots[s] && this.slots[s].playerId === playerId) || null;
  }

  canJoin(playerId) {
    return !!this._findByPlayer(playerId) || SIDES.some((s) => !this.slots[s]);
  }

  join(playerId, socketId) {
    const existing = this._findByPlayer(playerId);
    if (existing) {
      const slot = this.slots[existing];
      const replacedSocketId = slot.connected && slot.socketId !== socketId ? slot.socketId : null;
      slot.socketId = socketId;
      slot.connected = true;
      slot.graceLeft = 0;
      this.emit('opponent_back', {}, opposite(existing));
      this._maybeStart();
      return { ok: true, side: existing, reconnected: true, replacedSocketId };
    }

    const side = SIDES.find((s) => !this.slots[s]);
    if (!side) return { ok: false, reason: 'duel_full' };

    this.slots[side] = { playerId, socketId, connected: true, ready: false, rematch: false, graceLeft: 0, idleMs: 0 };
    G.clearInput(this.game, side);
    if (SIDES.every((s) => this.slots[s]) && this.phase === 'WAITING') this._setPhase('READY');
    else this.emit('phase', this.phasePayload());
    return { ok: true, side, reconnected: false, replacedSocketId: null };
  }

  sideOf(socketId) {
    return SIDES.find((s) => this.slots[s] && this.slots[s].connected && this.slots[s].socketId === socketId) || null;
  }

  leave(socketId) {
    const side = this.sideOf(socketId);
    if (!side) return;
    const slot = this.slots[side];
    slot.connected = false;
    slot.graceLeft = this.cfg.RECONNECT_GRACE_MS;
    G.clearInput(this.game, side); // que no se quede "caminando" solo
    this.emit('opponent_left', { graceMs: this.cfg.RECONNECT_GRACE_MS }, opposite(side));
  }

  // ---------- Acciones de jugador ----------

  input(side, msg) {
    if (!SIDES.includes(side) || !this.slots[side]) return false;
    const inp = G.sanitizeInput(msg);
    if (!inp) return false;
    G.setInput(this.game, side, inp);
    return true;
  }

  ready(side) {
    if (this.phase !== 'READY' || !this.slots[side]) return false;
    this.slots[side].ready = true;
    this.emit('phase', this.phasePayload());
    this._maybeStart();
    return true;
  }

  rematch(side) {
    if (this.phase !== 'GAME_OVER' || !this.slots[side]) return false;
    this.slots[side].rematch = true;
    this.emit('phase', this.phasePayload());
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].rematch)) {
      this._resetMatch();
      this._setPhase('COUNTDOWN');
    }
    return true;
  }

  // ---------- Bucle ----------

  _paused() {
    return IN_PROGRESS.has(this.phase) && SIDES.some((s) => this.slots[s] && !this.slots[s].connected);
  }

  tick(dtMs) {
    for (const s of SIDES) {
      const slot = this.slots[s];
      if (slot && !slot.connected) {
        slot.graceLeft -= dtMs;
        if (slot.graceLeft <= 0) this._release(s);
      }
    }
    if (this._paused()) return;

    this.phaseMs += dtMs;
    const dt = dtMs / 1000;

    switch (this.phase) {
      case 'WAITING':
        this._emitEvents(G.step(this.game, dt)); // práctica libre
        break;

      case 'READY':
        this._emitEvents(G.step(this.game, dt));
        for (const s of SIDES) {
          const slot = this.slots[s];
          if (slot && slot.connected && !slot.ready) {
            slot.idleMs += dtMs;
            if (slot.idleMs >= this.cfg.IDLE_KICK_MS) {
              this.emit('kick', { socketId: slot.socketId, reason: 'idle' });
              this._release(s);
              break;
            }
          }
        }
        break;

      case 'COUNTDOWN':
        G.step(this.game, dt);
        if (this.phaseMs >= this.cfg.COUNTDOWN_MS) {
          this.roundLeftMs = this.cfg.ROUND_TIME_MS;
          this._setPhase('FIGHTING');
        }
        break;

      case 'FIGHTING': {
        const events = G.step(this.game, dt);
        this._emitEvents(events);
        const kos = events.filter((e) => e.type === 'ko');
        this.roundLeftMs -= dtMs;
        if (kos.length >= 2) this._endRound(null, 'double_ko');
        else if (kos.length === 1) this._endRound(kos[0].winner, 'ko');
        else if (this.roundLeftMs <= 0) {
          this.roundLeftMs = 0;
          const { p1, p2 } = this.game.players;
          this._endRound(p1.hp > p2.hp ? 'p1' : p2.hp > p1.hp ? 'p2' : null, 'time');
        }
        break;
      }

      case 'ROUND_END':
        G.step(this.game, dt); // deja terminar de caer al noqueado
        if (this.phaseMs >= this.cfg.ROUND_END_MS) {
          const champ = SIDES.find((s) => this.rounds[s] >= this.cfg.ROUNDS_TO_WIN);
          if (champ) {
            this.winner = champ;
            this._resetFlags();
            this._setPhase('GAME_OVER');
            this.emit('game_over', { winner: champ, rounds: { ...this.rounds }, reason: 'rounds' });
          } else {
            this.round += 1;
            this._setPhase('COUNTDOWN');
          }
        }
        break;

      default:
        break;
    }
  }

  _emitEvents(events) {
    for (const e of events) if (e.type === 'hit') this.emit('hit', e);
  }

  _endRound(winner, reason) {
    this.roundWinner = winner;
    this.roundReason = reason;
    if (winner) {
      this.rounds[winner] += 1;
      this.game.players[winner].win = true;
    }
    this._setPhase('ROUND_END');
    this.emit('round_over', { winner, reason, rounds: { ...this.rounds }, round: this.round });
  }

  // ---------- Internos ----------

  _maybeStart() {
    if (this.phase !== 'READY') return;
    if (SIDES.every((s) => this.slots[s] && this.slots[s].connected && this.slots[s].ready)) {
      this._resetMatch();
      this._setPhase('COUNTDOWN');
    }
  }

  _resetMatch() {
    this.rounds = { p1: 0, p2: 0 };
    this.round = 1;
    this.winner = null;
    this.roundWinner = null;
    this.roundReason = null;
    this._resetFlags();
  }

  _resetFlags() {
    for (const s of SIDES) {
      if (this.slots[s]) {
        this.slots[s].ready = false;
        this.slots[s].rematch = false;
        this.slots[s].idleMs = 0;
      }
    }
  }

  // Libera un slot (gracia agotada o expulsión por inactividad).
  _release(side) {
    const other = opposite(side);
    const wasInProgress = IN_PROGRESS.has(this.phase);
    this.slots[side] = null;
    G.clearInput(this.game, side);
    if (wasInProgress && this.slots[other]) {
      this.emit('game_over', { winner: other, rounds: { ...this.rounds }, reason: 'abandon' });
    }
    this._resetMatch();
    this._setPhase('WAITING');
  }

  // Reglas del juego según la fase: congelado, práctica y reinicio de ronda.
  _applyPhaseRules() {
    const g = this.game;
    g.practice = PRACTICE.has(this.phase);
    g.frozen = !(PRACTICE.has(this.phase) || this.phase === 'FIGHTING');
    if (this.phase === 'COUNTDOWN' || this.phase === 'WAITING') G.resetRound(g);
    if (this.phase === 'COUNTDOWN') this.roundLeftMs = this.cfg.ROUND_TIME_MS;
  }

  _setPhase(phase) {
    this.phase = phase;
    this.phaseMs = 0;
    this._applyPhaseRules();
    this.emit('phase', this.phasePayload());
  }

  phasePayload() {
    const occupied = {};
    const connected = {};
    const ready = {};
    const rematch = {};
    for (const s of SIDES) {
      const slot = this.slots[s];
      occupied[s] = !!slot;
      connected[s] = !!(slot && slot.connected);
      ready[s] = !!(slot && slot.ready);
      rematch[s] = !!(slot && slot.rematch);
    }
    const dur = { COUNTDOWN: this.cfg.COUNTDOWN_MS, ROUND_END: this.cfg.ROUND_END_MS }[this.phase];
    return {
      phase: this.phase,
      occupied,
      connected,
      ready,
      rematch,
      round: this.round,
      rounds: { ...this.rounds },
      roundsToWin: this.cfg.ROUNDS_TO_WIN,
      roundWinner: this.roundWinner,
      roundReason: this.roundReason,
      winner: this.winner,
      endsInMs: dur ? Math.max(0, dur - this.phaseMs) : 0,
    };
  }

  snapshot() {
    const r = (v) => Math.round(v * 10) / 10;
    const players = {};
    for (const s of SIDES) {
      const p = this.game.players[s];
      players[s] = {
        x: r(p.x),
        y: r(p.y),
        vx: Math.round(p.vx),
        vy: Math.round(p.vy),
        f: p.facing,
        st: p.state,
        ap: p.attack ? Math.round((p.attack.t / G.ATTACKS[p.attack.type].total) * 100) / 100 : 0,
        hp: p.hp,
        g: p.grounded ? 1 : 0,
      };
    }
    return {
      t: Date.now(),
      timeLeft: Math.ceil(this.roundLeftMs / 1000),
      practice: this.game.practice,
      players,
    };
  }
}

module.exports = { Duel, SIDES };
