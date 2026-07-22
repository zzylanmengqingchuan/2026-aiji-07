/**
 * 星球合成 · 最小随机 Agent（零依赖，Node 18+ 可用原生 fetch；低版本用 http）
 *
 *   node examples/agent_random.js http://127.0.0.1:3132
 *   node examples/agent_random.js http://175.178.106.164:3132
 *   node examples/agent_random.js http://HOST:3132 ABCD   # 加入已有空房
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = (process.argv[2] || 'http://127.0.0.1:3132').replace(/\/$/, '');
const JOIN_CODE = (process.argv[3] || '').toUpperCase() || null;

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
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error(text || res.statusCode));
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  let code;
  let playerId;
  let token;

  if (JOIN_CODE) {
    const r = await request('POST', `/api/v1/rooms/${JOIN_CODE}/join`, {
      name: 'RandBot',
      kind: 'agent',
      agentId: 'rand-' + Math.random().toString(36).slice(2, 6),
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    code = r.code;
    playerId = r.playerId;
    token = r.token;
    console.log('已加入房间', code);
    console.log('观战（请用户打开）:', r.spectateUrl);
  } else {
    const r = await request('POST', '/api/v1/rooms', {
      name: 'RandBot',
      kind: 'agent',
      agentId: 'rand-host',
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    code = r.code;
    playerId = r.playerId;
    token = r.token;
    console.log('已创建房间', code);
    console.log('观战（请用户打开）:', r.spectateUrl);
    console.log('--- shareText ---\n' + r.shareText + '\n---');
  }

  await request('POST', `/api/v1/rooms/${code}/start`, { playerId, token });
  console.log('已开局，开始随机掉落…');

  while (true) {
    const st = await request(
      'GET',
      `/api/v1/rooms/${code}/state?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`
    );
    if (st.phase === 'over') {
      const res = await request('GET', `/api/v1/rooms/${code}/result`);
      console.log('对局结束');
      console.log(JSON.stringify(res.result, null, 2));
      break;
    }

    if (!st.canDrop) {
      await sleep(80);
      continue;
    }

    // 简单策略：尽量避免堆在最高柱附近——找 x 方向空隙，否则随机
    let aim = 240 + (Math.random() - 0.5) * 160;
    if (st.balls && st.balls.length) {
      const bins = new Array(8).fill(0);
      for (const b of st.balls) {
        const i = Math.min(7, Math.max(0, Math.floor((b.x / 480) * 8)));
        bins[i] = Math.max(bins[i], CFG_H - b.y + b.r); // 越高越危险（用反 y）
      }
      // 用顶部高度：y 越小越高
      const top = new Array(8).fill(720);
      for (const b of st.balls) {
        const i = Math.min(7, Math.max(0, Math.floor((b.x / 480) * 8)));
        top[i] = Math.min(top[i], b.y - b.r);
      }
      let best = 0;
      let bestY = -1;
      for (let i = 0; i < 8; i++) {
        if (top[i] > bestY) {
          bestY = top[i];
          best = i;
        }
      }
      aim = (best + 0.5) * (480 / 8) + (Math.random() - 0.5) * 20;
    }

    const heldR = st.heldR || 22;
    aim = Math.max(10 + heldR, Math.min(470 - heldR, aim));

    const act = await request('POST', `/api/v1/rooms/${code}/action`, {
      playerId,
      token,
      aimX: aim,
      drop: true,
    });
    if (act.dropped) {
      const ev = (st.recentEvents || []).slice(-3);
      console.log(
        `drop aim=${aim.toFixed(0)} score=${st.score} held=${st.heldName} events=${ev.map((e) => e.type + ':' + (e.name || '')).join(',')}`
      );
    }
    await sleep(100);
  }
}

const CFG_H = 720;
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
