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

  function renderItems(el, items, showRank) {
    if (!items.length) {
      el.innerHTML = '<li class="lb-empty">暂无成绩，来打一局吧</li>';
      return;
    }
    el.innerHTML = items
      .map((r) => {
        const badge = r.kind === 'agent' ? '<span class="lb-badge agent">A</span>' : '<span class="lb-badge human">人</span>';
        const extras = [
          r.maxLevelName ? '最高「' + esc(r.maxLevelName) + '」' : '',
          r.sunBorn ? '☀×' + r.sunBorn : '',
          r.annihilations ? '湮灭×' + r.annihilations : '',
        ].filter(Boolean).join(' · ');
        return (
          '<li>' +
          (showRank ? '<span class="lb-rank">' + r.rank + '</span>' : '<span class="lb-rank lb-dot">·</span>') +
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

  async function loadMine() {
    if (!meListEl) return;
    const name = getName();
    if (!name) {
      meListEl.innerHTML = '<li class="lb-empty">输入名字后显示你的历史</li>';
      return;
    }
    try {
      const r = await fetch('/api/v1/history?name=' + encodeURIComponent(name) + '&limit=20');
      const d = await r.json();
      if (d.ok) renderItems(meListEl, d.items, false);
    } catch (e) {
      /* 网络失败静默 */
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
      loadBoard();
      loadMine();
    },
    refresh: loadBoard,
  };

  loadBoard();
  loadMine();
  setInterval(loadBoard, 30000);
})();
