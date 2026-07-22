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

  function setStatus(msg, isErr) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  /** HTTP 下 clipboard API 常不可用；兼容 select + execCommand */
  function copyText(text) {
    if (!text) return Promise.reject(new Error('没有可复制内容'));

    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      const prevReadOnly = ta.readOnly;
      ta.readOnly = false;
      ta.value = text;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      ta.readOnly = prevReadOnly;
      window.getSelection && window.getSelection().removeAllRanges();
      if (ok) resolve();
      else reject(new Error('复制失败，请手动全选文本框内容'));
    });
  }

  async function createEmptyRoom() {
    const r = await fetch('/api/v1/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empty: true }),
    });
    const data = await r.json().catch(function () {
      return { ok: false, err: '服务器返回无效 JSON（HTTP ' + r.status + '）' };
    });
    if (!r.ok || !data.ok) {
      throw new Error((data && data.err) || '创建失败 HTTP ' + r.status);
    }
    return data;
  }

  function applyRoom(data) {
    ta.value = data.shareText || '';
    if (link && data.spectateUrl) {
      link.href = data.spectateUrl;
      link.textContent = '打开观战页 · 房间 ' + data.code;
      link.style.display = '';
    }
    btnInvite.textContent = '✓ 已开房 ' + data.code;
    setStatus('房间 ' + data.code + ' 已创建。请点「复制给 Agent」，并打开观战页。', false);
    return data;
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
      const data = applyRoom(await createEmptyRoom());
      // 尝试打开观战页（可能被浏览器拦截弹窗，失败也无妨）
      try {
        const w = window.open(data.spectateUrl, '_blank', 'noopener');
        if (!w) {
          setStatus(
            '房间 ' + data.code + ' 已创建。弹窗被拦截：请点下方「打开观战页」链接，并点「复制给 Agent」。',
            false
          );
        }
      } catch (e) {
        /* ignore popup errors */
      }
    } catch (e) {
      ta.value = '创建失败：' + (e.message || e);
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
        // 没有内容时先开房，再复制
        if (!ta.value || ta.value.indexOf('创建失败') === 0) {
          setStatus('尚无文案，先创建房间…', false);
          applyRoom(await createEmptyRoom());
        }
        await copyText(ta.value);
        btnCopy.textContent = '✓ 已复制';
        setStatus('已复制到剪贴板，粘贴发给 Codex 即可。', false);
        setTimeout(function () {
          btnCopy.textContent = '复制给 Agent';
        }, 2000);
      } catch (e) {
        // 最终兜底：选中文本框，提示手动复制
        ta.readOnly = false;
        ta.focus();
        ta.select();
        setStatus((e && e.message) || '请手动 Cmd/Ctrl+C 复制文本框内容', true);
        btnCopy.textContent = '请手动复制';
        setTimeout(function () {
          btnCopy.textContent = '复制给 Agent';
          ta.readOnly = true;
        }, 2500);
      } finally {
        btnCopy.disabled = false;
      }
    });
})();
