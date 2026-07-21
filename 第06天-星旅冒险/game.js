'use strict';
/* ============================================================
 * 星旅冒险 · Star Trail Adventure
 * 原创横版平台跳跃游戏（Canvas 2D + 原生 JS，无第三方依赖）
 * ============================================================ */

/* ---------------- 全局常量 ---------------- */
const TILE = 48;            // 地图瓦片尺寸（像素）
const VIEW_W = 960;         // 逻辑分辨率（16:9）
const VIEW_H = 540;
const STEP = 1 / 60;        // 固定逻辑步长（秒）
const GRAVITY = 2600;       // 重力加速度 px/s^2
const MAX_FALL = 1100;      // 最大下落速度
const MOVE_ACCEL = 2800;    // 水平加速度
const MOVE_DECEL = 2400;    // 松开按键时的减速度
const MAX_RUN = 330;        // 最大奔跑速度
const JUMP_VEL = 1020;      // 起跳速度（长按可跳约 4 格高）
const MAX_PARTICLES = 240;  // 粒子上限，防止性能下降
const START_TIME = 300;     // 关卡倒计时（秒）
const START_LIVES = 3;

/* ---------------- 小工具 ---------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
// 轴对齐矩形相交检测
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
// 确定性伪随机（用于背景装饰，避免每帧分配随机数）
function seededRand(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ============================================================
 * SpriteLib —— 图片素材加载器
 * 素材来自 Kenney（CC0，见 assets/CREDITS.txt）。
 * 加载完成前渲染层自动使用程序绘制回退，游戏不会被素材阻塞。
 * ============================================================ */
const SPRITE_MANIFEST = {
  // 玩家（绿色宇航探险者「小绿」）
  player_stand: 'player/p1_stand.png',
  player_jump: 'player/p1_jump.png',
  player_hurt: 'player/p1_hurt.png',
  player_walk: [
    'player/p1_walk01.png', 'player/p1_walk02.png', 'player/p1_walk03.png',
    'player/p1_walk04.png', 'player/p1_walk05.png', 'player/p1_walk06.png',
    'player/p1_walk07.png', 'player/p1_walk08.png', 'player/p1_walk09.png',
    'player/p1_walk10.png', 'player/p1_walk11.png',
  ],
  // 敌人
  slime1: 'enemies/slimeWalk1.png',
  slime2: 'enemies/slimeWalk2.png',
  slime_dead: 'enemies/slimeDead.png',
  snail1: 'enemies/snailWalk1.png',
  snail2: 'enemies/snailWalk2.png',
  snail_shell: 'enemies/snailShell.png',
  blocker: 'enemies/blockerBody.png',
  blocker_mad: 'enemies/blockerMad.png',
  // 瓦片
  grass: 'tiles/grassMid.png',
  dirt: 'tiles/dirtCenter.png',
  stone: 'tiles/stoneCenter.png',
  brick: 'tiles/brickWall.png',
  chest_coin: 'tiles/boxCoin.png',
  chest_item: 'tiles/boxItem.png',
  chest_used: 'tiles/boxEmpty.png',
  float_island: 'tiles/grassHalfMid.png',
  door_mid: 'tiles/door_closedMid.png',
  door_top: 'tiles/door_closedTop.png',
  sign_exit: 'tiles/signExit.png',
  // 道具与装饰
  star: 'items/star.png',
  mushroom: 'items/mushroomRed.png',
  fireball: 'items/fireball.png',
  heart: 'items/heart.png',
  flag: 'items/flagGreen2.png',
  cloud1: 'items/cloud1.png',
  cloud2: 'items/cloud2.png',
  cloud3: 'items/cloud3.png',
  plant: 'items/plant.png',
  bush: 'items/bush.png',
  // 背景
  mountains: 'bg/mountains.png',
};

const SpriteLib = {
  images: {}, // name -> Image 或 Image 数组
  loadedCount: 0,
  failedCount: 0,
  totalCount: 0,
  load(manifest) {
    if (typeof Image === 'undefined') return; // 非浏览器环境（测试桩）
    for (const name in manifest) {
      const entry = manifest[name];
      if (Array.isArray(entry)) {
        this.images[name] = entry.map((p) => this._loadOne(p));
      } else {
        this.images[name] = this._loadOne(entry);
      }
    }
  },
  _loadOne(path) {
    this.totalCount++;
    const img = new Image();
    img.onload = () => this.loadedCount++;
    img.onerror = () => this.failedCount++;
    img.src = 'assets/' + path;
    return img;
  },
  _ok(img) { return img && img.complete && img.naturalWidth > 0; },
  // 取单帧；未加载完成返回 null（调用方走程序绘制回退）
  get(name) {
    const v = this.images[name];
    if (!v) return null;
    if (Array.isArray(v)) return this._ok(v[0]) ? v : null;
    return this._ok(v) ? v : null;
  },
  // 取动画帧
  frame(name, i) {
    const v = this.images[name];
    if (Array.isArray(v)) {
      const img = v[i % v.length];
      return this._ok(img) ? img : null;
    }
    return this.get(name);
  },
};
// 以“底部中心”为锚点按目标高度绘制精灵（保持宽高比），flip 水平翻转
function drawSprite(ctx, img, cx, bottomY, targetH, flip) {
  const w = targetH * (img.naturalWidth / img.naturalHeight);
  ctx.save();
  if (flip) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, bottomY - targetH, w, targetH);
  } else {
    ctx.drawImage(img, cx - w / 2, bottomY - targetH, w, targetH);
  }
  ctx.restore();
}

/* ============================================================
 * AudioManager —— 使用 Web Audio API 合成全部音效
 * 浏览器自动播放限制：首次用户交互后调用 unlock() 才真正启用
 * ============================================================ */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }
  // 首次交互时初始化/恢复 AudioContext
  unlock() {
    if (!this.ctx) {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);
      } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  toggle() { this.enabled = !this.enabled; return this.enabled; }

  // 通用单音：频率可滑动，带指数包络
  tone({ freq = 440, freqEnd = 0, dur = 0.15, type = 'square', vol = 0.18, delay = 0 }) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd > 0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  // 白噪声（用于踩踏、碎砖等打击感音效）
  noise(dur = 0.15, vol = 0.25, delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g); g.connect(this.master);
    src.start(t0);
  }

  jump()    { this.tone({ freq: 260, freqEnd: 660, dur: 0.18, type: 'square', vol: 0.14 }); }
  coin()    { this.tone({ freq: 988, dur: 0.07, vol: 0.14 }); this.tone({ freq: 1319, dur: 0.28, vol: 0.14, delay: 0.07 }); }
  bump()    { this.tone({ freq: 190, freqEnd: 90, dur: 0.12, type: 'triangle', vol: 0.3 }); this.noise(0.07, 0.12); }
  stomp()   { this.noise(0.14, 0.22); this.tone({ freq: 420, freqEnd: 110, dur: 0.14, type: 'sawtooth', vol: 0.16 }); }
  kick()    { this.tone({ freq: 320, freqEnd: 640, dur: 0.1, type: 'square', vol: 0.18 }); }
  hurt()    { this.tone({ freq: 520, freqEnd: 140, dur: 0.32, type: 'sawtooth', vol: 0.2 }); }
  shoot()   { this.tone({ freq: 880, freqEnd: 300, dur: 0.12, type: 'square', vol: 0.11 }); }
  brick()   { this.noise(0.2, 0.28); this.tone({ freq: 220, freqEnd: 60, dur: 0.18, type: 'triangle', vol: 0.2 }); }
  oneUp()   { [660, 830, 990, 1320].forEach((f, i) => this.tone({ freq: f, dur: 0.12, vol: 0.15, delay: i * 0.09 })); }
  powerup() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, dur: 0.11, vol: 0.15, delay: i * 0.07 })); }
  death()   { [660, 550, 440, 330, 220, 110].forEach((f, i) => this.tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.2, delay: i * 0.13 })); }
  clear()   { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.18, vol: 0.16, delay: i * 0.14 })); }
}

/* ============================================================
 * InputManager —— 键盘 + 多点触控统一输入
 * ============================================================ */
class InputManager {
  constructor() {
    this.left = false;
    this.right = false;
    this.jump = false;
    this.fire = false;
    // 边沿触发标记（每帧由 beginFrame 结算一次）
    this._jumpPressedPending = false;
    this._jumpReleasedPending = false;
    this._firePressedPending = false;
    this.jumpPressed = false;
    this.jumpReleased = false;
    this.firePressed = false;
    this.onPause = null;    // 由 Game 注入
    this.onRestart = null;
    this.onAnyInput = null; // 用于解锁音频
  }
  bind() {
    const keyMap = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
      KeyJ: 'fire', KeyK: 'fire',
    };
    window.addEventListener('keydown', (e) => {
      if (this.onAnyInput) this.onAnyInput();
      const k = keyMap[e.code];
      if (k) {
        e.preventDefault();
        if (!this[k] && !e.repeat) {
          if (k === 'jump') this._jumpPressedPending = true;
          else if (k === 'fire') this._firePressedPending = true;
        }
        this[k] = true;
      } else if (e.code === 'KeyP' && !e.repeat) {
        if (this.onPause) this.onPause();
      } else if (e.code === 'KeyR' && !e.repeat) {
        if (this.onRestart) this.onRestart();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = keyMap[e.code];
      if (k) {
        e.preventDefault();
        if (k === 'jump' && this.jump) this._jumpReleasedPending = true;
        this[k] = false;
      }
    });
    // 阻止游戏区域内的页面滚动/缩放手势（菜单面板内允许滚动）
    document.addEventListener('touchmove', (e) => {
      if (!e.target.closest || !e.target.closest('.panel')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }
  // 绑定一个触控按钮到某个输入（支持多点触控，互不影响）
  bindTouchButton(el, name) {
    if (!el) return;
    const press = (e) => {
      e.preventDefault();
      if (this.onAnyInput) this.onAnyInput();
      if (!this[name]) {
        if (name === 'jump') this._jumpPressedPending = true;
        else if (name === 'fire') this._firePressedPending = true;
      }
      this[name] = true;
      el.classList.add('pressed');
    };
    const release = (e) => {
      e.preventDefault();
      if (name === 'jump' && this.jump) this._jumpReleasedPending = true;
      this[name] = false;
      el.classList.remove('pressed');
    };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend', release, { passive: false });
    el.addEventListener('touchcancel', release, { passive: false });
    // 兼容鼠标（桌面调试）
    el.addEventListener('mousedown', press);
    el.addEventListener('mouseup', release);
    el.addEventListener('mouseleave', (e) => { if (this[name]) release(e); });
  }
  // 每个渲染帧调用一次：把事件累积成“边沿”。
  // 注意：边沿只被逻辑步消费（consumeEdges），此处用“或”累积，
  // 避免高刷新率屏幕下某帧没有逻辑步时丢失输入。
  beginFrame() {
    if (this._jumpPressedPending) { this.jumpPressed = true; this._jumpPressedPending = false; }
    if (this._jumpReleasedPending) { this.jumpReleased = true; this._jumpReleasedPending = false; }
    if (this._firePressedPending) { this.firePressed = true; this._firePressedPending = false; }
  }
  // 边沿在第一个逻辑步消费后清除（一帧可能跑多个逻辑步）
  consumeEdges() {
    this.jumpPressed = false;
    this.jumpReleased = false;
    this.firePressed = false;
  }
}

/* ============================================================
 * ParticleSystem —— 对象池粒子 + 飘分文字
 * ============================================================ */
class ParticleSystem {
  constructor() {
    this.pool = [];
    this.texts = [];
  }
  clear() { this.pool.length = 0; this.texts.length = 0; }
  spawn(o) {
    if (this.pool.length >= MAX_PARTICLES) this.pool.shift(); // 超上限时淘汰最旧粒子
    this.pool.push({
      x: o.x, y: o.y,
      vx: o.vx || 0, vy: o.vy || 0,
      g: o.g !== undefined ? o.g : 800,
      life: o.life || 0.6, maxLife: o.life || 0.6,
      size: o.size || 4,
      color: o.color || '#fff',
      shape: o.shape || 'rect', // rect | circle | star | confetti
      spin: o.spin || 0,
      rot: Math.random() * Math.PI * 2,
    });
  }
  // —— 各类特效的封装 ——
  dust(x, y, n = 6) {          // 落地灰尘
    for (let i = 0; i < n; i++) this.spawn({
      x: x + (Math.random() - 0.5) * 26, y: y - 2,
      vx: (Math.random() - 0.5) * 140, vy: -Math.random() * 90,
      g: 300, life: 0.35 + Math.random() * 0.2, size: 3 + Math.random() * 4, color: 'rgba(210,195,170,0.8)', shape: 'circle',
    });
  }
  jumpPuff(x, y) {             // 起跳气尘
    for (let i = 0; i < 5; i++) this.spawn({
      x: x + (Math.random() - 0.5) * 20, y,
      vx: (Math.random() - 0.5) * 100, vy: Math.random() * 40,
      g: -100, life: 0.3, size: 3 + Math.random() * 3, color: 'rgba(255,255,255,0.7)', shape: 'circle',
    });
  }
  sparkle(x, y, color = '#ffd94d', n = 10) { // 收集光点
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawn({ x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160 - 60, g: 250, life: 0.45, size: 3.5, color, shape: 'star', spin: 8 });
    }
  }
  trail(x, y, color) {         // 能量球尾迹
    this.spawn({ x, y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, g: 0, life: 0.25, size: 4, color, shape: 'circle' });
  }
  brickDebris(x, y) {          // 碎砖
    for (let i = 0; i < 8; i++) this.spawn({
      x, y, vx: (Math.random() - 0.5) * 320, vy: -Math.random() * 420 - 100,
      g: 1400, life: 0.8, size: 6 + Math.random() * 5, color: i % 2 ? '#c96b3a' : '#a84f28', spin: 10,
    });
  }
  poof(x, y, color = '#ffffff') { // 敌人消灭烟雾
    for (let i = 0; i < 8; i++) this.spawn({
      x, y, vx: (Math.random() - 0.5) * 220, vy: -Math.random() * 200,
      g: 400, life: 0.4, size: 4 + Math.random() * 4, color, shape: 'circle',
    });
  }
  confetti(x, y, n = 60) {     // 通关彩纸
    const colors = ['#ff5d5d', '#ffd94d', '#5dd6ff', '#7bf0a2', '#ff9df0', '#ffffff'];
    for (let i = 0; i < n; i++) this.spawn({
      x: x + (Math.random() - 0.5) * 500, y: y - Math.random() * 120,
      vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 300 - 60,
      g: 500, life: 1.6 + Math.random(), size: 5 + Math.random() * 5,
      color: colors[i % colors.length], shape: 'confetti', spin: 6 + Math.random() * 8,
    });
  }
  firework(x, y) {             // 通关烟花
    const colors = ['#ffd94d', '#ff7a9d', '#7ad4ff', '#a5f36b'];
    const c = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const sp = 200 + Math.random() * 120;
      this.spawn({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 300, life: 0.9, size: 3.5, color: c, shape: 'star', spin: 6 });
    }
  }
  addText(x, y, text, color = '#ffe37a') { // 向上飘动的分数文字
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }
  update(dt) {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) { this.pool.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y -= 55 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }
  render(ctx, cam) {
    for (const p of this.pool) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const sx = p.x - cam.x, sy = p.y - cam.y;
      if (p.shape === 'circle') {
        ctx.beginPath(); ctx.arc(sx, sy, p.size * a + 0.5, 0, Math.PI * 2); ctx.fill();
      } else if (p.shape === 'star') {
        drawStar(ctx, sx, sy, p.size * a + 1, p.rot);
      } else {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.shape === 'confetti' ? p.size * 0.6 : p.size);
        ctx.restore();
      }
    }
    // 飘分文字
    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "PingFang SC", sans-serif';
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / t.maxLife, 0, 1);
      ctx.fillStyle = t.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeText(t.text, t.x - cam.x, t.y - cam.y);
      ctx.fillText(t.text, t.x - cam.x, t.y - cam.y);
    }
    ctx.globalAlpha = 1;
  }
}
// 画一颗五角星（金币、粒子通用）
function drawStar(ctx, cx, cy, r, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.45;
    const a = rot + (i / 10) * Math.PI * 2;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/* ============================================================
 * Camera —— 平滑跟随 + 边界限制 + 屏幕震动
 * ============================================================ */
class Camera {
  constructor() { this.x = 0; this.y = 0; this.shakeT = 0; this.shakeMag = 0; }
  reset() { this.x = 0; this.y = 0; this.shakeT = 0; }
  shake(mag = 6, dur = 0.25) { this.shakeMag = Math.max(this.shakeMag, mag); this.shakeT = Math.max(this.shakeT, dur); }
  update(dt, target, levelW, levelH) {
    // 目标点：让玩家位于画面偏左 42% 处，垂直方向偏上
    const tx = clamp(target.x + target.w / 2 - VIEW_W * 0.42, 0, Math.max(0, levelW - VIEW_W));
    const ty = clamp(target.y + target.h / 2 - VIEW_H * 0.55, 0, Math.max(0, levelH - VIEW_H));
    const k = 1 - Math.exp(-7 * dt); // 帧率无关的平滑系数
    this.x = lerp(this.x, tx, k);
    this.y = lerp(this.y, ty, k * 0.6);
    if (this.shakeT > 0) this.shakeT -= dt;
  }
  // 渲染用偏移（含震动）
  get ox() { return this.x + (this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0); }
  get oy() { return this.y + (this.shakeT > 0 ? (Math.random() - 0.5) * this.shakeMag : 0); }
}

/* ============================================================
 * 关卡数据 —— 用分段字符串数组定义地图，便于后续扩展新关卡
 * 图例：
 *   '#' 草地地面   'd' 洞穴泥土   'X' 岩石(洞穴顶/边界)
 *   'B' 砖块       '-' 悬浮平台   'T' 机械管道
 *   '?' 宝箱·星币  'm' 宝箱·果实   'f' 宝箱·火焰  's' 宝箱·无敌星
 *   'h' 隐藏宝箱·星币(不可见)      'u' 隐藏宝箱·生命(不可见)
 *   'o' 星币       'G' 终点传送门  'P' 出生点
 *   'e' 巡逻怪·毛菇怪  'k' 甲壳怪·铁壳虫  'j' 跳跃怪·跳跳机
 * ============================================================ */
const SEG_W = 25;
const LEVEL_DATA = {
  name: '1-1 翠星原野',
  // 8 个分段 × 25 列 = 200 列（约 10 倍屏宽），每段 12 行
  segments: [
    // —— 分段0：初始教学区（平地 + 星币 + 第一个宝箱 + 小怪 + 管道）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '          ?              ',
      '     ooo             TT  ',
      '  P      ##       e  TT  ',
      '#########################',
      '#########################',
    ],
    // —— 分段1：普通平台区（砖块连排 + 果实宝箱 + 浅坑 + 巡逻怪）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '               oo        ',
      '                         ',
      '    B?BmB      --        ',
      '                         ',
      '            e       e    ',
      '###############  ########',
      '#########################',
    ],
    // —— 分段2：连续跳跃区（深渊上的悬浮平台三连跳）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '            o            ',
      '       oo      oo        ',
      '           --            ',
      '       --      --        ',
      '                         ',
      '                         ',
      '#####               #####',
      '#####               #####',
    ],
    // —— 分段3：高低落差区（垂直移动平台 + 高台甲壳怪）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '          oo             ',
      '                         ',
      '                    k    ',
      '               ##########',
      '               ##########',
      '#######        ##########',
      '#######        ##########',
    ],
    // —— 分段4：地下洞穴区（岩石封顶 + 火焰宝箱 + 隐藏生命 + 甲壳怪）——
    [
      'XXXXXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXXXXX',
      '                         ',
      '                         ',
      '                         ',
      '     f      ?      u     ',
      ' TT                      ',
      ' TT     k       k        ',
      'ddddddddddddddddddddddddd',
      'ddddddddddddddddddddddddd',
    ],
    // —— 分段5：出洞区（水平移动平台横跨深坑）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '           ooo           ',
      '    ?                    ',
      '                         ',
      '       k            e    ',
      '##########     ##########',
      '##########     ##########',
    ],
    // —— 分段6：阶梯爬升区（无敌星宝箱 + 跳跳怪 + 果实宝箱）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '     o       o      o    ',
      '            s            ',
      '                     m   ',
      '       j  #####          ',
      '     ##########  j       ',
      '#########################',
      '#########################',
    ],
    // —— 分段7：终点冲刺区（小怪阻拦 + 阶梯 + 传送门）——
    [
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '                         ',
      '   ooo                   ',
      '                #        ',
      '               ##        ',
      '     e    j   ###  G     ',
      '#########################',
      '#########################',
    ],
  ],
  // 移动平台（单位：瓦片；range 为往返行程，speed 为瓦片/秒）
  movingPlatforms: [
    { tx: 85, ty: 6, tw: 2, axis: 'y', range: 3, speed: 1.6 }, // 分段3 垂直升降
    { tx: 135, ty: 9, tw: 2, axis: 'x', range: 3, speed: 2.2 }, // 分段5 横跨深坑
  ],
  cave: { fromCol: 100, toCol: 125 }, // 洞穴区间（用于背景变暗）
};

/* ============================================================
 * MovingPlatform —— 往返移动平台（可载人）
 * ============================================================ */
class MovingPlatform {
  constructor(d) {
    this.baseX = d.tx * TILE;
    this.baseY = d.ty * TILE;
    this.w = d.tw * TILE;
    this.h = 16;
    this.axis = d.axis;
    this.range = d.range * TILE;
    this.speed = d.speed * TILE;
    this.p = 0; this.dir = 1;
    this.x = this.baseX; this.y = this.baseY;
    this.dx = 0; this.dy = 0; // 本帧位移（用于载人）
  }
  update(dt) {
    this.p += this.dir * this.speed * dt;
    if (this.p >= this.range) { this.p = this.range; this.dir = -1; }
    else if (this.p <= 0) { this.p = 0; this.dir = 1; }
    const nx = this.baseX + (this.axis === 'x' ? this.p : 0);
    const ny = this.baseY + (this.axis === 'y' ? this.p : 0);
    this.dx = nx - this.x; this.dy = ny - this.y;
    this.x = nx; this.y = ny;
  }
}

/* ============================================================
 * Level —— 解析地图数据，管理瓦片、宝箱、星币、敌人出生点
 * ============================================================ */
class Level {
  constructor(data) {
    this.name = data.name;
    // 横向拼接各分段，组成完整地图
    const rowCount = data.segments[0].length;
    this.rows = [];
    for (let r = 0; r < rowCount; r++) {
      let row = '';
      for (const seg of data.segments) row += seg[r];
      this.rows.push(row.split(''));
    }
    this.rowCount = rowCount;
    this.colCount = this.rows[0].length;
    this.pixelW = this.colCount * TILE;
    this.pixelH = this.rowCount * TILE;
    this.cave = data.cave;
    this.chests = new Map();   // "col,row" -> 宝箱状态
    this.coins = [];
    this.spawns = [];
    this.bumpAnims = [];       // 方块被顶后的抖动动画
    this.goal = null;
    this.playerSpawn = { x: TILE * 2, y: TILE * 9 };
    this.movingPlatforms = data.movingPlatforms.map((p) => new MovingPlatform(p));

    // 逐格解析标记
    for (let r = 0; r < this.rowCount; r++) {
      for (let c = 0; c < this.colCount; c++) {
        const ch = this.rows[r][c];
        if (ch === 'P') {
          this.playerSpawn = { x: c * TILE + (TILE - 30) / 2, y: (r + 1) * TILE - 42 };
          this.rows[r][c] = ' ';
        } else if (ch === '?' || ch === 'm' || ch === 'f' || ch === 's') {
          this.chests.set(c + ',' + r, { col: c, row: r, content: ch, hidden: false, used: false });
        } else if (ch === 'h' || ch === 'u') {
          this.chests.set(c + ',' + r, { col: c, row: r, content: ch === 'h' ? '?' : 'u', hidden: true, used: false });
        } else if (ch === 'o') {
          this.coins.push({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, taken: false });
          this.rows[r][c] = ' ';
        } else if (ch === 'e' || ch === 'k' || ch === 'j') {
          this.spawns.push({ type: ch, x: c * TILE + 6, y: r * TILE, spawned: false });
          this.rows[r][c] = ' ';
        } else if (ch === 'G') {
          this.goal = { x: c * TILE, y: (r - 1) * TILE, w: TILE, h: TILE * 2 };
          this.rows[r][c] = ' ';
        }
      }
    }
  }

  tileChar(col, row) {
    if (row < 0 || row >= this.rowCount) return ' ';
    if (col < 0 || col >= this.colCount) return 'X'; // 左右边界视为岩壁
    return this.rows[row][col];
  }
  isSolidChar(ch) {
    return ch === '#' || ch === 'd' || ch === 'X' || ch === 'B' || ch === 'T' ||
           ch === '-' || ch === 'v' || ch === '?' || ch === 'm' || ch === 'f' || ch === 's';
  }
  isSolid(col, row) { return this.isSolidChar(this.tileChar(col, row)); }
  // 向上顶时的判定：隐藏宝箱此时也视为实体
  isSolidUp(col, row) {
    const ch = this.tileChar(col, row);
    return this.isSolidChar(ch) || ch === 'h' || ch === 'u';
  }
  chestAt(col, row) { return this.chests.get(col + ',' + row); }

  // 玩家从下方顶击某个方块
  bumpTile(col, row, game) {
    const chest = this.chestAt(col, row);
    if (chest && !chest.used) {
      chest.used = true;
      chest.hidden = false;
      this.rows[row][col] = 'v'; // 变成已用方块
      this.bumpAnims.push({ col, row, t: 0.22 });
      game.audio.bump();
      game.camera.shake(3, 0.12);
      game.spawnChestContent(chest);
    } else if (this.tileChar(col, row) === 'B') {
      if (game.player && game.player.power > 0) {
        // 变大后可以顶碎砖块
        this.rows[row][col] = ' ';
        game.audio.brick();
        game.particles.brickDebris(col * TILE + TILE / 2, row * TILE + TILE / 2);
        game.addScore(col * TILE + TILE / 2, row * TILE, 50);
        game.camera.shake(4, 0.15);
      } else {
        this.bumpAnims.push({ col, row, t: 0.22 });
        game.audio.bump();
      }
    }
  }

  update(dt) {
    for (const mp of this.movingPlatforms) mp.update(dt);
    for (let i = this.bumpAnims.length - 1; i >= 0; i--) {
      this.bumpAnims[i].t -= dt;
      if (this.bumpAnims[i].t <= 0) this.bumpAnims.splice(i, 1);
    }
  }
  // 查询某格的抖动偏移（渲染用）
  bumpOffset(col, row) {
    for (const b of this.bumpAnims) {
      if (b.col === col && b.row === row) return -Math.sin((1 - b.t / 0.22) * Math.PI) * 10;
    }
    return 0;
  }
}

/* ============================================================
 * Player —— 红帽探险者「小星」
 * 状态：power 0 小个子 / 1 大个子(果实) / 2 火焰形态
 * ============================================================ */
const PLAYER_W = 30;
const PLAYER_SMALL_H = 42;
const PLAYER_BIG_H = 58;

class Player {
  constructor(spawn) {
    this.x = spawn.x; this.y = spawn.y;
    this.w = PLAYER_W; this.h = PLAYER_SMALL_H;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.coyote = 0;        // 土狼时间：离开边缘后短暂可跳
    this.jumpBuffer = 0;    // 跳跃缓冲：提前按跳也能起跳
    this.power = 0;
    this.invulnT = 0;       // 受伤后的无敌闪烁时间
    this.starT = 0;         // 无敌星时间
    this.dead = false;
    this.deathT = 0;
    this.squashT = 0;       // 落地压缩动画
    this.animT = 0;         // 跑步动画计时
    this.shootCD = 0;
    this.won = false;
  }

  setPower(p, game) {
    if (p === this.power) return;
    const oldH = this.h;
    this.power = p;
    this.h = p > 0 ? PLAYER_BIG_H : PLAYER_SMALL_H;
    this.y -= (this.h - oldH); // 长高时脚底不动
  }

  hurt(game) {
    if (this.invulnT > 0 || this.starT > 0 || this.dead || this.won) return;
    game.audio.hurt();
    game.camera.shake(7, 0.3);
    if (this.power === 2) { this.setPower(1, game); this.invulnT = 1.6; }
    else if (this.power === 1) { this.setPower(0, game); this.invulnT = 1.6; }
    else this.die(game);
  }

  die(game) {
    if (this.dead) return;
    this.dead = true;
    this.deathT = 0;
    this.vy = -760; // 死亡时向上弹起再掉落
    game.audio.death();
  }

  shoot(game) {
    if (this.power !== 2 || this.shootCD > 0 || this.dead || this.won) return;
    if (game.balls.length >= 2) return; // 场上最多两颗能量球
    this.shootCD = 0.28;
    game.balls.push(new EnergyBall(this.x + this.w / 2 + this.facing * 22, this.y + this.h * 0.45, this.facing));
    game.audio.shoot();
  }

  update(dt, game) {
    // —— 死亡动画：向上弹起后坠落，不做碰撞 ——
    if (this.dead) {
      this.deathT += dt;
      this.vy += GRAVITY * 0.6 * dt;
      this.y += this.vy * dt;
      if (this.deathT > 2.4 || this.y > game.level.pixelH + 300) game.onPlayerDeathFinished();
      return;
    }
    if (this.won) { this.vx = 0; return; } // 通关后定住

    const input = game.input;
    // —— 水平移动：加速 / 减速 ——
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      this.vx += MOVE_ACCEL * dir * dt;
      this.facing = dir;
    } else {
      // 松开方向键：减速到零即停
      const s = Math.sign(this.vx);
      if (s !== 0) {
        this.vx -= MOVE_DECEL * s * dt;
        if (Math.sign(this.vx) !== s) this.vx = 0;
      }
    }
    this.vx = clamp(this.vx, -MAX_RUN, MAX_RUN);

    // —— 跳跃：缓冲 + 土狼时间 ——
    if (input.jumpPressed) this.jumpBuffer = 0.12; else this.jumpBuffer -= dt;
    if (this.onGround) this.coyote = 0.1; else this.coyote -= dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.vy = -JUMP_VEL;
      this.jumpBuffer = 0; this.coyote = 0; this.onGround = false;
      game.audio.jump();
      game.particles.jumpPuff(this.x + this.w / 2, this.y + this.h);
    }
    // 可变跳高：提前松开跳跃键则截断上升（短按小跳，长按高跳）
    if (input.jumpReleased && this.vy < 0) this.vy *= 0.45;

    // —— 重力 ——
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    this.moveX(dt, game);
    this.moveY(dt, game);
    this.collidePlatforms(dt, game);

    // —— 动画与计时器 ——
    if (this.onGround && Math.abs(this.vx) > 20) this.animT += dt * (0.8 + Math.abs(this.vx) / MAX_RUN);
    if (this.squashT > 0) this.squashT -= dt;
    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.starT > 0) this.starT -= dt;
    if (this.shootCD > 0) this.shootCD -= dt;
    // 发射能量球
    if (input.firePressed) this.shoot(game);
  }

  // 水平移动 + 墙体碰撞
  moveX(dt, game) {
    this.x += this.vx * dt;
    const level = game.level;
    const r0 = Math.floor((this.y + 2) / TILE);
    const r1 = Math.floor((this.y + this.h - 2) / TILE);
    if (this.vx > 0) {
      const c = Math.floor((this.x + this.w) / TILE);
      for (let r = r0; r <= r1; r++) {
        if (level.isSolid(c, r)) { this.x = c * TILE - this.w - 0.01; this.vx = 0; break; }
      }
    } else if (this.vx < 0) {
      const c = Math.floor(this.x / TILE);
      for (let r = r0; r <= r1; r++) {
        if (level.isSolid(c, r)) { this.x = (c + 1) * TILE + 0.01; this.vx = 0; break; }
      }
    }
  }

  // 垂直移动 + 地面/头顶碰撞（顶宝箱在此触发）
  moveY(dt, game) {
    const wasGround = this.onGround;
    const impact = this.vy;
    this.y += this.vy * dt;
    this.onGround = false;
    const level = game.level;
    const c0 = Math.floor((this.x + 3) / TILE);
    const c1 = Math.floor((this.x + this.w - 3) / TILE);
    if (this.vy >= 0) {
      const r = Math.floor((this.y + this.h) / TILE);
      for (let c = c0; c <= c1; c++) {
        if (level.isSolid(c, r)) {
          this.y = r * TILE - this.h;
          this.vy = 0;
          this.onGround = true;
          if (!wasGround) this.land(game, impact);
          break;
        }
      }
    } else {
      const r = Math.floor(this.y / TILE);
      for (let c = c0; c <= c1; c++) {
        if (level.isSolidUp(c, r)) {
          this.y = (r + 1) * TILE + 0.01;
          this.vy = 0;
          level.bumpTile(c, r, game); // 顶击宝箱 / 砖块
          break;
        }
      }
    }
  }

  // 移动平台碰撞（可站在上面被载着走）
  collidePlatforms(dt, game) {
    for (const mp of game.level.movingPlatforms) {
      if (!rectsOverlap(this, mp)) continue;
      const feetPen = (this.y + this.h) - mp.y;
      if (this.vy >= 0 && feetPen < 18) {
        // 落在平台顶面
        this.y = mp.y - this.h;
        this.vy = 0;
        this.onGround = true;
        this.x += mp.dx; // 平台载人
        this.y += mp.dy;
      } else if (this.vy < 0 && (mp.y + mp.h) - this.y < 14) {
        this.y = mp.y + mp.h + 0.01;
        this.vy = 0;
      } else {
        // 侧向推出，防止卡进平台
        if (this.x + this.w / 2 < mp.x + mp.w / 2) this.x = mp.x - this.w - 0.01;
        else this.x = mp.x + mp.w + 0.01;
      }
    }
  }

  // 落地反馈：压缩动画 + 灰尘粒子
  land(game, impact) {
    this.squashT = 0.12;
    if (impact > 420) {
      game.particles.dust(this.x + this.w / 2, this.y + this.h, impact > 800 ? 10 : 6);
    }
  }

  /* ---------------- 绘制 ---------------- */
  render(ctx, cam, time) {
    const cx = this.x - cam.x + this.w / 2;
    const by = this.y - cam.y + this.h;
    ctx.save();
    ctx.translate(cx, by);
    if (this.facing < 0) ctx.scale(-1, 1);

    // 落地压缩 / 恢复
    let sx = 1, sy = 1;
    if (this.squashT > 0) {
      const t = this.squashT / 0.12;
      sy = 1 - 0.22 * t; sx = 1 + 0.22 * t;
    }
    const S = this.power > 0 ? 1.34 : 1; // 变大形态
    ctx.scale(sx * S, sy * S);

    // 受伤无敌闪烁
    if (this.invulnT > 0 && Math.floor(time * 18) % 2 === 0) ctx.globalAlpha = 0.3;
    // 无敌星彩虹光晕
    if (this.starT > 0) {
      ctx.shadowColor = 'hsl(' + Math.floor((time * 400) % 360) + ', 95%, 60%)';
      ctx.shadowBlur = 18;
    }

    const runK = clamp(Math.abs(this.vx) / MAX_RUN, 0, 1);
    const swing = this.onGround ? Math.sin(this.animT * 16) * 5 * runK : 4;
    const fire = this.power === 2;

    // —— 素材贴图优先（小绿：站立/行走动画/跳跃/受伤）——
    let pimg = null;
    if (this.dead || this.invulnT > 0) pimg = SpriteLib.get('player_hurt');
    else if (!this.onGround) pimg = SpriteLib.get('player_jump');
    else if (Math.abs(this.vx) > 20) pimg = SpriteLib.frame('player_walk', Math.floor(this.animT * 12));
    else pimg = SpriteLib.get('player_stand');
    if (pimg) {
      drawSprite(ctx, pimg, 0, 2, 46, false); // 朝向翻转已在上方 ctx.scale 处理
      if (fire) {
        // 火焰形态：头顶悬浮能量球标记
        const fimg = SpriteLib.get('fireball');
        if (fimg) ctx.drawImage(fimg, 8, -70 + Math.sin(time * 6) * 3, 18, 18);
      }
      ctx.restore();
      return;
    }

    // —— 靴子（深棕）——
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(-12 + swing * 0.6, -7, 10, 7);
    ctx.fillRect(2 - swing * 0.6, -7, 10, 7);
    // —— 腿（卡其裤）——
    ctx.fillStyle = '#c8a05a';
    ctx.fillRect(-11 + swing, -20, 8, 14);
    ctx.fillRect(3 - swing, -20, 8, 14);
    // —— 身体：探险外套（火焰形态变红）——
    ctx.fillStyle = fire ? '#e0483a' : '#2fa7a0';
    roundRect(ctx, -13, -38, 26, 20, 5);
    ctx.fill();
    // 腰带
    ctx.fillStyle = '#37414f';
    ctx.fillRect(-13, -22, 26, 4);
    // —— 手臂（摆臂）——
    ctx.fillStyle = fire ? '#c93a2e' : '#268a84';
    ctx.fillRect(-17, -36 + swing * 0.5, 5, 13);
    ctx.fillRect(12, -36 - swing * 0.5, 5, 13);
    // —— 围巾（原创标志物，向后飘动）——
    const scarfWave = Math.sin(time * 9) * 3 - runK * 6;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.moveTo(-4, -38);
    ctx.quadraticCurveTo(-16, -40 + scarfWave, -24 - runK * 8, -34 + scarfWave);
    ctx.quadraticCurveTo(-16, -32 + scarfWave, -4, -32);
    ctx.closePath();
    ctx.fill();
    // —— 头 ——
    ctx.fillStyle = '#ffcf9e';
    ctx.beginPath(); ctx.arc(1, -46, 9.5, 0, Math.PI * 2); ctx.fill();
    // 眼睛
    ctx.fillStyle = '#23262e';
    ctx.fillRect(5, -49, 2.6, 4);
    // —— 红色探险帽（宽檐 + 金色星徽，原创造型）——
    ctx.fillStyle = '#e0392e';
    ctx.beginPath(); ctx.ellipse(0, -52, 14, 4.2, 0, 0, Math.PI * 2); ctx.fill(); // 帽檐
    ctx.beginPath(); ctx.arc(-1, -53, 9, Math.PI, 0); ctx.fill();                 // 帽顶
    ctx.fillStyle = '#a8241c';
    ctx.fillRect(-10, -55, 18, 3);                                                // 帽带
    ctx.fillStyle = '#ffd94d';
    drawStar(ctx, 6, -58, 4);                                                     // 金色星徽
    ctx.restore();
  }
}
// 圆角矩形辅助
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ============================================================
 * Enemy 基类 —— 通用重力与瓦片碰撞
 * ============================================================ */
class Enemy {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 36; this.h = 34;
    this.vx = 0; this.vy = 0;
    this.facing = -1;
    this.onGround = false;
    this.dead = false;       // 被踩中（播放压扁动画）
    this.removeMe = false;
    this.squashT = 0;
    this.animT = Math.random() * 10;
    this.score = 100;
  }
  physics(dt, level) {
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;
    // 水平
    this.x += this.vx * dt;
    const r0 = Math.floor((this.y + 3) / TILE);
    const r1 = Math.floor((this.y + this.h - 3) / TILE);
    if (this.vx > 0) {
      const c = Math.floor((this.x + this.w) / TILE);
      for (let r = r0; r <= r1; r++) if (level.isSolid(c, r)) { this.x = c * TILE - this.w - 0.01; this.hitWall(); break; }
    } else if (this.vx < 0) {
      const c = Math.floor(this.x / TILE);
      for (let r = r0; r <= r1; r++) if (level.isSolid(c, r)) { this.x = (c + 1) * TILE + 0.01; this.hitWall(); break; }
    }
    // 垂直
    this.y += this.vy * dt;
    this.onGround = false;
    const c0 = Math.floor((this.x + 3) / TILE);
    const c1 = Math.floor((this.x + this.w - 3) / TILE);
    if (this.vy >= 0) {
      const r = Math.floor((this.y + this.h) / TILE);
      for (let c = c0; c <= c1; c++) if (level.isSolid(c, r)) { this.y = r * TILE - this.h; this.vy = 0; this.onGround = true; break; }
    } else {
      const r = Math.floor(this.y / TILE);
      for (let c = c0; c <= c1; c++) if (level.isSolid(c, r)) { this.y = (r + 1) * TILE + 0.01; this.vy = 0; break; }
    }
  }
  hitWall() { this.vx = -this.vx; this.facing = -this.facing; }
  // 前方脚下是否还有地面（用于巡逻怪在平台边缘转向）
  edgeAhead(level) {
    const aheadX = this.vx > 0 ? this.x + this.w + 3 : this.x - 3;
    const c = Math.floor(aheadX / TILE);
    const r = Math.floor((this.y + this.h + 6) / TILE);
    return level.isSolid(c, r);
  }
  // 被玩家踩中
  stomped(game) {
    this.dead = true;
    this.squashT = 0.35;
    game.audio.stomp();
    game.addScore(this.x + this.w / 2, this.y, this.score);
  }
  updateSquash(dt) {
    if (this.squashT > 0) {
      this.squashT -= dt;
      if (this.squashT <= 0) this.removeMe = true;
      return true;
    }
    return false;
  }
}

/* ---------------- 巡逻怪·毛菇怪 ----------------
 * 在平台上左右移动，遇墙或平台边缘转向，可被踩扁 */
class Grumbler extends Enemy {
  constructor(x, y) {
    super(x, y);
    this.vx = -55;
    this.score = 100;
  }
  update(dt, game) {
    if (this.updateSquash(dt)) return;
    this.animT += dt;
    if (this.onGround && !this.edgeAhead(game.level)) this.hitWall(); // 平台边缘转向
    this.physics(dt, game.level);
    if (this.y > game.level.pixelH + 100) this.removeMe = true;
  }
  render(ctx, cam, time) {
    const cx = this.x - cam.x + this.w / 2;
    const by = this.y - cam.y + this.h;
    // —— 素材贴图：粉色史莱姆（被踩用压扁帧）——
    const simg = this.squashT > 0
      ? SpriteLib.get('slime_dead')
      : (Math.floor(this.animT * 6) % 2 === 0 ? SpriteLib.get('slime1') : SpriteLib.get('slime2'));
    if (simg) { drawSprite(ctx, simg, cx, by, 36, this.facing > 0); return; }
    ctx.save();
    ctx.translate(cx, by);
    if (this.squashT > 0) ctx.scale(1.25, 0.3); // 压扁动画
    const step = Math.sin(this.animT * 12) * 3;
    // 脚
    ctx.fillStyle = '#4a2f52';
    ctx.fillRect(-13 + step, -6, 10, 6);
    ctx.fillRect(3 - step, -6, 10, 6);
    // 身体（紫色绒毛球）
    ctx.fillStyle = '#8e5ba8';
    ctx.beginPath(); ctx.arc(0, -18, 16, 0, Math.PI * 2); ctx.fill();
    // 头顶圆斑菌帽（原创造型：圆顶小帽 + 三点斑）
    ctx.fillStyle = '#c78fde';
    ctx.beginPath(); ctx.arc(0, -26, 12, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f3e2ff';
    ctx.beginPath(); ctx.arc(-5, -29, 2, 0, Math.PI * 2); ctx.arc(4, -31, 2.4, 0, Math.PI * 2); ctx.fill();
    // 眼睛（凶萌）
    ctx.fillStyle = '#fff';
    ctx.fillRect(-8, -22, 6, 6); ctx.fillRect(3, -22, 6, 6);
    ctx.fillStyle = '#23262e';
    ctx.fillRect(-6 + this.facing * 2, -20, 3, 3); ctx.fillRect(5 + this.facing * 2, -20, 3, 3);
    ctx.restore();
  }
}

/* ---------------- 甲壳怪·铁壳虫 ----------------
 * 一踩缩壳 -> 再碰踢出高速滑动（可撞死其他敌人），壳静置过久会复苏 */
class Shellbug extends Enemy {
  constructor(x, y) {
    super(x, y);
    this.vx = -45;
    this.state = 'walk'; // walk | shell | slide
    this.shellT = 0;
    this.score = 150;
  }
  kick(dir, game) {
    this.state = 'slide';
    this.vx = dir * 430;
    this.facing = dir;
    game.audio.kick();
  }
  stomped(game) {
    if (this.state === 'walk') {
      // 第一次被踩：缩进壳里
      this.state = 'shell';
      this.vx = 0;
      this.shellT = 8;
      game.audio.stomp();
      game.addScore(this.x + this.w / 2, this.y, this.score);
    } else if (this.state === 'slide') {
      // 滑动中被踩：停下变回静置壳
      this.state = 'shell';
      this.vx = 0;
      this.shellT = 8;
      game.audio.stomp();
    }
    // 静置壳被踩不处理（由碰撞逻辑踢出）
  }
  update(dt, game) {
    this.animT += dt;
    if (this.state === 'shell') {
      this.shellT -= dt;
      if (this.shellT <= 0) { this.state = 'walk'; this.vx = this.facing * 45; } // 复苏
    }
    if (this.state !== 'shell') {
      if (this.state === 'walk' && this.onGround && !this.edgeAhead(game.level)) this.hitWall();
      this.physics(dt, game.level);
    } else {
      this.physics(dt, game.level); // 壳也受重力
    }
    if (this.y > game.level.pixelH + 100) this.removeMe = true;
  }
  render(ctx, cam, time) {
    const cx = this.x - cam.x + this.w / 2;
    const by = this.y - cam.y + this.h;
    // —— 素材贴图：蜗牛（行走/缩壳/滑壳）——
    let nimg = null;
    if (this.state === 'walk') {
      nimg = Math.floor(this.animT * 5) % 2 === 0 ? SpriteLib.get('snail1') : SpriteLib.get('snail2');
    } else {
      nimg = SpriteLib.get('snail_shell');
    }
    if (nimg) {
      ctx.save();
      ctx.translate(cx, by);
      if (this.state === 'shell' && this.shellT < 2) ctx.rotate(Math.sin(time * 25) * 0.12); // 复苏前摇晃
      drawSprite(ctx, nimg, 0, 0, this.state === 'walk' ? 36 : 28, this.facing > 0);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(cx, by);
    const shell = this.state !== 'walk';
    if (!shell) {
      const step = Math.sin(this.animT * 10) * 3;
      // 脚与头（行走状态伸出）
      ctx.fillStyle = '#3f6d46';
      ctx.fillRect(-14 + step, -6, 9, 6);
      ctx.fillRect(5 - step, -6, 9, 6);
      ctx.fillStyle = '#79c489';
      ctx.beginPath(); ctx.arc(this.facing * 16, -14, 7, 0, Math.PI * 2); ctx.fill(); // 头
      ctx.fillStyle = '#23262e';
      ctx.fillRect(this.facing * 18, -16, 3, 3);
    } else if (this.state === 'shell' && this.shellT < 2) {
      // 即将复苏：壳左右摇晃
      ctx.rotate(Math.sin(time * 25) * 0.12);
    }
    // 金属壳（青蓝色穹顶 + 铆钉）
    ctx.fillStyle = this.state === 'slide' ? '#4fb7d9' : '#3d8fb0';
    ctx.beginPath(); ctx.arc(0, -6, 17, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#2b6d88';
    ctx.fillRect(-17, -8, 34, 5);
    ctx.fillStyle = '#bfe9f5';
    ctx.beginPath();
    ctx.arc(-9, -14, 2.2, 0, Math.PI * 2);
    ctx.arc(0, -18, 2.2, 0, Math.PI * 2);
    ctx.arc(9, -14, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ---------------- 跳跃怪·跳跳机 ----------------
 * 周期性弹跳，并尝试朝玩家方向接近 */
class Bouncebot extends Enemy {
  constructor(x, y) {
    super(x, y);
    this.hopT = 0.6 + Math.random() * 0.5;
    this.score = 200;
  }
  update(dt, game) {
    if (this.updateSquash(dt)) return;
    this.animT += dt;
    if (this.onGround) {
      this.vx *= 0.8; // 落地减速
      this.hopT -= dt;
      if (this.hopT <= 0) {
        this.hopT = 1.15;
        this.vy = -640;
        // 朝玩家方向跳
        const p = game.player;
        if (p && Math.abs(p.x - this.x) < 420) {
          this.facing = p.x > this.x ? 1 : -1;
          this.vx = this.facing * 115;
        } else {
          this.vx = this.facing * 60;
        }
      }
    }
    this.physics(dt, game.level);
    if (this.y > game.level.pixelH + 100) this.removeMe = true;
  }
  render(ctx, cam, time) {
    const cx = this.x - cam.x + this.w / 2;
    const by = this.y - cam.y + this.h;
    // —— 素材贴图：方块怪（地面常态 / 腾空怒脸）——
    const bimg = SpriteLib.get(this.onGround ? 'blocker' : 'blocker_mad');
    if (bimg) {
      ctx.save();
      ctx.translate(cx, by);
      if (this.squashT > 0) ctx.scale(1.3, 0.3);
      drawSprite(ctx, bimg, 0, 0, 40, false);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(cx, by);
    if (this.squashT > 0) ctx.scale(1.3, 0.3);
    // 弹簧腿
    const springH = this.onGround ? 6 + Math.sin(this.animT * 20) * 1.5 : 12;
    ctx.strokeStyle = '#8d99ae';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, 0); ctx.lineTo(0, -springH); ctx.lineTo(5, 0);
    ctx.stroke();
    // 机身（橙黄小机器人）
    ctx.fillStyle = '#f2a541';
    roundRect(ctx, -13, -springH - 20, 26, 20, 5); ctx.fill();
    // 单眼
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(this.facing * 3, -springH - 11, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#23262e';
    ctx.beginPath(); ctx.arc(this.facing * 5, -springH - 11, 2.4, 0, Math.PI * 2); ctx.fill();
    // 天线
    ctx.strokeStyle = '#8d99ae';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -springH - 20); ctx.lineTo(0, -springH - 27); ctx.stroke();
    ctx.fillStyle = '#ff5d5d';
    ctx.beginPath(); ctx.arc(0, -springH - 29, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
 * Item —— 宝箱弹出的道具（含升起动画）
 * type: coinPop(弹出星币动画) / fruit / fire / star / life
 * ============================================================ */
class Item {
  constructor(col, row, type) {
    this.type = type;
    this.w = 30; this.h = 30;
    this.x = col * TILE + (TILE - this.w) / 2;
    this.y = row * TILE;                 // 从方块位置升起
    this.startY = row * TILE;
    this.riseTotal = type === 'coinPop' ? 0.45 : 0.55;
    this.riseT = this.riseTotal;
    this.vx = 0; this.vy = 0;
    this.active = false;                 // 升起动画结束后才参与物理
    this.removeMe = false;
    this.animT = Math.random() * 5;
  }
  applyBehavior() {
    if (this.type === 'fruit') this.vx = 70;
    else if (this.type === 'star') this.vx = 130;
    else if (this.type === 'life') this.vx = 95;
    // fire（火焰晶体）静止不动
  }
  update(dt, game) {
    this.animT += dt;
    // —— 向上升起动画 ——
    if (this.riseT > 0) {
      this.riseT -= dt;
      const k = 1 - this.riseT / this.riseTotal;
      this.y = this.startY - k * (TILE + 6);
      if (this.riseT <= 0) {
        if (this.type === 'coinPop') { this.removeMe = true; return; }
        this.active = true;
        this.applyBehavior();
      }
      return;
    }
    if (!this.active) return;
    // —— 简单物理：重力 + 撞墙转向 + 无敌星弹跳 ——
    this.vy += GRAVITY * dt;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;
    const level = game.level;
    this.x += this.vx * dt;
    const r0 = Math.floor((this.y + 3) / TILE), r1 = Math.floor((this.y + this.h - 3) / TILE);
    if (this.vx > 0) {
      const c = Math.floor((this.x + this.w) / TILE);
      for (let r = r0; r <= r1; r++) if (level.isSolid(c, r)) { this.x = c * TILE - this.w - 0.01; this.vx = -this.vx; break; }
    } else if (this.vx < 0) {
      const c = Math.floor(this.x / TILE);
      for (let r = r0; r <= r1; r++) if (level.isSolid(c, r)) { this.x = (c + 1) * TILE + 0.01; this.vx = -this.vx; break; }
    }
    this.y += this.vy * dt;
    const c0 = Math.floor((this.x + 3) / TILE), c1 = Math.floor((this.x + this.w - 3) / TILE);
    if (this.vy >= 0) {
      const r = Math.floor((this.y + this.h) / TILE);
      for (let c = c0; c <= c1; c++) {
        if (level.isSolid(c, r)) {
          this.y = r * TILE - this.h;
          this.vy = this.type === 'star' ? -430 : 0; // 无敌星会弹跳
          break;
        }
      }
    } else {
      const r = Math.floor(this.y / TILE);
      for (let c = c0; c <= c1; c++) if (level.isSolid(c, r)) { this.y = (r + 1) * TILE + 0.01; this.vy = 0; break; }
    }
    if (this.y > level.pixelH + 100) this.removeMe = true;
  }
  // 玩家吃到道具
  collect(game) {
    const p = game.player;
    const cx = this.x + this.w / 2, cy = this.y + this.h / 2;
    if (this.type === 'fruit') {
      p.setPower(1, game);
      game.addScore(cx, cy, 200);
      game.particles.sparkle(cx, cy, '#ffab4d');
      game.audio.powerup();
    } else if (this.type === 'fire') {
      p.setPower(2, game);
      game.addScore(cx, cy, 300);
      game.particles.sparkle(cx, cy, '#ff6d5a');
      game.audio.powerup();
    } else if (this.type === 'star') {
      p.starT = 8;
      game.addScore(cx, cy, 300);
      game.particles.sparkle(cx, cy, '#ffe37a');
      game.audio.powerup();
    } else if (this.type === 'life') {
      game.lives++;
      game.particles.addText(cx, cy, '+1UP', '#7bf0a2');
      game.particles.sparkle(cx, cy, '#7bf0a2');
      game.audio.oneUp();
    }
    this.removeMe = true;
  }
  render(ctx, cam, time) {
    const cx = this.x - cam.x + this.w / 2;
    const cy = this.y - cam.y + this.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    const bob = Math.sin(this.animT * 5) * 2;
    // —— 素材贴图优先 ——
    let iimg = null;
    if (this.type === 'fruit') iimg = SpriteLib.get('mushroom');
    else if (this.type === 'fire') iimg = SpriteLib.get('fireball');
    else if (this.type === 'star') iimg = SpriteLib.get('star');
    else if (this.type === 'life') iimg = SpriteLib.get('heart');
    else if (this.type === 'coinPop') iimg = SpriteLib.get('star');
    if (iimg) {
      if (this.type === 'coinPop') {
        ctx.scale(Math.abs(Math.cos(this.animT * 9)) * 0.9 + 0.1, 1);
        ctx.shadowColor = '#ffd94d'; ctx.shadowBlur = 10;
        ctx.drawImage(iimg, -13, -13, 26, 26);
      } else {
        ctx.translate(0, bob);
        if (this.type === 'star') { ctx.shadowColor = '#ffe37a'; ctx.shadowBlur = 16; }
        else if (this.type === 'heart') { ctx.shadowColor = '#ff8aa0'; ctx.shadowBlur = 12; }
        const h = this.type === 'star' ? 34 : 30;
        ctx.drawImage(iimg, -h / 2, -h / 2, h, h);
      }
      ctx.restore();
      return;
    }
    if (this.type === 'coinPop') {
      // 弹出星币：旋转上升
      ctx.scale(Math.abs(Math.cos(this.animT * 9)) * 0.9 + 0.1, 1);
      ctx.fillStyle = '#ffd94d';
      drawStar(ctx, 0, 0, 13);
      ctx.fillStyle = '#fff3c4';
      drawStar(ctx, 0, 0, 6);
    } else if (this.type === 'fruit') {
      // 能量果实：发光橙莓 + 叶子
      ctx.translate(0, bob);
      ctx.shadowColor = '#ffab4d'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#ff8f3d';
      ctx.beginPath(); ctx.arc(0, 2, 12, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffcf8a';
      ctx.beginPath(); ctx.arc(-4, -2, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5ec45e';
      ctx.beginPath(); ctx.ellipse(4, -11, 7, 3.5, -0.5, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'fire') {
      // 火焰能量晶体
      ctx.translate(0, bob);
      ctx.shadowColor = '#ff6d5a'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#ff5d45';
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.quadraticCurveTo(11, -2, 7, 9);
      ctx.quadraticCurveTo(0, 15, -7, 9); ctx.quadraticCurveTo(-11, -2, 0, -14);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.arc(0, 5, 4.5, 0, Math.PI * 2); ctx.fill();
    } else if (this.type === 'star') {
      // 无敌星
      ctx.translate(0, bob);
      ctx.rotate(Math.sin(this.animT * 3) * 0.2);
      ctx.shadowColor = '#ffe37a'; ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffe37a';
      drawStar(ctx, 0, 0, 14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#23262e';
      ctx.fillRect(-5, -3, 2.5, 4); ctx.fillRect(3, -3, 2.5, 4); // 小眼睛
    } else if (this.type === 'life') {
      // 生命果（绿色爱心果）
      ctx.translate(0, bob);
      ctx.shadowColor = '#7bf0a2'; ctx.shadowBlur = 12;
      ctx.fillStyle = '#4ecb71';
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.bezierCurveTo(-14, 0, -10, -12, 0, -5);
      ctx.bezierCurveTo(10, -12, 14, 0, 0, 12);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#d8ffe4';
      ctx.fillRect(-2, -4, 4, 10); ctx.fillRect(-5, -1, 10, 4); // 十字
    }
    ctx.restore();
  }
}

/* ============================================================
 * EnergyBall —— 火焰形态发射的能量球（带尾迹、可弹跳）
 * ============================================================ */
class EnergyBall {
  constructor(x, y, dir) {
    this.x = x - 8; this.y = y - 8;
    this.w = 16; this.h = 16;
    this.vx = dir * 560;
    this.vy = -120;
    this.life = 3;
    this.trailT = 0;
    this.removeMe = false;
  }
  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.removeMe = true; return; }
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.03;
      game.particles.trail(this.x + 8, this.y + 8, 'rgba(122,212,255,0.8)');
    }
    this.vy += 1500 * dt;
    if (this.vy > 720) this.vy = 720;
    const level = game.level;
    // 水平：撞墙则消散
    this.x += this.vx * dt;
    {
      const c = this.vx > 0 ? Math.floor((this.x + this.w) / TILE) : Math.floor(this.x / TILE);
      const r = Math.floor((this.y + 8) / TILE);
      if (level.isSolid(c, r)) {
        game.particles.poof(this.x + 8, this.y + 8, '#7ad4ff');
        this.removeMe = true;
        return;
      }
    }
    // 垂直：落地弹跳
    this.y += this.vy * dt;
    {
      const c = Math.floor((this.x + 8) / TILE);
      if (this.vy > 0) {
        const r = Math.floor((this.y + this.h) / TILE);
        if (level.isSolid(c, r)) { this.y = r * TILE - this.h; this.vy = -340; }
      } else {
        const r = Math.floor(this.y / TILE);
        if (level.isSolid(c, r)) { this.y = (r + 1) * TILE + 0.01; this.vy = 40; }
      }
    }
    if (this.y > level.pixelH + 80) this.removeMe = true;
  }
  render(ctx, cam, time) {
    const cx = this.x - cam.x + 8, cy = this.y - cam.y + 8;
    // —— 素材贴图：火球沿飞行方向旋转 ——
    const fimg = SpriteLib.get('fireball');
    if (fimg) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(this.vy, this.vx));
      ctx.shadowColor = '#7ad4ff'; ctx.shadowBlur = 14;
      ctx.drawImage(fimg, -10, -10, 20, 20);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.shadowColor = '#7ad4ff'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#aee6ff';
    ctx.beginPath(); ctx.arc(cx, cy, 7 + Math.sin(time * 20) * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

/* ============================================================
 * 渲染器 —— 多层视差背景 / 瓦片 / 星币 / 传送门
 * ============================================================ */
function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mixColor(c1, c2, k) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return 'rgb(' + Math.round(lerp(a[0], b[0], k)) + ',' + Math.round(lerp(a[1], b[1], k)) + ',' + Math.round(lerp(a[2], b[2], k)) + ')';
}
const mod = (a, n) => ((a % n) + n) % n;

function renderBackground(ctx, cam, level, time) {
  // —— 洞穴暗化系数（进入洞穴区间时背景渐变暗）——
  let caveK = 0;
  if (level && level.cave) {
    const from = level.cave.fromCol * TILE, to = level.cave.toCol * TILE;
    const cx = cam.x + VIEW_W / 2;
    const fade = TILE * 5;
    caveK = clamp(Math.min((cx - from + fade) / fade, (to + fade - cx) / fade, 1), 0, 1);
  }
  // —— 天空渐变 ——
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, mixColor('#55b6f2', '#0c1126', caveK));
  g.addColorStop(0.7, mixColor('#a8e0ff', '#1a2140', caveK));
  g.addColorStop(1, mixColor('#dcf4ff', '#232c4e', caveK));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const dayA = 1 - caveK;
  if (dayA > 0.02) {
    // —— 太阳（固定于天空）——
    ctx.globalAlpha = dayA;
    ctx.fillStyle = '#fff3b0';
    ctx.shadowColor = '#ffec8a'; ctx.shadowBlur = 40;
    ctx.beginPath(); ctx.arc(830, 86, 34, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // —— 云层（视差 0.22，优先使用素材云）——
    for (let i = 0; i < 12; i++) {
      const sx = mod(i * 797 + seededRand(i) * 460 - cam.x * 0.22, VIEW_W + 360) - 180;
      const sy = 36 + seededRand(i * 7 + 3) * 150;
      const s = 0.7 + seededRand(i * 13) * 0.8;
      const cimg = SpriteLib.get('cloud' + ((i % 3) + 1));
      if (cimg) {
        ctx.globalAlpha = 0.95 * dayA;
        const cw = 130 * s;
        const ch = cw * (cimg.naturalHeight / cimg.naturalWidth);
        ctx.drawImage(cimg, sx - cw / 2, sy - ch / 2, cw, ch);
      } else {
        ctx.globalAlpha = dayA;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.arc(sx, sy, 20 * s, 0, Math.PI * 2);
        ctx.arc(sx + 22 * s, sy + 4 * s, 15 * s, 0, Math.PI * 2);
        ctx.arc(sx - 22 * s, sy + 5 * s, 14 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  // —— 远山（视差 0.38，优先使用素材山层）——
  const mimg = SpriteLib.get('mountains');
  if (mimg) {
    const mh = 320;
    const mw = mh * (mimg.naturalWidth / mimg.naturalHeight);
    const startX = -mod(cam.x * 0.38, mw);
    ctx.globalAlpha = 0.85 * dayA;
    for (let x = startX - mw; x < VIEW_W + mw; x += mw) {
      ctx.drawImage(mimg, x, VIEW_H - mh, mw, mh);
    }
    ctx.globalAlpha = 1;
  } else {
    ctx.fillStyle = mixColor('#8fb8dd', '#141a32', caveK);
    for (let i = 0; i < 8; i++) {
      const sx = mod(i * 613 + seededRand(i + 40) * 320 - cam.x * 0.38, VIEW_W + 520) - 260;
      const h = 170 + seededRand(i + 80) * 130;
      ctx.beginPath();
      ctx.moveTo(sx - 190, VIEW_H);
      ctx.lineTo(sx, VIEW_H - h);
      ctx.lineTo(sx + 190, VIEW_H);
      ctx.fill();
    }
  }
  // —— 近处山丘与树（视差 0.6）——
  ctx.fillStyle = mixColor('#7cc273', '#10162c', caveK);
  for (let i = 0; i < 9; i++) {
    const sx = mod(i * 523 + seededRand(i + 120) * 260 - cam.x * 0.6, VIEW_W + 420) - 210;
    ctx.beginPath();
    ctx.arc(sx, VIEW_H + 40, 130 + seededRand(i + 150) * 60, Math.PI, 0);
    ctx.fill();
  }
  if (dayA > 0.02) {
    for (let i = 0; i < 10; i++) {
      const sx = mod(i * 449 + seededRand(i + 200) * 200 - cam.x * 0.6, VIEW_W + 200) - 100;
      const base = VIEW_H - 60 - seededRand(i + 230) * 30;
      ctx.globalAlpha = dayA;
      ctx.fillStyle = '#5aa857';
      ctx.beginPath(); ctx.moveTo(sx - 16, base); ctx.lineTo(sx, base - 46); ctx.lineTo(sx + 16, base); ctx.fill();
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(sx - 3, base, 6, 12);
      ctx.globalAlpha = 1;
    }
  }
  // —— 洞穴装饰：发光水晶 ——
  if (caveK > 0.05) {
    ctx.globalAlpha = caveK;
    for (let i = 0; i < 10; i++) {
      const sx = mod(i * 331 + seededRand(i + 300) * 180 - cam.x * 0.9, VIEW_W + 160) - 80;
      const sy = 60 + seededRand(i + 310) * 100;
      const pulse = 0.6 + Math.sin(time * 2 + i) * 0.4;
      ctx.fillStyle = 'rgba(110,230,255,' + (0.5 + pulse * 0.4) + ')';
      ctx.shadowColor = '#6ee6ff'; ctx.shadowBlur = 10 * pulse;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 8); ctx.lineTo(sx + 5, sy); ctx.lineTo(sx, sy + 8); ctx.lineTo(sx - 5, sy);
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
  return caveK;
}

/* ---------------- 瓦片绘制 ---------------- */
function renderTiles(ctx, cam, level, time) {
  const c0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const c1 = Math.min(level.colCount - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1);
  const r0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const r1 = Math.min(level.rowCount - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ch = level.rows[r][c];
      if (ch === ' ' || ch === 'h' || ch === 'u') continue; // 空格与隐藏宝箱不绘制
      const sx = c * TILE - cam.x;
      const sy = r * TILE - cam.y + level.bumpOffset(c, r); // 顶击抖动
      drawTile(ctx, ch, sx, sy, c, r, time, level);
      // 草皮上随机点缀植物/灌木（确定性分布，不闪烁）
      if (ch === '#' && level.tileChar(c, r - 1) === ' ') {
        const k = seededRand(c * 13 + r * 7);
        if (k < 0.16) {
          const dimg = SpriteLib.get('plant');
          if (dimg) drawSprite(ctx, dimg, sx + TILE / 2, sy + 2, 26, false);
        } else if (k < 0.28) {
          const dimg = SpriteLib.get('bush');
          if (dimg) drawSprite(ctx, dimg, sx + TILE / 2, sy + 2, 22, false);
        }
      }
    }
  }
  // 出生点旁的出口指示牌
  const sign = SpriteLib.get('sign_exit');
  if (sign && cam.x < 400) {
    drawSprite(ctx, sign, TILE * 4.5 - cam.x, TILE * 10 - cam.y, 46, false);
  }
}

function drawTile(ctx, ch, sx, sy, c, r, time, level) {
  const T = TILE;
  // —— 素材贴图优先（未加载则走下方程序绘制）——
  let img = null;
  if (ch === '#') img = SpriteLib.get(level && level.isSolid(c, r - 1) ? 'dirt' : 'grass');
  else if (ch === 'd') img = SpriteLib.get('stone');
  else if (ch === 'X') img = SpriteLib.get('stone');
  else if (ch === 'B') img = SpriteLib.get('brick');
  else if (ch === '-') img = SpriteLib.get('float_island');
  else if (ch === '?') img = SpriteLib.get('chest_coin');
  else if (ch === 'm' || ch === 'f' || ch === 's') img = SpriteLib.get('chest_item');
  else if (ch === 'v') img = SpriteLib.get('chest_used');
  if (img) {
    if (ch === '?' || ch === 'm' || ch === 'f' || ch === 's') {
      // 宝箱方块发光脉冲
      ctx.save();
      ctx.shadowColor = '#ffd94d';
      ctx.shadowBlur = 8 + (0.5 + Math.sin(time * 4 + c) * 0.5) * 10;
      ctx.drawImage(img, sx, sy, T, T);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, T, T);
      if (ch === 'X' || ch === 'd') { // 洞穴岩石压暗
        ctx.fillStyle = 'rgba(10,10,40,0.28)';
        ctx.fillRect(sx, sy, T, T);
      }
    }
    return;
  }
  if (ch === '#' || ch === 'd') {
    // 草地 / 泥土
    ctx.fillStyle = ch === '#' ? '#a5673d' : '#7c4f30';
    ctx.fillRect(sx, sy, T, T);
    // 泥土纹理点（确定性分布）
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 3; i++) {
      const px = sx + 6 + seededRand(c * 31 + r * 7 + i) * (T - 12);
      const py = sy + 10 + seededRand(c * 17 + r * 23 + i) * (T - 16);
      ctx.fillRect(px, py, 4, 3);
    }
    if (ch === '#') {
      // 草皮
      ctx.fillStyle = '#54b04a';
      ctx.fillRect(sx, sy, T, 12);
      ctx.fillStyle = '#6cc95f';
      ctx.fillRect(sx, sy, T, 6);
      // 草叶尖
      ctx.fillStyle = '#54b04a';
      for (let i = 0; i < 4; i++) {
        const bx = sx + 4 + i * 12 + seededRand(c * 5 + i) * 6;
        ctx.beginPath();
        ctx.moveTo(bx, sy + 12); ctx.lineTo(bx + 4, sy + 4); ctx.lineTo(bx + 8, sy + 12);
        ctx.fill();
      }
    }
  } else if (ch === 'X') {
    // 岩石（洞穴）
    ctx.fillStyle = '#464b68';
    ctx.fillRect(sx, sy, T, T);
    ctx.fillStyle = '#565c7e';
    ctx.fillRect(sx, sy, T, 5);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(sx + 6, sy + 14, 12, 5);
    ctx.fillRect(sx + 24, sy + 28, 14, 5);
  } else if (ch === 'B') {
    // 砖块
    ctx.fillStyle = '#c96b3a';
    ctx.fillRect(sx, sy, T, T);
    ctx.strokeStyle = '#8f4322';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, T - 2, T - 2);
    ctx.beginPath();
    ctx.moveTo(sx, sy + T / 2); ctx.lineTo(sx + T, sy + T / 2);
    ctx.moveTo(sx + T / 2, sy); ctx.lineTo(sx + T / 2, sy + T / 2);
    ctx.moveTo(sx + T / 4, sy + T / 2); ctx.lineTo(sx + T / 4, sy + T);
    ctx.moveTo(sx + (3 * T) / 4, sy + T / 2); ctx.lineTo(sx + (3 * T) / 4, sy + T);
    ctx.stroke();
  } else if (ch === '-') {
    // 悬浮平台（草皮小岛）
    ctx.fillStyle = '#a5673d';
    roundRect(ctx, sx + 1, sy + 4, T - 2, T - 10, 8); ctx.fill();
    ctx.fillStyle = '#54b04a';
    roundRect(ctx, sx + 1, sy, T - 2, 14, 7); ctx.fill();
    ctx.fillStyle = '#6cc95f';
    ctx.fillRect(sx + 4, sy + 2, T - 8, 4);
  } else if (ch === 'T') {
    // 机械管道
    ctx.fillStyle = '#2e8f84';
    ctx.fillRect(sx + 2, sy, T - 4, T);
    ctx.fillStyle = '#3fb3a5';
    ctx.fillRect(sx + 6, sy, 10, T);
    ctx.fillStyle = '#1f6e66';
    ctx.fillRect(sx + 2, sy, T - 4, 4);
    // 铆钉
    ctx.fillStyle = '#9adfd5';
    ctx.beginPath();
    ctx.arc(sx + 10, sy + 12, 2.4, 0, Math.PI * 2);
    ctx.arc(sx + T - 10, sy + 12, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (ch === '?' || ch === 'm' || ch === 'f' || ch === 's') {
    // 发光宝箱方块
    const pulse = 0.5 + Math.sin(time * 4 + c) * 0.5;
    ctx.save();
    ctx.shadowColor = '#ffd94d';
    ctx.shadowBlur = 8 + pulse * 10;
    ctx.fillStyle = '#f2b53d';
    roundRect(ctx, sx + 2, sy + 2, T - 4, T - 4, 7); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d18f22';
    roundRect(ctx, sx + 6, sy + 6, T - 12, T - 12, 5); ctx.fill();
    ctx.fillStyle = '#ffe37a';
    drawStar(ctx, sx + T / 2, sy + T / 2, 9 + pulse * 2);
    ctx.restore();
  } else if (ch === 'v') {
    // 已用方块
    ctx.fillStyle = '#8a6d4f';
    roundRect(ctx, sx + 2, sy + 2, T - 4, T - 4, 6); ctx.fill();
    ctx.fillStyle = '#6e543c';
    ctx.beginPath();
    ctx.arc(sx + 9, sy + 9, 2.4, 0, Math.PI * 2);
    ctx.arc(sx + T - 9, sy + 9, 2.4, 0, Math.PI * 2);
    ctx.arc(sx + 9, sy + T - 9, 2.4, 0, Math.PI * 2);
    ctx.arc(sx + T - 9, sy + T - 9, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
/* ---------------- 星币（旋转动画）---------------- */
function renderCoins(ctx, cam, level, time) {
  for (const coin of level.coins) {
    if (coin.taken) continue;
    if (coin.x < cam.x - 60 || coin.x > cam.x + VIEW_W + 60) continue;
    const sx = coin.x - cam.x;
    const sy = coin.y - cam.y + Math.sin(time * 3 + coin.x * 0.05) * 3;
    const k = Math.abs(Math.cos(time * 4 + coin.x * 0.02)) * 0.85 + 0.15;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(k, 1);
    ctx.shadowColor = '#ffd94d'; ctx.shadowBlur = 12;
    const cimg = SpriteLib.get('star');
    if (cimg) {
      ctx.drawImage(cimg, -14, -14, 28, 28);
    } else {
      ctx.fillStyle = '#ffd94d';
      drawStar(ctx, 0, 0, 12);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fff3c4';
      drawStar(ctx, 0, 0, 5.5);
    }
    ctx.restore();
  }
}

/* ---------------- 终点传送门 ---------------- */
function renderGoal(ctx, cam, goal, time) {
  if (!goal) return;
  const gx = goal.x - cam.x + goal.w / 2;
  const gy = goal.y - cam.y;
  // —— 素材版：城堡大门 + 旗帜 ——
  const doorTop = SpriteLib.get('door_top');
  const doorMid = SpriteLib.get('door_mid');
  if (doorTop && doorMid) {
    // 门后光晕
    ctx.save();
    ctx.shadowColor = '#8ad4ff'; ctx.shadowBlur = 26;
    ctx.fillStyle = 'rgba(150,220,255,0.35)';
    roundRect(ctx, gx - 30, gy - 4, 60, goal.h + 4, 10); ctx.fill();
    ctx.restore();
    ctx.drawImage(doorTop, gx - 24, gy, 48, 48);
    ctx.drawImage(doorMid, gx - 24, gy + 48, 48, 48);
    // 门旁旗帜
    const flag = SpriteLib.get('flag');
    if (flag) drawSprite(ctx, flag, gx + 44, gy + goal.h, 70, false);
    // 门口流光
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 3; i++) {
      const yy = gy + 10 + mod(time * 55 + i * 34, goal.h - 20);
      ctx.beginPath(); ctx.arc(gx + Math.sin(time * 3 + i * 2) * 14, yy, 2.4, 0, Math.PI * 2); ctx.fill();
    }
    // 顶部悬浮星星
    ctx.save();
    ctx.translate(gx, gy - 16 + Math.sin(time * 2.5) * 4);
    ctx.rotate(time * 1.5);
    ctx.shadowColor = '#ffe37a'; ctx.shadowBlur = 16;
    const simg = SpriteLib.get('star');
    if (simg) ctx.drawImage(simg, -12, -12, 24, 24);
    else { ctx.fillStyle = '#ffe37a'; drawStar(ctx, 0, 0, 11); }
    ctx.restore();
    return;
  }
  // 底座石台
  ctx.fillStyle = '#565c7e';
  roundRect(ctx, gx - 34, gy + goal.h - 10, 68, 12, 4); ctx.fill();
  // 两侧石柱
  ctx.fillStyle = '#7c86b8';
  ctx.fillRect(gx - 26, gy + 6, 8, goal.h - 12);
  ctx.fillRect(gx + 18, gy + 6, 8, goal.h - 12);
  ctx.fillStyle = '#9aa5d6';
  ctx.fillRect(gx - 26, gy, 8, 8);
  ctx.fillRect(gx + 18, gy, 8, 8);
  // 能量光幕（流动渐变）
  const g = ctx.createLinearGradient(gx, gy, gx, gy + goal.h);
  g.addColorStop(0, 'rgba(122,212,255,0.85)');
  g.addColorStop(0.5, 'rgba(176,122,255,0.8)');
  g.addColorStop(1, 'rgba(122,255,196,0.85)');
  ctx.save();
  ctx.shadowColor = '#8ad4ff'; ctx.shadowBlur = 24;
  ctx.fillStyle = g;
  roundRect(ctx, gx - 16, gy + 8, 32, goal.h - 18, 12); ctx.fill();
  ctx.restore();
  // 内部流光
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 3; i++) {
    const yy = gy + 14 + mod(time * 60 + i * 32, goal.h - 32);
    ctx.beginPath(); ctx.arc(gx + Math.sin(time * 3 + i * 2) * 8, yy, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  // 顶部悬浮星星
  ctx.save();
  ctx.translate(gx, gy - 14 + Math.sin(time * 2.5) * 4);
  ctx.rotate(time * 1.5);
  ctx.shadowColor = '#ffe37a'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffe37a';
  drawStar(ctx, 0, 0, 11);
  ctx.restore();
}

/* ============================================================
 * UIManager —— HUD 更新与界面切换（DOM）
 * ============================================================ */
class UIManager {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      score: $('hud-score'), coins: $('hud-coins'), lives: $('hud-lives'),
      time: $('hud-time'), level: $('hud-level'), progressFill: $('hud-progress-fill'),
      start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over'), clear: $('screen-clear'),
      overScore: $('over-score'), overCoins: $('over-coins'), overTime: $('over-time'),
      clearScore: $('clear-score'), clearTime: $('clear-time'),
      btnStart: $('btn-start'), btnSound: $('btn-sound'), btnFullscreen: $('btn-fullscreen'),
      btnResume: $('btn-resume'), btnPauseRestart: $('btn-pause-restart'),
      btnOverRestart: $('btn-over-restart'), btnClearRestart: $('btn-clear-restart'),
      touchLeft: $('touch-left'), touchRight: $('touch-right'), touchJump: $('touch-jump'), touchFire: $('touch-fire'),
    };
    this._cache = {};
    this._progressCache = -1;
  }
  setText(key, v) {
    if (this._cache[key] === v) return; // 避免每帧重复写 DOM
    this._cache[key] = v;
    const el = this.el[key];
    if (el) el.textContent = String(v);
  }
  updateHUD(game) {
    this.setText('score', game.score);
    this.setText('coins', game.coinsCollected);
    this.setText('lives', game.lives);
    this.setText('time', Math.max(0, Math.ceil(game.time)));
    this.setText('level', game.level ? game.level.name.split(' ')[0] : '1-1');
    if (game.level && game.level.goal && this.el.progressFill) {
      const pct = clamp((game.player.x / game.level.goal.x) * 100, 0, 100);
      if (Math.abs(pct - this._progressCache) > 0.4) {
        this._progressCache = pct;
        this.el.progressFill.style.width = pct.toFixed(1) + '%';
      }
    }
  }
  // 界面切换：'start' | 'pause' | 'over' | 'clear' | null(游戏中)
  show(name) {
    const map = { start: this.el.start, pause: this.el.pause, over: this.el.over, clear: this.el.clear };
    for (const k in map) {
      if (map[k]) map[k].classList.toggle('hidden', k !== name);
    }
    if (this.el.hud) this.el.hud.classList.toggle('hidden', name === 'start');
  }
  setSoundLabel(enabled) {
    if (this.el.btnSound) this.el.btnSound.textContent = enabled ? '音效：开' : '音效：关';
  }
  showFireButton(show) {
    if (this.el.touchFire) this.el.touchFire.classList.toggle('hidden', !show);
  }
}

/* ============================================================
 * Game —— 主循环（固定时间步长）、状态机、碰撞分发
 * ============================================================ */
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    SpriteLib.load(SPRITE_MANIFEST); // 启动素材加载（异步，不阻塞游戏）
    this.audio = new AudioManager();
    this.input = new InputManager();
    this.particles = new ParticleSystem();
    this.camera = new Camera();
    this.ui = new UIManager();

    this.state = 'menu'; // menu | playing | paused | clear | gameover
    this.score = 0;
    this.coinsCollected = 0;
    this.lives = START_LIVES;
    this.time = START_TIME;
    this.playTime = 0;
    this.level = null;
    this.player = null;
    this.enemies = [];
    this.items = [];
    this.balls = [];
    this.accumulator = 0;
    this.lastT = 0;
    this.timeSec = 0;    // 全局动画时钟
    this.clearT = 0;     // 通关庆祝计时
    this.fireworkT = 0;

    // 输入回调
    this.input.bind();
    this.input.onPause = () => this.togglePause();
    this.input.onRestart = () => { if (this.state === 'playing' || this.state === 'paused') this.startGame(); };
    this.input.onAnyInput = () => this.audio.unlock();
    this.bindUI();

    // 自适应窗口
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 100));

    this.loadLevel(); // 预载关卡，开始界面背后即为游戏世界
    this.ui.show('start');

    if (typeof window !== 'undefined') window.__game = this; // 调试钩子
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------- 画布尺寸：16:9 + 高清 DPR ---------------- */
  resize() {
    const ww = window.innerWidth, wh = window.innerHeight;
    let cw = ww, ch = (ww * 9) / 16;
    if (ch > wh) { ch = wh; cw = (wh * 16) / 9; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2); // 限制 DPR 上限保护性能
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.scale = this.canvas.width / VIEW_W; // 逻辑坐标 -> 物理像素
  }

  bindUI() {
    const el = this.ui.el;
    const click = (btn, fn) => { if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); this.audio.unlock(); fn(); }); };
    click(el.btnStart, () => this.startGame());
    click(el.btnResume, () => this.togglePause());
    click(el.btnPauseRestart, () => this.startGame());
    click(el.btnOverRestart, () => this.startGame());
    click(el.btnClearRestart, () => this.startGame());
    click(el.btnSound, () => this.ui.setSoundLabel(this.audio.toggle()));
    click(el.btnFullscreen, () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    });
    // 移动端触控按钮
    this.input.bindTouchButton(el.touchLeft, 'left');
    this.input.bindTouchButton(el.touchRight, 'right');
    this.input.bindTouchButton(el.touchJump, 'jump');
    this.input.bindTouchButton(el.touchFire, 'fire');
  }

  /* ---------------- 流程控制 ---------------- */
  loadLevel() {
    this.level = new Level(LEVEL_DATA);
    this.player = new Player(this.level.playerSpawn);
    this.enemies = [];
    this.items = [];
    this.balls = [];
    this.particles.clear();
    this.time = START_TIME;
    this.camera.reset();
  }
  startGame() {
    this.score = 0;
    this.coinsCollected = 0;
    this.lives = START_LIVES;
    this.playTime = 0;
    this.loadLevel();
    this.state = 'playing';
    this.ui.show(null);
    this.ui.updateHUD(this);
  }
  togglePause() {
    if (this.state === 'playing') { this.state = 'paused'; this.ui.show('pause'); }
    else if (this.state === 'paused') { this.state = 'playing'; this.ui.show(null); }
  }
  onPlayerDeathFinished() {
    this.lives--;
    if (this.lives <= 0) {
      this.state = 'gameover';
      this.ui.setText('overScore', this.score);
      this.ui.setText('overCoins', this.coinsCollected);
      this.ui.setText('overTime', Math.round(this.playTime));
      this.ui.show('over');
    } else {
      this.loadLevel(); // 重生：重置关卡与敌人，保留分数和星币计数
    }
  }
  win() {
    if (this.state !== 'playing') return;
    this.state = 'clear';
    this.clearT = 0;
    this.fireworkT = 0.3;
    this.player.won = true;
    this.player.vx = 0;
    // 剩余时间折算奖励分
    this.score += Math.ceil(this.time) * 10;
    this.audio.clear();
    this.particles.confetti(this.player.x, this.player.y - 60, 80);
    this.ui.setText('clearScore', this.score);
    this.ui.setText('clearTime', Math.round(this.playTime));
  }

  addScore(x, y, n) {
    this.score += n;
    this.particles.addText(x, y, '+' + n);
  }
  killEnemy(e) {
    if (e.dead || e.removeMe) return;
    e.dead = true;
    e.squashT = 0.3;
    this.addScore(e.x + e.w / 2, e.y, e.score);
    this.particles.poof(e.x + e.w / 2, e.y + e.h / 2, '#e8d8ff');
  }
  // 宝箱方块内容物
  spawnChestContent(chest) {
    const { col, row, content } = chest;
    if (content === '?') {
      this.coinsCollected++;
      this.addScore(col * TILE + TILE / 2, row * TILE - 12, 100);
      this.items.push(new Item(col, row, 'coinPop'));
      this.audio.coin();
    } else if (content === 'm') {
      // 小个子给能量果实，已变大则给火焰能量
      this.items.push(new Item(col, row, this.player.power === 0 ? 'fruit' : 'fire'));
    } else if (content === 'f') {
      this.items.push(new Item(col, row, 'fire'));
    } else if (content === 's') {
      this.items.push(new Item(col, row, 'star'));
    } else if (content === 'u') {
      this.items.push(new Item(col, row, 'life'));
    }
  }
  // 敌人按需生成（接近镜头才激活）
  spawnEnemies() {
    for (const s of this.level.spawns) {
      if (s.spawned) continue;
      if (s.x < this.camera.x + VIEW_W + 160) {
        s.spawned = true;
        let e = null;
        if (s.type === 'e') e = new Grumbler(s.x, s.y);
        else if (s.type === 'k') e = new Shellbug(s.x, s.y);
        else e = new Bouncebot(s.x, s.y);
        e.y = s.y + TILE - e.h; // 站在标记所在格的下一格地面上
        this.enemies.push(e);
      }
    }
  }

  /* ---------------- 固定步长主循环 ---------------- */
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const now = t / 1000;
    let dt = now - (this.lastT || now);
    this.lastT = now;
    if (dt > 0.1) dt = 0.1; // 掉帧保护
    this.input.beginFrame();
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 5) {
      this.update(STEP);
      this.accumulator -= STEP;
      steps++;
      this.input.consumeEdges(); // 边沿输入只作用于第一个逻辑步
    }
    if (steps === 5) this.accumulator = 0;
    this.render();
  }

  update(dt) {
    this.timeSec += dt;
    if (this.state === 'playing') {
      this.playTime += dt;
      // 倒计时
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0;
        if (!this.player.dead) this.player.die(this);
      }
      this.level.update(dt);
      this.spawnEnemies();
      this.player.update(dt, this);
      // 掉出地图死亡
      if (!this.player.dead && this.player.y > this.level.pixelH + 60) this.player.die(this);
      // 敌人：离开镜头较远的暂停更新（性能优化）
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.removeMe) { this.enemies.splice(i, 1); continue; }
        const near = e.x + e.w > this.camera.x - 280 && e.x < this.camera.x + VIEW_W + 280;
        if (near) e.update(dt, this);
      }
      for (let i = this.items.length - 1; i >= 0; i--) {
        this.items[i].update(dt, this);
        if (this.items[i].removeMe) this.items.splice(i, 1);
      }
      for (let i = this.balls.length - 1; i >= 0; i--) {
        this.balls[i].update(dt, this);
        if (this.balls[i].removeMe) this.balls.splice(i, 1);
      }
      this.handleCollisions();
      this.particles.update(dt);
      this.camera.update(dt, this.player, this.level.pixelW, this.level.pixelH);
      this.ui.updateHUD(this);
      this.ui.showFireButton(this.player.power === 2);
    } else if (this.state === 'clear') {
      // 通关庆祝：彩纸 + 烟花
      this.clearT += dt;
      this.fireworkT -= dt;
      if (this.fireworkT <= 0) {
        this.fireworkT = 0.45 + Math.random() * 0.3;
        this.particles.firework(
          this.camera.x + 120 + Math.random() * (VIEW_W - 240),
          this.camera.y + 80 + Math.random() * 200
        );
        this.audio.noise(0.2, 0.08);
      }
      this.particles.update(dt);
      if (this.clearT > 1.6) this.ui.show('clear');
    } else if (this.state === 'menu') {
      // 开始界面背后：镜头缓慢自动巡游展示关卡
      this.camera.update(dt, { x: this.camera.x + 30, y: 260, w: 1, h: 1 }, this.level.pixelW, this.level.pixelH);
    }
    // paused / gameover：静止画面，不更新逻辑
  }

  /* ---------------- 碰撞分发 ---------------- */
  handleCollisions() {
    const p = this.player;
    if (p.dead || p.won) return;

    // —— 玩家 vs 敌人 ——
    for (const e of this.enemies) {
      if (e.dead || e.removeMe) continue;
      if (!rectsOverlap(p, e)) continue;
      const stompDepth = (p.y + p.h) - e.y;
      const stomping = p.vy > 0 && stompDepth < Math.min(22, e.h * 0.65);
      // 无敌星：碰到就消灭
      if (p.starT > 0 && !stomping) { this.killEnemy(e); this.audio.stomp(); continue; }
      // 静置的铁壳：任何方向的触碰都把它踢出去（不受伤）
      if (e instanceof Shellbug && e.state === 'shell') {
        const dir = p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1;
        e.kick(dir, this);
        if (stomping) p.vy = -520;
        continue;
      }
      if (stomping) {
        e.stomped(this);
        p.vy = this.input.jump ? -760 : -520; // 踩头弹跳（按住跳弹更高）
        p.onGround = false;
      } else {
        p.hurt(this);
      }
    }

    // —— 滑动铁壳 vs 其他敌人 ——
    for (const s of this.enemies) {
      if (!(s instanceof Shellbug) || s.state !== 'slide') continue;
      for (const e of this.enemies) {
        if (e === s || e.dead || e.removeMe) continue;
        if (rectsOverlap(s, e)) {
          this.killEnemy(e);
          this.camera.shake(3, 0.1);
        }
      }
    }

    // —— 能量球 vs 敌人 ——
    for (const b of this.balls) {
      if (b.removeMe) continue;
      for (const e of this.enemies) {
        if (e.dead || e.removeMe) continue;
        if (rectsOverlap(b, e)) {
          this.killEnemy(e);
          b.removeMe = true;
          this.particles.poof(b.x + 8, b.y + 8, '#7ad4ff');
          break;
        }
      }
    }

    // —— 玩家 vs 道具 ——
    for (const item of this.items) {
      if (item.removeMe || !item.active) continue;
      if (rectsOverlap(p, item)) item.collect(this);
    }

    // —— 玩家 vs 星币 ——
    const pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
    for (const coin of this.level.coins) {
      if (coin.taken) continue;
      if (Math.abs(coin.x - pcx) > 40 || Math.abs(coin.y - pcy) > 44) continue;
      coin.taken = true;
      this.coinsCollected++;
      this.addScore(coin.x, coin.y - 14, 100);
      this.particles.sparkle(coin.x, coin.y, '#ffd94d', 6);
      this.audio.coin();
    }

    // —— 玩家 vs 终点传送门 ——
    if (this.level.goal && rectsOverlap(p, this.level.goal)) this.win();
  }

  /* ---------------- 渲染 ---------------- */
  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    const cam = { x: this.camera.ox, y: this.camera.oy };
    renderBackground(ctx, cam, this.level, this.timeSec);
    renderGoal(ctx, cam, this.level.goal, this.timeSec);
    renderTiles(ctx, cam, this.level, this.timeSec);
    // 移动平台
    for (const mp of this.level.movingPlatforms) this.renderPlatform(ctx, cam, mp);
    renderCoins(ctx, cam, this.level, this.timeSec);
    for (const item of this.items) item.render(ctx, cam, this.timeSec);
    for (const e of this.enemies) e.render(ctx, cam, this.timeSec);
    for (const b of this.balls) b.render(ctx, cam, this.timeSec);
    if (this.player) this.player.render(ctx, cam, this.timeSec);
    this.particles.render(ctx, cam);
    // 暂停时压暗
    if (this.state === 'paused') {
      ctx.fillStyle = 'rgba(8,12,28,0.45)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  renderPlatform(ctx, cam, mp) {
    const sx = mp.x - cam.x, sy = mp.y - cam.y;
    ctx.fillStyle = '#6b5a8f';
    roundRect(ctx, sx, sy, mp.w, mp.h, 8); ctx.fill();
    ctx.fillStyle = '#8f7cc0';
    roundRect(ctx, sx + 3, sy + 2, mp.w - 6, 6, 4); ctx.fill();
    // 方向指示灯
    ctx.fillStyle = '#ffe37a';
    ctx.beginPath();
    ctx.arc(sx + mp.w / 2, sy + mp.h / 2 + 1, 3 + Math.sin(this.timeSec * 6) * 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ============================================================
 * 启动
 * ============================================================ */
function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) return;
  new Game(canvas);
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
