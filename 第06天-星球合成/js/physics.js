'use strict';
/* ================= 圆形刚体物理 ================= */

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
    this.landed = false;   // 是否已发生过碰撞（用于警戒线判定，排除刚落下的球）
    this.dead = false;
    this.pending = false;  // 本步内是否已被标记待合成
    this.overT = 0;        // 持续超线时间
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

  /* 推进一步，返回本步产生的合成事件 */
  step(dt) {
    const bs = this.balls;

    // 重力 + 积分 + 墙壁
    for (const b of bs) {
      b.age += dt;
      b.vy += CFG.gravity * dt;
      b.vx *= (1 - CFG.airDrag * dt);

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
        b.vx *= (1 - CFG.floorFriction * dt);
        b.landed = true;
      }
    }

    // 碰撞求解（多轮迭代保证稳定）
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

    // 碰撞位置修正可能把球推出边界：最终再投影回容器内
    for (const b of bs) {
      if (b.dead) continue;
      if (b.x - b.r < CFG.wallL) { b.x = CFG.wallL + b.r; if (b.vx < 0) b.vx = 0; }
      if (b.x + b.r > CFG.wallR) { b.x = CFG.wallR - b.r; if (b.vx > 0) b.vx = 0; }
      if (b.y + b.r > CFG.floorY) { b.y = CFG.floorY - b.r; if (b.vy > 0) b.vy = 0; }
    }

    // 处理合成
    const events = [];
    if (mergePairs.length) {
      for (const pair of mergePairs) {
        const a = pair.a, b = pair.b;
        if (a.dead || b.dead) continue;
        a.dead = b.dead = true;
        const ma = a.r * a.r, mb = b.r * b.r;
        const mx = (a.x * ma + b.x * mb) / (ma + mb);
        const my = (a.y * ma + b.y * mb) / (ma + mb);

        if (a.level >= LEVELS.length - 1) {
          // 两个太阳相遇：湮灭
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
        events.push({ type: 'merge', x: nb.x, y: nb.y, level: nb.level, ball: nb });
      }
      this.balls = this.balls.filter(function (b) { return !b.dead; });
    }
    return events;
  }

  /* 两球碰撞：位置修正 + 冲量（弹性 + 切向摩擦） */
  _solve(a, b, dx, dy, min) {
    let d = Math.sqrt(dx * dx + dy * dy);
    let nx, ny;
    if (d < 0.0001) { nx = 0; ny = -1; d = 0.0001; }
    else { nx = dx / d; ny = dy / d; }

    const overlap = min - d;
    const ma = a.r * a.r, mb = b.r * b.r;
    const invA = 1 / ma, invB = 1 / mb;
    const invSum = invA + invB;

    // 位置修正（按质量比例推开）
    const corr = (overlap / invSum) * 0.8;
    a.x -= nx * corr * invA;
    a.y -= ny * corr * invA;
    b.x += nx * corr * invB;
    b.y += ny * corr * invB;

    // 法向冲量
    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const jimp = (-(1 + CFG.restitution) * vn) / invSum;
      a.vx -= jimp * nx * invA;
      a.vy -= jimp * ny * invA;
      b.vx += jimp * nx * invB;
      b.vy += jimp * ny * invB;

      // 切向摩擦
      const tx = -ny, ty = nx;
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
