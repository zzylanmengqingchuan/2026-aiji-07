/**
 * 最小随机 Agent 示例（兼容 Node 16，无依赖 fetch）
 * 用法：
 *   node examples/agent_random.js http://127.0.0.1:3100
 *   node examples/agent_random.js http://example.com K7P2
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const JOIN_CODE = (process.argv[3] || '').toUpperCase();

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: data
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
            return reject(new Error('bad json: ' + raw.slice(0, 200)));
          }
          if (res.statusCode >= 400 && !parsed.ok) {
            return reject(new Error(JSON.stringify(parsed)));
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  let code, playerId, token;
  if (JOIN_CODE) {
    const r = await request('POST', `/api/v1/rooms/${JOIN_CODE}/join`, {
      name: 'RandBot',
      kind: 'agent',
      agentId: 'rand-' + Math.random().toString(36).slice(2, 6),
    });
    code = JOIN_CODE;
    playerId = r.playerId;
    token = r.token;
    console.log('joined', code, playerId);
  } else {
    const r = await request('POST', '/api/v1/rooms', {
      name: 'RandHost',
      kind: 'agent',
      agentId: 'rand-host',
    });
    code = r.code;
    playerId = r.playerId;
    token = r.token;
    console.log('created', code);
    console.log('观战（请用户打开）:', r.spectateUrl);
    console.log('人类进房:', r.humanAutoJoinUrl);
    console.log('--- 群发文案 ---');
    if (r.shareText) console.log(r.shareText);
  }

  const tryStart = async () => {
    try {
      await request('POST', `/api/v1/rooms/${code}/start`, { playerId, token });
      console.log('start ok');
    } catch (e) {
      /* 人不够会失败，稍后重试 */
    }
  };
  await tryStart();

  for (;;) {
    const st = await request(
      'GET',
      `/api/v1/rooms/${code}/state?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`
    );
    if (st.phase === 'lobby') {
      await tryStart();
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    if (st.phase === 'finished') {
      const res = await request('GET', `/api/v1/rooms/${code}/result`);
      console.log('RESULT', res.result || st.result);
      break;
    }
    const you = st.you || {};
    if (!you.alive) {
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    const enemies = (st.players || []).filter((p) => p.id !== playerId && p.alive);
    let mx = (Math.random() - 0.5) * 2;
    let mz = (Math.random() - 0.5) * 2;
    let aimX = you.x || 0;
    let aimZ = you.z || 0;
    let fire = false;
    if (enemies.length) {
      const e = enemies[(Math.random() * enemies.length) | 0];
      const dx = e.x - you.x;
      const dz = e.z - you.z;
      const n = Math.hypot(dx, dz) || 1;
      mx = dx / n;
      mz = dz / n;
      aimX = e.x;
      aimZ = e.z;
      fire = n < 40 && Math.random() > 0.3;
    }
    // 使用服务端下发的同一份墙表：即将撞墙时横向转开。
    const blocked = (st.walls || []).some((w) =>
      Math.abs((you.x || 0) + mx * 3 - w.x) < w.hw + 2 &&
      Math.abs((you.z || 0) + mz * 3 - w.z) < w.hd + 2
    );
    if (blocked) [mx, mz] = [-mz, mx];
    // 读取炮弹速度做最基础的近身闪避。
    const danger = (st.bullets || []).find((b) =>
      b.owner !== playerId && Math.hypot(b.x - you.x, b.z - you.z) < 10
    );
    if (danger) {
      mx = -danger.dz;
      mz = danger.dx;
    }
    await request('POST', `/api/v1/rooms/${code}/action`, {
      playerId,
      token,
      mx,
      mz,
      aimX,
      aimZ,
      fire,
    });
    await new Promise((r) => setTimeout(r, 50));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
