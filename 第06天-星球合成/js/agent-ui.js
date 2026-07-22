'use strict';
/* 人类侧：创建空房、复制 shareText、打开观战 */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('spectate') === '1' || params.get('spectate') === 'true') return;

  const btnInvite = document.getElementById('btn-agent-invite');
  const btnDocs = document.getElementById('btn-agent-docs');
  const btnCopy = document.getElementById('btn-agent-copy');
  const ta = document.getElementById('agent-share-text');
  const link = document.getElementById('agent-spectate-link');
  const statusEl = document.getElementById('agent-status');
  if (!btnInvite || !ta) return;

  let lastShare = '';

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  function baseUrl() {
    return location.origin || (location.protocol + '//' + location.host);
  }

  /** 客户端兜底生成文案（避免服务端字段丢失时文本框空白） */
  function buildShareText(code, base) {
    const b = (base || baseUrl()).replace(/\/$/, '');
    const c = String(code || '').toUpperCase();
    return [
      '【星球合成 · Agent 试玩】房间号：' + c,
      '服务器：' + b,
      '',
      '把下面整段发给你的 Agent（如 Codex / Claude Code）：',
      '你要作为选手游玩「星球合成」（Suika 变体，合成大太阳）。这是单人权威服务端局。',
      '服务器 ' + b + '，房间 ' + c + '。',
      '1) POST ' + b + '/api/v1/rooms/' + c + '/join',
      '   {"name":"你的名字","kind":"agent","agentId":"唯一id"}',
      '2) 保存 playerId、token',
      '3) POST ' + b + '/api/v1/rooms/' + c + '/start  {"playerId":"...","token":"..."}',
      '4) 循环：GET .../state?playerId&token → 决策 → POST .../action',
      '   action 示例：{"playerId":"...","token":"...","aimX":240,"drop":true}',
      '   仅当 state.canDrop===true 时 drop 才会落下',
      '5) phase=over 后 GET .../result 汇报得分与合成过程',
      '规则：同级球碰撞合成；得分=三角数×连击；两太阳湮灭 150×连击；超警戒线约 2.2 秒失败。',
      '完整文档：' + b + '/api/v1/docs',
      '人类观战：' + b + '/?spectate=1&room=' + c,
    ].join('\n');
  }

  /**
   * 可靠复制：优先 Clipboard API；否则用临时 textarea + execCommand
   * （站点为 HTTP 时 Clipboard API 不可用，且 body user-select:none 会干扰原 textarea）
   */
  function copyText(text) {
    text = String(text || '');
    if (!text.trim()) {
      return Promise.reject(new Error('没有可复制内容（文案为空）'));
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return 'clipboard';
      });
    }

    return new Promise(function (resolve, reject) {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.cssText =
        'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;opacity:0;z-index:99999;';
      document.body.appendChild(el);
      el.focus();
      el.select();
      el.setSelectionRange(0, el.value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      document.body.removeChild(el);
      if (ok) resolve('execCommand');
      else reject(new Error('系统复制失败'));
    });
  }

  async function createEmptyRoom() {
    const r = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empty: true }),
    });
    const raw = await r.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error('服务器返回非 JSON（HTTP ' + r.status + '）：' + raw.slice(0, 80));
    }
    if (!r.ok || !data.ok) {
      throw new Error((data && data.err) || '创建失败 HTTP ' + r.status);
    }
    return data;
  }

  function applyRoom(data) {
    const code = data.code;
    const spectateUrl =
      data.spectateUrl || baseUrl() + '/?spectate=1&room=' + encodeURIComponent(code);
    const share =
      (data.shareText && String(data.shareText).trim()) ||
      buildShareText(code, data.humanUrl && data.humanUrl.replace(/\/$/, ''));

    lastShare = share;
    ta.value = share;
    ta.readOnly = false;
    // 选中方便用户 Cmd+C
    try {
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
    } catch (e) {
      /* ignore */
    }

    if (link) {
      link.href = spectateUrl;
      link.textContent = '打开观战页 · 房间 ' + code;
      link.style.display = 'block';
    }
    btnInvite.textContent = '✓ 已开房 ' + code;
    setStatus(
      '房间 ' + code + ' · 文案 ' + share.length + ' 字已填入下方。请点「复制给 Agent」，或直接 Cmd+C。',
      false
    );
    return { code: code, share: share, spectateUrl: spectateUrl };
  }

  btnDocs &&
    btnDocs.addEventListener('click', function () {
      window.open('/api/v1/docs', '_blank', 'noopener');
    });

  btnInvite.addEventListener('click', async function () {
    btnInvite.disabled = true;
    btnInvite.textContent = '创建中…';
    setStatus('正在创建房间…', false);
    try {
      const room = applyRoom(await createEmptyRoom());
      try {
        const w = window.open(room.spectateUrl, '_blank', 'noopener');
        if (!w) {
          setStatus(
            '房间 ' +
              room.code +
              ' 已创建（文案 ' +
              room.share.length +
              ' 字）。弹窗被拦截，请点「打开观战页」，并点「复制给 Agent」。',
            false
          );
        }
      } catch (e) {
        /* ignore */
      }
    } catch (e) {
      lastShare = '';
      ta.value = '';
      btnInvite.textContent = '🤖 邀请 Agent';
      setStatus('创建失败：' + (e.message || e), true);
    } finally {
      btnInvite.disabled = false;
    }
  });

  btnCopy &&
    btnCopy.addEventListener('click', async function () {
      btnCopy.disabled = true;
      try {
        let text = (lastShare || ta.value || '').trim();
        if (!text || text.indexOf('创建失败') === 0) {
          setStatus('尚无文案，先创建房间…', false);
          const room = applyRoom(await createEmptyRoom());
          text = room.share;
        }

        // 同步写入文本框，确保用户能看见
        ta.value = text;
        lastShare = text;

        try {
          const method = await copyText(text);
          btnCopy.textContent = '✓ 已复制';
          setStatus(
            '已复制 ' + text.length + ' 字（' + method + '）。去 Codex 里粘贴（Cmd+V）即可。',
            false
          );
        } catch (copyErr) {
          // 复制失败：选中文本框 + 弹出可手动复制的提示
          ta.readOnly = false;
          ta.focus();
          ta.select();
          setStatus(
            '自动复制失败，已选中下方全文：请按 Cmd+C（Windows: Ctrl+C）手动复制。共 ' +
              text.length +
              ' 字。',
            true
          );
          btnCopy.textContent = '请按 Cmd+C';
          // 再用 prompt 兜底（部分浏览器可从中复制）
          try {
            window.prompt('自动复制失败，请全选并复制以下内容：', text);
          } catch (e2) {
            /* ignore */
          }
        }

        setTimeout(function () {
          btnCopy.textContent = '复制给 Agent';
        }, 2500);
      } catch (e) {
        setStatus('失败：' + (e.message || e), true);
        btnCopy.textContent = '复制给 Agent';
      } finally {
        btnCopy.disabled = false;
      }
    });
})();
