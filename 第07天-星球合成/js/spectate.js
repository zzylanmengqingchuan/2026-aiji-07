'use strict';
/* 观战模式：轮询服务端 state，渲染 Agent 对局 */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('spectate') !== '1' && params.get('spectate') !== 'true') return;

  const room = (params.get('room') || params.get('code') || '').toUpperCase();
  if (!room) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif">缺少房间号。用法：?spectate=1&room=ABCD</div>';
    return;
  }

  // 阻止本地 game.js 单机逻辑抢控制：通过全局开关
  window.__SUIKA_SPECTATE__ = { room: room };

  const scoreEl = document.getElementById('score');
  const highEl = document.getElementById('high');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;

  // 隐藏开始遮罩，显示观战条
  ['ov-start', 'ov-pause', 'ov-over'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  // 侧栏：Agent 区提示
  const panel = document.getElementById('panel');
  let logEl = document.getElementById('agent-event-log');
  if (panel && !logEl) {
    const block = document.createElement('section');
    block.className = 'card-block agent-watch-block';
    block.innerHTML =
      '<div class="section-title">Agent 观战</div>' +
      '<p class="agent-room">房间 <strong id="watch-room">' +
      room +
      '</strong></p>' +
      '<p class="agent-phase" id="watch-phase">连接中…</p>' +
      '<p class="agent-player" id="watch-player"></p>' +
      '<div class="section-title" style="margin-top:10px">合成过程</div>' +
      '<ul id="agent-event-log" class="event-log"></ul>';
    panel.appendChild(block);
    logEl = document.getElementById('agent-event-log');
  }

  const phaseEl = document.getElementById('watch-phase');
  const playerEl = document.getElementById('watch-player');

  function setupCanvas(c, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupCanvas(canvas, CFG.W, CFG.H);
  if (nextCanvas) setupCanvas(nextCanvas, 96, 96);

  let lastState = null;
  let lastLogSig = '';
  let time = 0;

  function renderState(st) {
    if (!st || !st.ok) return;
    lastState = st;
    if (scoreEl) scoreEl.textContent = st.score || 0;
    if (highEl) highEl.textContent = st.score || 0;
    if (phaseEl) {
      const map = { lobby: '大厅 · 等待 Agent 开局', playing: '对局中', over: '已结束' };
      phaseEl.textContent = map[st.phase] || st.phase;
    }
    if (playerEl && st.player) {
      playerEl.textContent =
        (st.player.kind === 'agent' ? '🤖 ' : '👤 ') +
        st.player.name +
        (st.player.agentId ? ' (' + st.player.agentId + ')' : '');
    }

    // 事件日志
    if (logEl && st.recentEvents) {
      const sig = st.recentEvents
        .map(function (e) {
          return e.t + e.type + (e.name || '') + (e.scoreGained || '');
        })
        .join('|');
      if (sig !== lastLogSig) {
        lastLogSig = sig;
        logEl.innerHTML = '';
        st.recentEvents
          .slice()
          .reverse()
          .forEach(function (e) {
            const li = document.createElement('li');
            if (e.type === 'merge') {
              li.textContent =
                '✨ 合成 ' + e.name + (e.scoreGained != null ? ' +' + e.scoreGained : '');
            } else if (e.type === 'annihilate') {
              li.textContent = '☀ 太阳湮灭' + (e.scoreGained != null ? ' +' + e.scoreGained : '');
            } else if (e.type === 'drop') {
              li.textContent = '↓ 落下 ' + (e.name || '');
            } else {
              li.textContent = e.type;
            }
            logEl.appendChild(li);
          });
      }
    }

    // next preview
    if (nextCtx && typeof drawPlanet === 'function' && st.nextLevel != null) {
      nextCtx.clearRect(0, 0, 96, 96);
      const L = LEVELS[st.nextLevel];
      const r = L.kind === 'ring' ? 24 : Math.min(L.r * 0.6, 34);
      drawPlanet(nextCtx, st.nextLevel, 48, 48, r, 0, time);
    }

    // main canvas
    ctx.clearRect(0, 0, CFG.W, CFG.H);
    if (typeof Renderer !== 'undefined') {
      Renderer.drawBackground(ctx, time);
      Renderer.drawContainer(ctx);
      Renderer.drawLine(ctx, !!st.danger, time);
    }
    if (st.balls) {
      for (let i = 0; i < st.balls.length; i++) {
        const b = st.balls[i];
        drawPlanet(ctx, b.level, b.x, b.y, b.r, b.rot || 0, time);
      }
    }
    if (st.phase === 'playing' && st.heldLevel != null) {
      const r = LEVELS[st.heldLevel].r;
      const x = Math.min(Math.max(st.aimX, CFG.wallL + r), CFG.wallR - r);
      const y = CFG.dropY + Math.sin(time * 3) * 2;
      if (Renderer.drawGuide) Renderer.drawGuide(ctx, x, y, r);
      if (st.dropTimer > 0) ctx.globalAlpha = 0.45;
      drawPlanet(ctx, st.heldLevel, x, y, r, 0, time);
      ctx.globalAlpha = 1;
    }

    if (st.phase === 'over' && st.result) {
      ctx.fillStyle = 'rgba(6,8,24,0.55)';
      ctx.fillRect(0, 0, CFG.W, CFG.H);
      ctx.fillStyle = '#fff';
      ctx.font = '800 22px "DM Sans",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('对局结束', CFG.W / 2, CFG.H / 2 - 30);
      ctx.font = '600 16px "DM Sans",sans-serif';
      ctx.fillStyle = '#ffd75e';
      ctx.fillText('得分 ' + st.result.score, CFG.W / 2, CFG.H / 2 + 4);
      ctx.fillStyle = '#cdd6ff';
      ctx.font = '13px "DM Sans",sans-serif';
      const sum = st.result.summary || '';
      wrapText(ctx, sum, CFG.W / 2, CFG.H / 2 + 36, CFG.W - 40, 18);
    }
  }

  function wrapText(ctx, text, x, y, maxW, lineH) {
    const chars = text.split('');
    let line = '';
    let yy = y;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, yy);
        line = chars[i];
        yy += lineH;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  async function poll() {
    try {
      const r = await fetch('/api/v1/rooms/' + encodeURIComponent(room) + '/state', {
        cache: 'no-store',
      });
      const st = await r.json();
      renderState(st);
    } catch (e) {
      if (phaseEl) phaseEl.textContent = '连接失败，重试中…';
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    time = now / 1000;
    if (lastState) renderState(lastState);
  }

  // 禁用本地单机：去掉 start 按钮逻辑干扰
  const btnStart = document.getElementById('btn-start');
  if (btnStart) {
    btnStart.textContent = '观战中 · 由 Agent 操作';
    btnStart.disabled = true;
  }

  setInterval(poll, 100);
  poll();
  requestAnimationFrame(frame);

  // 若 game.js 已启动 rAF，通过标记让它跳过输入（game.js 需配合）
})();
