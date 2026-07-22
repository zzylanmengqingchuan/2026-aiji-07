'use strict';
/* 排行榜 + 个人历史：Agent 成绩服务端权威记录，人类成绩结算时自行上报（荣誉制） */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('spectate') === '1' || params.get('spectate') === 'true') return;

  const listEl = document.getElementById('lb-list');
  const meListEl = document.getElementById('lb-me');
  const nameInput = document.getElementById('lb-name');
  const tabs = document.querySelectorAll('.lb-tabs button');
  if (!listEl) return;

  const NAME_KEY = 'planetMerge_playerName';
  let kind = 'all';

  function getName() {
    return (nameInput && nameInput.value.trim()) || localStorage.getItem(NAME_KEY) || '';
  }

  if (nameInput) {
    nameInput.value = localStorage.getItem(NAME_KEY) || '';
    nameInput.addEventListener('change', function () {
      localStorage.setItem(NAME_KEY, nameInput.value.trim().slice(0, 12));
      mergeServerHistory();
      loadMine();
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function rankLabel(rank) {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank);
  }

  function renderItems(el, items, showRank) {
    if (!items.length) {
      el.innerHTML = '<li class="lb-empty">暂无成绩，来打一局吧</li>';
      return;
    }
    el.innerHTML = items
      .map((r) => {
        const badge = r.kind === 'agent' ? '<span class="lb-badge agent">Agent</span>' : '<span class="lb-badge human">人类</span>';
        const extras = [
          r.maxLevelName ? '最高「' + esc(r.maxLevelName) + '」' : '',
          r.sunBorn ? '☀×' + r.sunBorn : '',
          r.annihilations ? '湮灭×' + r.annihilations : '',
        ].filter(Boolean).join(' · ');
        return (
          '<li>' +
          (showRank ? '<span class="lb-rank">' + rankLabel(r.rank) + '</span>' : '<span class="lb-rank lb-dot">·</span>') +
          badge +
          '<span class="lb-name">' + esc(r.name) + '</span>' +
          '<span class="lb-score">' + r.score + '</span>' +
          '<span class="lb-meta">' + extras + (extras ? ' · ' : '') + fmtDate(r.finishedAt) + '</span>' +
          '</li>'
        );
      })
      .join('');
  }

  async function loadBoard() {
    try {
      const r = await fetch('/api/v1/leaderboard?kind=' + kind + '&limit=30');
      const d = await r.json();
      if (d.ok) renderItems(listEl, d.items, true);
    } catch (e) {
      /* 网络失败静默 */
    }
  }

  /* 个人历史只存本机浏览器，不上服务器（隐私） */
  const MY_GAMES_KEY = 'planetMerge_myGames';

  function readMyGames() {
    try {
      return JSON.parse(localStorage.getItem(MY_GAMES_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveMyGame(score, maxLevelName) {
    const games = readMyGames();
    games.push({ score, maxLevelName: maxLevelName || null, ts: Date.now() });
    localStorage.setItem(MY_GAMES_KEY, JSON.stringify(games.slice(-100)));
  }

  function loadMine() {
    if (!meListEl) return;
    const games = readMyGames().sort((a, b) => b.score - a.score).slice(0, 20);
    if (!games.length) {
      meListEl.innerHTML = '<li class="lb-empty">还没有本机记录，去打一局吧</li>';
      return;
    }
    renderItems(
      meListEl,
      games.map((g) => ({
        name: getName() || '我',
        kind: 'human',
        score: g.score,
        maxLevelName: g.maxLevelName,
        finishedAt: g.ts,
      })),
      false
    );
  }

  /* 迁移兜底：把历史上报过的同名牌记录合并进本机（只跑一次，去重） */
  let serverMerged = false;
  async function mergeServerHistory() {
    const name = getName();
    if (!name || serverMerged) return;
    serverMerged = true;
    try {
      const r = await fetch('/api/v1/history?name=' + encodeURIComponent(name) + '&limit=100');
      const d = await r.json();
      if (!d.ok || !d.items) return;
      const games = readMyGames();
      const seen = new Set(games.map((g) => g.ts + ':' + g.score));
      for (const it of d.items) {
        const key = it.finishedAt + ':' + it.score;
        if (!seen.has(key)) {
          games.push({ score: it.score, maxLevelName: it.maxLevelName || null, ts: it.finishedAt });
        }
      }
      games.sort((a, b) => b.ts - a.ts);
      localStorage.setItem(MY_GAMES_KEY, JSON.stringify(games.slice(-100)));
      loadMine();
    } catch (e) {
      /* 合并失败不影响本地记录 */
    }
  }

  tabs.forEach((btn) => {
    btn.addEventListener('click', function () {
      tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      kind = btn.dataset.kind;
      loadBoard();
    });
  });

  /* 人类结算时由 game.js 调用 */
  window.SuikaLeaderboard = {
    async onGameOver(score, maxLevelName) {
      if (!Number.isFinite(score) || score <= 0) return;
      let name = getName();
      if (!name) {
        try {
          name = (window.prompt('输入名字，上排行榜（可随时在排行榜区修改）:') || '').trim().slice(0, 12);
        } catch (e) {
          name = '';
        }
        if (!name) return;
        if (nameInput) nameInput.value = name;
        localStorage.setItem(NAME_KEY, name);
      }
      try {
        await fetch('/api/v1/scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, score, maxLevelName: maxLevelName || null }),
        });
      } catch (e) {
        /* 上报失败不影响游戏 */
      }
      // 个人历史只存本机，不上传
      saveMyGame(score, maxLevelName);
      loadBoard();
      loadMine();
    },
    refresh: loadBoard,
  };

  loadBoard();
  mergeServerHistory();
  loadMine();
  setInterval(loadBoard, 30000);
})();
