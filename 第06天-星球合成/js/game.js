'use strict';
/* ================= 主逻辑：状态机 / 输入 / HUD / 循环 ================= */

(function () {
  // 观战模式由 spectate.js 接管，跳过本地单机
  const _sp = new URLSearchParams(location.search);
  if (_sp.get('spectate') === '1' || _sp.get('spectate') === 'true' || window.__SUIKA_SPECTATE__) {
    return;
  }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const highEl = document.getElementById('high');
  const startHighEl = document.getElementById('start-high');

  const ovStart = document.getElementById('ov-start');
  const ovPause = document.getElementById('ov-pause');
  const ovOver = document.getElementById('ov-over');
  const overScoreEl = document.getElementById('over-score');
  const overHighEl = document.getElementById('over-high');
  const overRecordEl = document.getElementById('over-record');

  /* ---------- 画布高清适配 ---------- */
  function setupCanvas(c, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas(canvas, CFG.W, CFG.H);
  setupCanvas(nextCanvas, 96, 96);

  /* ---------- 游戏状态 ---------- */
  const game = {
    state: 'start', // start | playing | paused | over
    world: new World(),
    score: 0,
    high: parseInt(localStorage.getItem(CFG.storageHigh) || '0', 10) || 0,
    combo: 0,
    comboTimer: 0,
    aimX: CFG.W / 2,
    aiming: false,
    heldLevel: 0,
    nextLevel: 0,
    dropTimer: 0,
    danger: false,
    celebrateT: 0,
    fireworkT: 0,
    time: 0,
    newRecord: false,
    maxLevelReached: 0,
  };

  highEl.textContent = game.high;
  startHighEl.textContent = game.high;

  function randLevel() {
    return Math.floor(Math.random() * CFG.spawnLevels);
  }

  function updateHUD() {
    scoreEl.textContent = game.score;
    highEl.textContent = game.high;
  }

  function drawNextPreview() {
    nextCtx.clearRect(0, 0, 96, 96);
    const L = LEVELS[game.nextLevel];
    const r = L.kind === 'ring' ? 24 : Math.min(L.r * 0.6, 34);
    drawPlanet(nextCtx, game.nextLevel, 48, 48, r, 0, game.time);
  }

  /* ---------- 流程控制 ---------- */
  function startGame() {
    game.world.reset();
    FX.reset();
    game.score = 0;
    game.combo = 0;
    game.comboTimer = 0;
    game.dropTimer = 0;
    game.danger = false;
    game.celebrateT = 0;
    game.newRecord = false;
    game.maxLevelReached = 0;
    game.heldLevel = randLevel();
    game.nextLevel = randLevel();
    game.aimX = CFG.W / 2;
    game.state = 'playing';
    ovStart.classList.add('hidden');
    ovPause.classList.add('hidden');
    ovOver.classList.add('hidden');
    updateHUD();
    drawNextPreview();
    btnPause.textContent = '⏸ 暂停';
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    ovPause.classList.remove('hidden');
    btnPause.textContent = '▶ 继续';
  }

  function resumeGame() {
    if (game.state !== 'paused') return;
    game.state = 'playing';
    ovPause.classList.add('hidden');
    codex.classList.add('hidden');
    btnPause.textContent = '⏸ 暂停';
    SuikaAudio.init();
  }

  function gameOver() {
    game.state = 'over';
    game.danger = false;
    SuikaAudio.over();
    FX.shake(14);
    if (game.score > game.high) {
      game.high = game.score;
      game.newRecord = true;
      localStorage.setItem(CFG.storageHigh, String(game.high));
    }
    overScoreEl.textContent = game.score;
    overHighEl.textContent = game.high;
    overRecordEl.classList.toggle('hidden', !game.newRecord);
    updateHUD();
    ovOver.classList.remove('hidden');
    // 上报排行榜（人类成绩，荣誉制）
    if (window.SuikaLeaderboard && game.score > 0) {
      const ml = LEVELS[game.maxLevelReached];
      window.SuikaLeaderboard.onGameOver(game.score, ml ? ml.name : null);
    }
  }

  function celebrate(x, y, big) {
    game.celebrateT = Math.max(game.celebrateT, big ? 2.6 : 1.6);
    SuikaAudio.celebrate();
    FX.shake(big ? 12 : 7);
    FX.firework(x, y);
  }

  /* ---------- 掉落 ---------- */
  function tryDrop() {
    if (game.state !== 'playing' || game.dropTimer > 0) return;
    const r = LEVELS[game.heldLevel].r;
    const x = Math.min(Math.max(game.aimX, CFG.wallL + r), CFG.wallR - r);
    const b = new Ball(x, CFG.dropY, game.heldLevel);
    game.world.add(b);
    SuikaAudio.drop();
    game.heldLevel = game.nextLevel;
    game.nextLevel = randLevel();
    game.dropTimer = CFG.dropCooldown;
    drawNextPreview();
  }

  /* ---------- 合成事件 ---------- */
  function handleEvents(events) {
    for (const ev of events) {
      // 连击
      if (game.comboTimer > 0) game.combo += 1;
      else game.combo = 1;
      game.comboTimer = CFG.comboWindow;

      const L = LEVELS[ev.level];
      const colors = [L.light, L.base, '#ffffff'];
      if (ev.level > game.maxLevelReached) game.maxLevelReached = ev.level;

      if (ev.type === 'annihilate') {
        const gained = 150 * game.combo;
        game.score += gained;
        FX.burst(ev.x, ev.y, ['#fff6c0', '#ffcf3f', '#ff8a5c'], 60, 520);
        FX.text(ev.x, ev.y - 20, '+' + gained, '#ffd75e', 34);
        FX.text(ev.x, ev.y - 60, '☀ 太阳湮灭！', '#ff8a5c', 24);
        celebrate(ev.x, ev.y, true);
      } else {
        const gained = mergeScore(ev.level) * game.combo;
        game.score += gained;
        FX.burst(ev.x, ev.y, colors, 18 + ev.level * 2, 260 + ev.level * 30);
        FX.text(ev.x, ev.y - LEVELS[ev.level].r - 10, '+' + gained, '#ffd75e', 20 + Math.min(ev.level, 6) * 2);
        if (game.combo >= 2) {
          FX.text(ev.x, ev.y - LEVELS[ev.level].r - 42, game.combo + ' 连击！', '#7ec3ff', 18);
          SuikaAudio.combo(game.combo);
        }
        SuikaAudio.merge(ev.level);
        FX.shake(Math.min(2 + ev.level, 8));
        if (ev.level === LEVELS.length - 1) {
          // 太阳诞生
          FX.text(ev.x, ev.y - LEVELS[ev.level].r - 70, '☀ 太阳诞生！', '#fff6c0', 30);
          celebrate(ev.x, ev.y, true);
        }
      }

      if (game.score > game.high) {
        game.high = game.score;
        game.newRecord = true;
        localStorage.setItem(CFG.storageHigh, String(game.high));
      }
      updateHUD();
    }
  }

  /* ---------- 固定步长逻辑 ---------- */
  function tick(dt) {
    if (game.dropTimer > 0) game.dropTimer -= dt;
    if (game.comboTimer > 0) {
      game.comboTimer -= dt;
      if (game.comboTimer <= 0) game.combo = 0;
    }

    const events = game.world.step(dt);
    if (events.length) handleEvents(events);

    // 警戒线判定
    let danger = false;
    for (const b of game.world.balls) {
      if (b.landed && b.y - b.r < CFG.lineY) {
        b.overT += dt;
        if (b.overT > 0.15) danger = true;
        if (b.overT >= CFG.overLineTime) {
          gameOver();
          return;
        }
      } else {
        b.overT = Math.max(0, b.overT - dt * 2);
      }
    }
    game.danger = danger;

    // 庆典烟花
    if (game.celebrateT > 0) {
      game.celebrateT -= dt;
      game.fireworkT -= dt;
      if (game.fireworkT <= 0) {
        game.fireworkT = 0.22;
        FX.firework(CFG.wallL + 40 + Math.random() * (CFG.wallR - CFG.wallL - 80),
          60 + Math.random() * 260);
      }
    }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    ctx.clearRect(0, 0, CFG.W, CFG.H);
    const off = FX.offset();
    ctx.save();
    ctx.translate(off.x, off.y);

    Renderer.drawBackground(ctx, game.time);
    Renderer.drawContainer(ctx);
    Renderer.drawLine(ctx, game.danger, game.time);

    // 星球
    for (const b of game.world.balls) {
      drawPlanet(ctx, b.level, b.x, b.y, b.r, b.rot, game.time);
    }

    // 待掉落星球 + 瞄准线
    if (game.state === 'playing') {
      const r = LEVELS[game.heldLevel].r;
      const x = Math.min(Math.max(game.aimX, CFG.wallL + r), CFG.wallR - r);
      const y = CFG.dropY + Math.sin(game.time * 3) * 2;
      Renderer.drawGuide(ctx, x, y, r);
      if (game.dropTimer > 0) ctx.globalAlpha = 0.45;
      drawPlanet(ctx, game.heldLevel, x, y, r, 0, game.time);
      ctx.globalAlpha = 1;
    }

    FX.draw(ctx);
    ctx.restore();

    // 危险红晕
    if (game.danger && game.state === 'playing') {
      const vg = ctx.createLinearGradient(0, 0, 0, CFG.lineY + 40);
      vg.addColorStop(0, 'rgba(255,60,70,' + (0.16 + 0.1 * Math.sin(game.time * 10)) + ')');
      vg.addColorStop(1, 'rgba(255,60,70,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, CFG.W, CFG.lineY + 40);
    }
  }

  /* ---------- 主循环 ---------- */
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    game.time += dt;

    if (game.state === 'playing') {
      acc += dt;
      while (acc >= STEP) {
        acc -= STEP;
        tick(STEP);
        if (game.state !== 'playing') { acc = 0; break; }
      }
      // 键盘瞄准移动（按住持续移动）
      let dir = 0;
      if (keys.has('left')) dir -= 1;
      if (keys.has('right')) dir += 1;
      if (dir !== 0) {
        game.aimX = Math.min(Math.max(game.aimX + dir * CFG.keySpeed * dt, CFG.wallL), CFG.wallR);
      }
    }
    FX.update(dt);
    render();
  }

  /* ---------- 输入（鼠标 + 触控） ---------- */
  function toLogical(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CFG.W,
      y: ((e.clientY - rect.top) / rect.height) * CFG.H,
    };
  }

  canvas.addEventListener('pointerdown', function (e) {
    SuikaAudio.init();
    if (game.state !== 'playing') return;
    e.preventDefault();
    game.aiming = true;
    game.aimX = toLogical(e).x;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (game.state !== 'playing') return;
    game.aimX = toLogical(e).x;
  });

  canvas.addEventListener('pointerup', function (e) {
    if (game.state !== 'playing') return;
    game.aimX = toLogical(e).x;
    if (game.aiming) {
      game.aiming = false;
      tryDrop();
    }
  });

  canvas.addEventListener('pointercancel', function () {
    game.aiming = false;
  });

  /* ---------- 输入（键盘） ---------- */
  // ← → 或 A D：移动瞄准；空格 / ↓ / 回车：落下；P / Esc：暂停；R：重开
  const keys = new Set();

  document.addEventListener('keydown', function (e) {
    const k = e.code;

    // 阻止方向键/空格滚动页面
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowDown' || k === 'Space') {
      e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'KeyA') keys.add('left');
    else if (k === 'ArrowRight' || k === 'KeyD') keys.add('right');

    if (k === 'KeyP' || k === 'Escape') {
      if (game.state === 'playing') pauseGame();
      else if (game.state === 'paused') resumeGame();
      return;
    }

    if (k === 'KeyR') {
      if (game.state !== 'start') {
        SuikaAudio.init();
        startGame();
      }
      return;
    }

    if (e.repeat) return; // 长按不重复触发动作键

    if (k === 'Space' || k === 'Enter' || k === 'ArrowDown') {
      SuikaAudio.init();
      if (game.state === 'start' || game.state === 'over') startGame();
      else if (game.state === 'paused') resumeGame();
      else tryDrop();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.delete('left');
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.delete('right');
  });

  window.addEventListener('blur', function () { keys.clear(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game.state === 'playing') pauseGame();
  });

  /* ---------- 按钮 ---------- */
  // 按钮点击后移除焦点，避免之后按空格/回车误触发按钮
  document.addEventListener('click', function (e) {
    const b = e.target.closest('button');
    if (b) b.blur();
  });

  const btnPause = document.getElementById('btn-pause');
  const btnSound = document.getElementById('btn-sound');
  const codex = document.getElementById('codex');

  document.getElementById('btn-start').addEventListener('click', function () {
    SuikaAudio.init();
    SuikaAudio.click();
    startGame();
  });
  btnPause.addEventListener('click', function () {
    SuikaAudio.click();
    if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused') resumeGame();
  });
  document.getElementById('btn-resume').addEventListener('click', function () {
    SuikaAudio.click();
    resumeGame();
  });
  document.getElementById('btn-restart').addEventListener('click', function () {
    SuikaAudio.init();
    SuikaAudio.click();
    startGame();
  });
  document.getElementById('btn-restart-pause').addEventListener('click', function () {
    SuikaAudio.click();
    startGame();
  });
  document.getElementById('btn-restart-over').addEventListener('click', function () {
    SuikaAudio.click();
    startGame();
  });

  // 音效开关
  const savedSound = localStorage.getItem(CFG.storageSound);
  SuikaAudio.enabled = savedSound !== '0';
  function refreshSoundBtn() {
    btnSound.textContent = SuikaAudio.enabled ? '🔊 音效' : '🔇 音效';
    btnSound.classList.toggle('off', !SuikaAudio.enabled);
  }
  refreshSoundBtn();
  btnSound.addEventListener('click', function () {
    SuikaAudio.init();
    SuikaAudio.setEnabled(!SuikaAudio.enabled);
    localStorage.setItem(CFG.storageSound, SuikaAudio.enabled ? '1' : '0');
    refreshSoundBtn();
    SuikaAudio.click();
  });

  /* ---------- 图鉴 ---------- */
  function buildCodex() {
    const grid = document.getElementById('codex-grid');
    LEVELS.forEach(function (L, i) {
      const cell = document.createElement('div');
      cell.className = 'codex-cell';
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 80;
      setupCanvas(c, 80, 80);
      const cctx = c.getContext('2d');
      const rr = L.kind === 'ring' ? 20 : Math.min(L.r, 30);
      drawPlanet(cctx, i, 40, 40, rr, 0, 0);
      const name = document.createElement('div');
      name.className = 'cname';
      name.textContent = (i + 1) + '. ' + L.name;
      const score = document.createElement('div');
      score.className = 'cscore';
      score.textContent = i === 0 ? '初始掉落' : '合成 +' + mergeScore(i);
      cell.appendChild(c);
      cell.appendChild(name);
      cell.appendChild(score);
      grid.appendChild(cell);
    });
  }
  buildCodex();

  document.getElementById('btn-codex').addEventListener('click', function () {
    SuikaAudio.click();
    if (game.state === 'playing') pauseGame();
    codex.classList.remove('hidden');
  });
  document.getElementById('btn-codex-close').addEventListener('click', function () {
    SuikaAudio.click();
    codex.classList.add('hidden');
  });

  /* ---------- 启动 ---------- */
  Renderer.initStars();
  drawNextPreview();
  requestAnimationFrame(frame);
})();
