'use strict';
/* ================= 粒子 / 飘字 / 震屏特效 ================= */

const FX = {
  particles: [],
  texts: [],
  shakeT: 0,
  shakeMag: 0,

  reset() {
    this.particles.length = 0;
    this.texts.length = 0;
    this.shakeT = 0;
    this.shakeMag = 0;
  },

  /* 合成时的星尘爆发 */
  burst(x, y, colors, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * power;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - power * 0.25,
        life: 0, maxLife: 0.5 + Math.random() * 0.45,
        size: 2 + Math.random() * 4,
        color: colors[i % colors.length],
        grav: 500,
      });
    }
  },

  /* 烟花（庆典用） */
  firework(x, y) {
    const palette = ['#ffd75e', '#ff8a5c', '#7ec3ff', '#c9fbfb', '#ff6f9f', '#b6ff7a'];
    const base = palette[Math.floor(Math.random() * palette.length)];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + Math.random() * 0.2;
      const sp = 180 + Math.random() * 320;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, maxLife: 0.8 + Math.random() * 0.6,
        size: 2 + Math.random() * 3.5,
        color: Math.random() < 0.7 ? base : '#ffffff',
        grav: 320,
      });
    }
  },

  /* 分数飘字 */
  text(x, y, str, color, size) {
    this.texts.push({ x, y, str, color: color || '#ffd75e', size: size || 22, life: 0, maxLife: 1.1 });
  },

  shake(mag) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = 0.35;
  },

  offset() {
    if (this.shakeT > 0) {
      const m = this.shakeMag * (this.shakeT / 0.35);
      return { x: (Math.random() * 2 - 1) * m, y: (Math.random() * 2 - 1) * m };
    }
    return { x: 0, y: 0 };
  },

  update(dt) {
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeMag = 0;
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { this.particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life += dt;
      if (t.life >= t.maxLife) { this.texts.splice(i, 1); continue; }
      t.y -= 55 * dt;
    }
  },

  draw(ctx) {
    for (const p of this.particles) {
      const k = 1 - p.life / p.maxLife;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const t of this.texts) {
      const k = 1 - t.life / t.maxLife;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.font = '800 ' + t.size + 'px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,10,30,0.85)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  },
};
