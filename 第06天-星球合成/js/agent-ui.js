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
  if (!btnInvite || !ta) return;

  btnDocs &&
    btnDocs.addEventListener('click', function () {
      window.open('/api/v1/docs', '_blank', 'noopener');
    });

  btnInvite.addEventListener('click', async function () {
    btnInvite.disabled = true;
    btnInvite.textContent = '创建中…';
    try {
      const r = await fetch('/api/v1/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty: true }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.err || '创建失败');
      ta.value = data.shareText || '';
      if (link) {
        link.href = data.spectateUrl;
        link.textContent = '打开观战页 · 房间 ' + data.code;
      }
      // 自动打开观战页
      window.open(data.spectateUrl, '_blank', 'noopener');
      btnInvite.textContent = '✓ 已开房 ' + data.code;
    } catch (e) {
      ta.value = '创建失败：' + (e.message || e);
      btnInvite.textContent = '🤖 邀请 Agent';
    } finally {
      btnInvite.disabled = false;
      setTimeout(function () {
        if (btnInvite.textContent.indexOf('已开房') === 0 || btnInvite.textContent.indexOf('✓') === 0) {
          /* keep */
        } else {
          btnInvite.textContent = '🤖 邀请 Agent';
        }
      }, 2000);
    }
  });

  btnCopy &&
    btnCopy.addEventListener('click', async function () {
      if (!ta.value) {
        btnInvite.click();
        return;
      }
      try {
        await navigator.clipboard.writeText(ta.value);
        btnCopy.textContent = '已复制';
        setTimeout(function () {
          btnCopy.textContent = '复制给 Agent';
        }, 1500);
      } catch (e) {
        ta.select();
        document.execCommand('copy');
        btnCopy.textContent = '已复制';
        setTimeout(function () {
          btnCopy.textContent = '复制给 Agent';
        }, 1500);
      }
    });
})();
