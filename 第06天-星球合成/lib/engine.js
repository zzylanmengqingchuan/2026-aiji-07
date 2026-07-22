'use strict';
/**
 * 星球合成 · 服务端权威模拟（Agent / 观战共用）
 * 与浏览器端 config + physics + 计分规则对齐。
 */

const CFG = {
  W: 480,
  H: 720,
  wallL: 10,
  wallR: 470,
  floorY: 706,
  lineY: 132,
  dropY: 72,
  gravity: 2400,
  restitution: 0.12,
  wallRestitution: 0.32,
  airDrag: 0.02,
  floorFriction: 2.4,
  maxSpeed: 1600,
  dropCooldown: 0.55,
  spawnLevels: 5,
  overLineTime: 2.2,
  comboWindow: 1.5,
};

const LEVELS = [
  { name: '陨石', r: 22, kind: 'crater', light: '#c9c9cf', base: '#9a9aa2', dark: '#5f5f66' },
  { name: '月球', r: 30, kind: 'crater', light: '#f2f3f5', base: '#cfd2d6', dark: '#8a8e96' },
  { name: '水星', r: 38, kind: 'crater', light: '#f0c08a', base: '#c98a4b', dark: '#7d4f24' },
  { name: '火星', r: 46, kind: 'crater', light: '#ff9d6e', base: '#d9542b', dark: '#8c2c12' },
  { name: '金星', r: 55, kind: 'band', light: '#ffe9a8', base: '#e8c15a', dark: '#a67c22' },
  { name: '地球', r: 64, kind: 'earth', light: '#7ec3ff', base: '#3f8fdd', dark: '#1c4e8c' },
  { name: '海王星', r: 74, kind: 'band', light: '#7d9bff', base: '#2b4fd4', dark: '#152a75' },
  { name: '天王星', r: 84, kind: 'ring', light: '#c9fbfb', base: '#6fd6d6', dark: '#2f8f96', ring: '#b8efef' },
  { name: '土星', r: 95, kind: 'ring', light: '#ffe3a6', base: '#d9b06a', dark: '#8f6a2e', ring: '#e8cd8f' },
  { name: '木星', r: 107, kind: 'jupiter', light: '#f5cf9a', base: '#d89b5e', dark: '#8a5a2a' },
  { name: '太阳', r: 120, kind: 'sun', light: '#fff6c0', base: '#ffcf3f', dark: '#f07f13' },
];

function mergeScore(levelIdx) {
  const n = levelIdx + 1;
  return (n * (n + 1)) / 2;
}

let _ballId = 1;

class Ball {
  constructor(x, y, level) {
    this.id = _ballId++;
    this.level = level;
    this.r = LEVELS[level].r;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.rot = Math.random() * Math.PI * 2;
    this.landed = false;
    this.dead = false;
    this.pending = false;
    this.overT = 0;
    this.age = 0;
  }
}

class World {
  constructor() {
    this.balls = [];
  }

  reset() {
    this.balls.length = 0;
  }

  add(b) {
    this.balls.push(b);
  }

  step(dt) {
    const bs = this.balls;
    for (const b of bs) {
      b.age += dt;
      b.vy += CFG.gravity * dt;
      b.vx *= 1 - CFG.airDrag * dt;
      const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > CFG.maxSpeed) {
        const k = CFG.maxSpeed / sp;
        b.vx *= k;
        b.vy *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += (b.vx / Math.max(b.r, 1)) * dt * 0.6;

      if (b.x - b.r < CFG.wallL) {
        b.x = CFG.wallL + b.r;
        if (b.vx < 0) b.vx = -b.vx * CFG.wallRestitution;
      }
      if (b.x + b.r > CFG.wallR) {
        b.x = CFG.wallR - b.r;
        if (b.vx > 0) b.vx = -b.vx * CFG.wallRestitution;
      }
      if (b.y + b.r > CFG.floorY) {
        b.y = CFG.floorY - b.r;
        if (b.vy > 0) {
          b.vy = -b.vy * CFG.restitution;
          if (Math.abs(b.vy) < 30) b.vy = 0;
        }
        b.vx *= 1 - CFG.floorFriction * dt;
        b.landed = true;
      }
    }

    const mergePairs = [];
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        if (a.dead) continue;
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          if (b.dead) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          if (dx * dx + dy * dy >= min * min) continue;
          if (iter === 0 && a.level === b.level && !a.pending && !b.pending) {
            a.pending = b.pending = true;
            mergePairs.push({ a, b });
          }
          this._solve(a, b, dx, dy, min);
        }
      }
    }

    for (const b of bs) {
      if (b.dead) continue;
      if (b.x - b.r < CFG.wallL) {
        b.x = CFG.wallL + b.r;
        if (b.vx < 0) b.vx = 0;
      }
      if (b.x + b.r > CFG.wallR) {
        b.x = CFG.wallR - b.r;
        if (b.vx > 0) b.vx = 0;
      }
      if (b.y + b.r > CFG.floorY) {
        b.y = CFG.floorY - b.r;
        if (b.vy > 0) b.vy = 0;
      }
    }

    const events = [];
    if (mergePairs.length) {
      for (const pair of mergePairs) {
        const a = pair.a;
        const b = pair.b;
        if (a.dead || b.dead) continue;
        a.dead = b.dead = true;
        const ma = a.r * a.r;
        const mb = b.r * b.r;
        const mx = (a.x * ma + b.x * mb) / (ma + mb);
        const my = (a.y * ma + b.y * mb) / (ma + mb);

        if (a.level >= LEVELS.length - 1) {
          events.push({ type: 'annihilate', x: mx, y: my, level: a.level });
          continue;
        }

        const nb = new Ball(mx, my, a.level + 1);
        nb.vx = (a.vx + b.vx) * 0.3;
        nb.vy = Math.min((a.vy + b.vy) * 0.3, 0) - 90;
        nb.landed = true;
        nb.x = Math.min(Math.max(nb.x, CFG.wallL + nb.r), CFG.wallR - nb.r);
        nb.y = Math.min(nb.y, CFG.floorY - nb.r);
        this.balls.push(nb);
        events.push({ type: 'merge', x: nb.x, y: nb.y, level: nb.level });
      }
      this.balls = this.balls.filter((b) => !b.dead);
    }
    return events;
  }

  _solve(a, b, dx, dy, min) {
    let d = Math.sqrt(dx * dx + dy * dy);
    let nx;
    let ny;
    if (d < 0.0001) {
      nx = 0;
      ny = -1;
      d = 0.0001;
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    const overlap = min - d;
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const invA = 1 / ma;
    const invB = 1 / mb;
    const invSum = invA + invB;
    const corr = (overlap / invSum) * 0.8;
    a.x -= nx * corr * invA;
    a.y -= ny * corr * invA;
    b.x += nx * corr * invB;
    b.y += ny * corr * invB;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const jimp = (-(1 + CFG.restitution) * vn) / invSum;
      a.vx -= jimp * nx * invA;
      a.vy -= jimp * ny * invA;
      b.vx += jimp * nx * invB;
      b.vy += jimp * ny * invB;
      const tx = -ny;
      const ty = nx;
      const vt = rvx * tx + rvy * ty;
      const jt = (-vt / invSum) * 0.15;
      a.vx -= jt * tx * invA;
      a.vy -= jt * ty * invA;
      b.vx += jt * tx * invB;
      b.vy += jt * ty * invB;
    }
    a.landed = true;
    b.landed = true;
  }
}

function randLevel(rng) {
  return Math.floor(rng() * CFG.spawnLevels);
}

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

class GameSession {
  constructor(code, opts = {}) {
    this.code = code;
    this.createdAt = Date.now();
    this.lastTouchedAt = Date.now();
    this.phase = 'lobby'; // lobby | playing | over
    this.world = new World();
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.aimX = CFG.W / 2;
    this.heldLevel = 0;
    this.nextLevel = 0;
    this.dropTimer = 0;
    this.danger = false;
    this.time = 0;
    this.tickCount = 0;
    this.seed = opts.seed != null ? opts.seed : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    this.rng = makeRng(this.seed);
    this.player = null; // { id, token, name, kind, agentId }
    this.recentEvents = [];
    this.eventLog = []; // full history for result
    this.result = null;
    this.drops = 0;
    this.maxLevelReached = 0;
    this.sunBorn = 0;
    this.annihilations = 0;
  }

  touch() {
    this.lastTouchedAt = Date.now();
  }

  setPlayer(p) {
    this.player = p;
  }

  start() {
    if (!this.player) return { ok: false, err: '无人入座' };
    if (this.phase === 'playing') return { ok: true, already: true };
    this.world.reset();
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.aimX = CFG.W / 2;
    this.dropTimer = 0;
    this.danger = false;
    this.time = 0;
    this.tickCount = 0;
    this.recentEvents = [];
    this.eventLog = [];
    this.result = null;
    this.drops = 0;
    this.maxLevelReached = 0;
    this.sunBorn = 0;
    this.annihilations = 0;
    this.heldLevel = randLevel(this.rng);
    this.nextLevel = randLevel(this.rng);
    this.phase = 'playing';
    this.touch();
    return { ok: true };
  }

  applyAction(body) {
    this.touch();
    if (this.phase !== 'playing') return { ok: false, err: '未在对局中', phase: this.phase };

    if (typeof body.aimX === 'number' && Number.isFinite(body.aimX)) {
      this.aimX = Math.min(Math.max(body.aimX, CFG.wallL), CFG.wallR);
    }
    if (typeof body.aimDx === 'number' && Number.isFinite(body.aimDx)) {
      this.aimX = Math.min(Math.max(this.aimX + body.aimDx, CFG.wallL), CFG.wallR);
    }

    let dropped = false;
    if (body.drop === true || body.drop === 1 || body.action === 'drop') {
      dropped = this.tryDrop();
    }
    return { ok: true, dropped, aimX: this.aimX, dropTimer: this.dropTimer };
  }

  tryDrop() {
    if (this.phase !== 'playing' || this.dropTimer > 0) return false;
    const r = LEVELS[this.heldLevel].r;
    const x = Math.min(Math.max(this.aimX, CFG.wallL + r), CFG.wallR - r);
    const b = new Ball(x, CFG.dropY, this.heldLevel);
    this.world.add(b);
    this.drops += 1;
    this.heldLevel = this.nextLevel;
    this.nextLevel = randLevel(this.rng);
    this.dropTimer = CFG.dropCooldown;
    this.pushEvent({
      type: 'drop',
      x,
      y: CFG.dropY,
      level: b.level,
      name: LEVELS[b.level].name,
      score: this.score,
      t: this.time,
    });
    return true;
  }

  pushEvent(ev) {
    this.recentEvents.push(ev);
    this.eventLog.push(ev);
    if (this.recentEvents.length > 30) this.recentEvents.shift();
    if (this.eventLog.length > 500) this.eventLog.shift();
  }

  handleMergeEvents(events) {
    for (const ev of events) {
      if (this.comboTimer > 0) this.combo += 1;
      else this.combo = 1;
      this.comboTimer = CFG.comboWindow;

      if (ev.type === 'annihilate') {
        const gained = 150 * this.combo;
        this.score += gained;
        this.annihilations += 1;
        this.pushEvent({
          type: 'annihilate',
          x: ev.x,
          y: ev.y,
          level: ev.level,
          name: '太阳',
          scoreGained: gained,
          score: this.score,
          combo: this.combo,
          t: this.time,
        });
      } else {
        const gained = mergeScore(ev.level) * this.combo;
        this.score += gained;
        if (ev.level > this.maxLevelReached) this.maxLevelReached = ev.level;
        if (ev.level === LEVELS.length - 1) this.sunBorn += 1;
        this.pushEvent({
          type: 'merge',
          x: ev.x,
          y: ev.y,
          level: ev.level,
          name: LEVELS[ev.level].name,
          scoreGained: gained,
          score: this.score,
          combo: this.combo,
          t: this.time,
        });
      }
    }
  }

  gameOver() {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.danger = false;
    this.result = {
      ok: true,
      code: this.code,
      score: this.score,
      drops: this.drops,
      maxLevelReached: this.maxLevelReached,
      maxLevelName: LEVELS[this.maxLevelReached] ? LEVELS[this.maxLevelReached].name : null,
      sunBorn: this.sunBorn,
      annihilations: this.annihilations,
      durationSec: Math.round(this.time * 10) / 10,
      player: this.player
        ? {
            id: this.player.id,
            name: this.player.name,
            kind: this.player.kind,
            agentId: this.player.agentId,
          }
        : null,
      summary: this.buildSummary(),
      eventLog: this.eventLog.slice(-80),
      finishedAt: Date.now(),
    };
  }

  buildSummary() {
    const p = this.player ? this.player.name : '未知';
    const top = LEVELS[this.maxLevelReached] ? LEVELS[this.maxLevelReached].name : '?';
    return `${p} 得分 ${this.score}，最高合成「${top}」，掉落 ${this.drops} 次，太阳 ${this.sunBorn} 次，湮灭 ${this.annihilations} 次，用时 ${Math.round(this.time)}s`;
  }

  /** 固定步长推进；返回是否仍在 playing */
  tick(dt) {
    if (this.phase !== 'playing') return false;
    this.time += dt;
    this.tickCount += 1;
    if (this.dropTimer > 0) this.dropTimer = Math.max(0, this.dropTimer - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    const events = this.world.step(dt);
    if (events.length) this.handleMergeEvents(events);

    let danger = false;
    for (const b of this.world.balls) {
      if (b.landed && b.y - b.r < CFG.lineY) {
        b.overT += dt;
        if (b.overT > 0.15) danger = true;
        if (b.overT >= CFG.overLineTime) {
          this.gameOver();
          return false;
        }
      } else {
        b.overT = Math.max(0, b.overT - dt * 2);
      }
    }
    this.danger = danger;
    return true;
  }

  snapshot(forPlayer) {
    const levels = LEVELS.map((L, i) => ({
      index: i,
      name: L.name,
      r: L.r,
      mergeScore: i === 0 ? 0 : mergeScore(i),
    }));
    return {
      ok: true,
      code: this.code,
      phase: this.phase,
      time: Math.round(this.time * 100) / 100,
      tick: this.tickCount,
      score: this.score,
      combo: this.combo,
      comboTimer: Math.round(this.comboTimer * 100) / 100,
      danger: this.danger,
      dropTimer: Math.round(this.dropTimer * 100) / 100,
      canDrop: this.phase === 'playing' && this.dropTimer <= 0,
      aimX: Math.round(this.aimX * 10) / 10,
      heldLevel: this.heldLevel,
      heldName: LEVELS[this.heldLevel].name,
      heldR: LEVELS[this.heldLevel].r,
      nextLevel: this.nextLevel,
      nextName: LEVELS[this.nextLevel].name,
      lineY: CFG.lineY,
      dropY: CFG.dropY,
      bounds: { W: CFG.W, H: CFG.H, wallL: CFG.wallL, wallR: CFG.wallR, floorY: CFG.floorY },
      balls: this.world.balls.map((b) => ({
        id: b.id,
        x: Math.round(b.x * 10) / 10,
        y: Math.round(b.y * 10) / 10,
        r: b.r,
        level: b.level,
        name: LEVELS[b.level].name,
        vx: Math.round(b.vx * 10) / 10,
        vy: Math.round(b.vy * 10) / 10,
        rot: Math.round(b.rot * 100) / 100,
        landed: b.landed,
        overT: Math.round(b.overT * 100) / 100,
      })),
      recentEvents: this.recentEvents.slice(-12),
      you: forPlayer && this.player
        ? {
            id: this.player.id,
            name: this.player.name,
            kind: this.player.kind,
            agentId: this.player.agentId,
          }
        : this.player
          ? {
              name: this.player.name,
              kind: this.player.kind,
              agentId: this.player.agentId,
            }
          : null,
      player: this.player
        ? { name: this.player.name, kind: this.player.kind, agentId: this.player.agentId }
        : null,
      levels,
      actionSpace: {
        aimX: `number, 瞄准 x，范围约 ${CFG.wallL}..${CFG.wallR}`,
        aimDx: 'number, 相对移动瞄准（可与 aimX 二选一）',
        drop: 'boolean, true 时在 aimX 处落下当前 held 星球（需 canDrop）',
      },
      tips: [
        '相同 level 的两球碰撞会合成 level+1',
        '合成得分 = mergeScore(新等级) × combo',
        '两个太阳相遇湮灭，得 150×combo',
        '落地球顶超过警戒线 lineY 持续 overLineTime 秒则失败',
        '建议：先 GET state，等 canDrop 再 POST drop；落下后等合成结算',
      ],
      result: this.phase === 'over' ? this.result : null,
    };
  }
}

function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

function playerId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function token() {
  return require('crypto').randomBytes(16).toString('hex');
}

module.exports = {
  CFG,
  LEVELS,
  mergeScore,
  GameSession,
  roomCode,
  playerId,
  token,
};
