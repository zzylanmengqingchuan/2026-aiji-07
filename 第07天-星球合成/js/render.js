'use strict';
/* ================= 程序化美术：星空背景 + 原创星球绘制 ================= */

const Renderer = {
  stars: [],

  initStars() {
    this.stars.length = 0;
    for (let i = 0; i < 90; i++) {
      this.stars.push({
        x: hashRand(i, 1) * CFG.W,
        y: hashRand(i, 2) * CFG.H,
        r: 0.5 + hashRand(i, 3) * 1.6,
        tw: 1 + hashRand(i, 4) * 3,
        ph: hashRand(i, 5) * Math.PI * 2,
      });
    }
  },

  drawBackground(ctx, time) {
    const g = ctx.createLinearGradient(0, 0, 0, CFG.H);
    g.addColorStop(0, '#0d1130');
    g.addColorStop(0.6, '#0a0d22');
    g.addColorStop(1, '#070917');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.W, CFG.H);

    for (const s of this.stars) {
      const a = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.tw + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  /* 容器：两侧玻璃墙 + 地面 */
  drawContainer(ctx) {
    ctx.fillStyle = 'rgba(96, 128, 230, 0.10)';
    ctx.fillRect(0, 0, CFG.wallL, CFG.H);
    ctx.fillRect(CFG.wallR, 0, CFG.W - CFG.wallR, CFG.H);
    ctx.fillRect(0, CFG.floorY, CFG.W, CFG.H - CFG.floorY);

    ctx.fillStyle = 'rgba(150, 180, 255, 0.75)';
    ctx.fillRect(CFG.wallL - 2, 0, 2, CFG.floorY);
    ctx.fillRect(CFG.wallR, 0, 2, CFG.floorY);
    ctx.fillRect(0, CFG.floorY, CFG.W, 3);
  },

  /* 警戒线 */
  drawLine(ctx, danger, time) {
    ctx.save();
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    if (danger) {
      ctx.strokeStyle = 'rgba(255, 80, 90,' + (0.55 + 0.4 * Math.sin(time * 10)) + ')';
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    }
    ctx.beginPath();
    ctx.moveTo(CFG.wallL, CFG.lineY);
    ctx.lineTo(CFG.wallR, CFG.lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    if (danger) {
      ctx.font = '700 16px "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 100, 110,' + (0.7 + 0.3 * Math.sin(time * 10)) + ')';
      ctx.fillText('⚠ 危险 ⚠', CFG.W / 2, CFG.lineY - 10);
    }
    ctx.restore();
  },

  /* 瞄准虚线 */
  drawGuide(ctx, x, y, r) {
    ctx.save();
    ctx.setLineDash([4, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + r + 4);
    ctx.lineTo(x, CFG.floorY);
    ctx.stroke();
    ctx.restore();
  },
};

/* ---------- 星球绘制 ---------- */

function _drawRing(ctx, r, color, front) {
  ctx.save();
  ctx.rotate(-0.32);
  ctx.scale(1, 0.3);
  ctx.beginPath();
  if (front) ctx.arc(0, 0, r * 1.55, 0.08 * Math.PI, 0.92 * Math.PI);
  else ctx.arc(0, 0, r * 1.55, Math.PI, Math.PI * 2);
  ctx.lineWidth = r * 0.3;
  ctx.strokeStyle = color;
  ctx.globalAlpha = front ? 0.95 : 0.6;
  ctx.stroke();
  ctx.restore();
}

function _drawCraters(ctx, level, r, dark) {
  const n = 3 + (level % 3);
  ctx.fillStyle = dark;
  for (let i = 0; i < n; i++) {
    const ang = hashRand(level, i * 7 + 1) * Math.PI * 2;
    const dist = (0.25 + hashRand(level, i * 7 + 2) * 0.5) * r;
    const cr = (0.1 + hashRand(level, i * 7 + 3) * 0.14) * r;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * dist, Math.sin(ang) * dist, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * dist - cr * 0.25, Math.sin(ang) * dist - cr * 0.25, cr * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function _drawBands(ctx, r, light) {
  ctx.fillStyle = light;
  ctx.globalAlpha = 0.22;
  for (let k = -1; k <= 1; k++) {
    const y = k * r * 0.42;
    ctx.beginPath();
    ctx.ellipse(0, y, r * 1.05, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function _drawEarthLand(ctx, r) {
  ctx.fillStyle = '#5cbb63';
  for (let i = 0; i < 4; i++) {
    const ang = hashRand(99, i * 3 + 1) * Math.PI * 2;
    const dist = (0.15 + hashRand(99, i * 3 + 2) * 0.5) * r;
    const w = (0.22 + hashRand(99, i * 3 + 3) * 0.2) * r;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(Math.cos(ang) * dist, Math.sin(ang) * dist, w, w * 0.62, ang, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(0, -r * 0.88, r * 0.5, r * 0.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function _drawJupiter(ctx, r) {
  const cols = ['#f0d7ae', '#b8763e', '#f5cf9a', '#a05c28'];
  for (let k = 0; k < 5; k++) {
    const y = -r * 0.72 + k * r * 0.36;
    ctx.fillStyle = cols[k % cols.length];
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.ellipse(0, y, r * 1.05, r * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 大红斑
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#d84f35';
  ctx.beginPath();
  ctx.ellipse(r * 0.32, r * 0.24, r * 0.22, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function _drawFace(ctx, level, r, time) {
  const ey = -r * 0.08;
  const ex = r * 0.32;
  const er = Math.max(r * 0.09, 2);
  const isSun = LEVELS[level].kind === 'sun';

  if (isSun) {
    // 太阳：眯眼笑
    ctx.strokeStyle = '#7a3c00';
    ctx.lineWidth = Math.max(r * 0.045, 1.5);
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey + er * 0.4, er * 1.1, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  } else {
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#20263f';
      ctx.beginPath();
      ctx.arc(s * ex, ey, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s * ex - er * 0.3, ey - er * 0.3, er * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 腮红
  ctx.fillStyle = 'rgba(255, 130, 150, 0.4)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.5, r * 0.14, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 微笑
  ctx.strokeStyle = isSun ? '#7a3c00' : '#20263f';
  ctx.lineWidth = Math.max(r * 0.05, 1.5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(0, r * 0.08, r * 0.3, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
}

/* 绘制一颗星球（x,y 圆心，r 半径，rot 自转角，time 用于太阳动画） */
function drawPlanet(ctx, level, x, y, r, rot, time) {
  const L = LEVELS[level];
  ctx.save();
  ctx.translate(x, y);

  // 太阳光晕
  if (L.kind === 'sun') {
    const pulse = 1 + 0.05 * Math.sin(time * 3);
    const gg = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.7 * pulse);
    gg.addColorStop(0, 'rgba(255, 200, 60, 0.55)');
    gg.addColorStop(1, 'rgba(255, 140, 20, 0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.7 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  // 光环后半
  if (L.kind === 'ring') _drawRing(ctx, r, L.ring, false);

  ctx.rotate(rot || 0);

  // 球体
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
  g.addColorStop(0, L.light);
  g.addColorStop(0.55, L.base);
  g.addColorStop(1, L.dark);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // 表面纹理（裁剪在球内）
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  if (L.kind === 'crater') _drawCraters(ctx, level, r, L.dark);
  else if (L.kind === 'band') _drawBands(ctx, r, L.light);
  else if (L.kind === 'earth') _drawEarthLand(ctx, r);
  else if (L.kind === 'jupiter') _drawJupiter(ctx, r);
  else if (L.kind === 'sun') _drawBands(ctx, r, '#fff3b0');
  // 底部暗角
  const sh = ctx.createRadialGradient(0, r * 0.4, r * 0.2, 0, r * 0.4, r * 1.2);
  sh.addColorStop(0, 'rgba(0,0,20,0)');
  sh.addColorStop(1, 'rgba(0,0,20,0.35)');
  ctx.fillStyle = sh;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();

  ctx.rotate(-(rot || 0));

  // 边缘高光
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = Math.max(r * 0.04, 1);
  ctx.beginPath();
  ctx.arc(0, 0, r - ctx.lineWidth / 2, Math.PI * 1.05, Math.PI * 1.6);
  ctx.stroke();

  // 脸（不随自转，保持可爱）
  if (r >= 14) _drawFace(ctx, level, r, time);

  // 光环前半
  if (L.kind === 'ring') _drawRing(ctx, r, L.ring, true);

  ctx.restore();
}
