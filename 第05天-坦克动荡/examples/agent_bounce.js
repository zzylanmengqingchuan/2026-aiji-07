/**
 * 弹道感知 Agent：读取 bullets[].dx/dz/bounces 预测近距离威胁并垂直闪避。
 * 用法：
 *   node examples/agent_bounce.js http://127.0.0.1:3100 ROOM
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = process.argv[2] || 'http://127.0.0.1:3100';
const CODE = String(process.argv[3] || '').toUpperCase();
if (!CODE) throw new Error('请在第二个参数提供 4 位房间码');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE);
    const data = body ? JSON.stringify(body) : null;
    const req = (u.protocol === 'https:' ? https : http).request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: data ? {'content-type':'application/json','content-length':Buffer.byteLength(data)} : {},
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => raw += chunk);
      res.on('end', () => {
        const parsed = raw ? JSON.parse(raw) : {};
        if (res.statusCode >= 400) reject(new Error(parsed.err || raw));
        else resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function incomingThreat(you, bullets, ownId) {
  let best = null;
  for (const b of bullets || []) {
    if (b.owner === ownId) continue;
    const rx = you.x - b.x;
    const rz = you.z - b.z;
    const along = rx * b.dx + rz * b.dz;
    if (along < 0 || along > 18) continue;
    const closestX = b.x + b.dx * along;
    const closestZ = b.z + b.dz * along;
    const miss = Math.hypot(you.x - closestX, you.z - closestZ);
    if (miss < 3.4 && (!best || along < best.along)) best = { bullet: b, along };
  }
  return best && best.bullet;
}

(async () => {
  const joined = await request('POST', `/api/v1/rooms/${CODE}/join`, {
    name: 'BounceBot', kind: 'agent', agentId: `bounce-${Date.now().toString(36)}`,
  });
  const auth = { playerId: joined.playerId, token: joined.token };
  console.log(`已加入 ${CODE}，等待开局`);

  for (;;) {
    const query = new URLSearchParams(auth).toString();
    const st = await request('GET', `/api/v1/rooms/${CODE}/state?${query}`);
    if (st.phase === 'finished') {
      console.log(JSON.stringify((await request('GET', `/api/v1/rooms/${CODE}/result`)).result, null, 2));
      return;
    }
    const you = st.you;
    const enemy = (st.players || []).find((p) => p.id !== auth.playerId && p.alive);
    if (!you || !you.alive || !enemy) { await sleep(100); continue; }

    const threat = incomingThreat(you, st.bullets, auth.playerId);
    let mx = 0, mz = 0;
    if (threat) {
      // 与来弹方向垂直移动；根据相对位置选远离弹道的一侧。
      const side = Math.sign((you.x - threat.x) * -threat.dz + (you.z - threat.z) * threat.dx) || 1;
      mx = -threat.dz * side;
      mz = threat.dx * side;
    } else {
      const dx = enemy.x - you.x, dz = enemy.z - you.z, n = Math.hypot(dx,dz) || 1;
      mx = dx / n * .35;
      mz = dz / n * .35;
    }
    await request('POST', `/api/v1/rooms/${CODE}/action`, {
      ...auth, mx, mz, aimX: enemy.x, aimZ: enemy.z, fire: true,
    });
    await sleep(50);
  }
})().catch((error) => { console.error(error); process.exit(1); });
