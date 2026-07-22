/**
 * 星球合成 · 策略 Agent（零依赖，Node 18+ 可用原生 fetch；低版本用 http）
 *
 * 策略：
 *  - 大球固定堆左墙，从左到右按等级降序（同级相邻才能连锁）
 *  - 有暴露的同级球时优先直接砸上去合成
 *  - 落球后等场上球停稳再决策下一次；刚发生合成则加快节奏保连击
 *  - 危险（接近警戒线）时转入救场模式：优先任意合成 / 往最低处放
 *
 *   node examples/agent_strategy.js http://127.0.0.1:3133
 *   node examples/agent_strategy.js http://175.178.106.164:3132
 *   node examples/agent_strategy.js http://HOST:3132 ABCD   # 加入已有空房
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = (process.argv[2] || 'http://127.0.0.1:3133').replace(/\/$/, '');
const JOIN_CODE = (process.argv[3] || '').toUpperCase() || null;

const WALL_L = 10;
const WALL_R = 470;
const LINE_Y = 132;
const LEVEL_R = [22, 30, 38, 46, 55, 64, 74, 84, 95, 107, 120];
const LEVEL_NAME = ['陨石', '月球', '水星', '火星', '金星', '地球', '海王星', '天王星', '土星', '木星', '太阳'];

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampAim(x, r) {
  return Math.max(WALL_L + r, Math.min(WALL_R - r, x));
}

/** 表面球：竖直通道上方没有其他球遮挡（可被砸到） */
function exposedBalls(balls) {
  return balls.filter(
    (t) =>
      !balls.some(
        (b) => b !== t && b.y < t.y - 5 && Math.abs(b.x - t.x) < (b.r + t.r) * 0.72
      )
  );
}

/** 场地最高点的 y（越小越危险） */
function pileTop(balls) {
  let top = 720;
  for (const b of balls) top = Math.min(top, b.y - b.r);
  return top;
}

/** 每个 x 格子的堆顶高度（y 越小越高） */
function heightProfile(balls) {
  const N = 12;
  const top = new Array(N).fill(706);
  for (const b of balls) {
    const i = Math.min(N - 1, Math.max(0, Math.floor(((b.x - WALL_L) / (WALL_R - WALL_L)) * N)));
    top[i] = Math.min(top[i], b.y - b.r);
  }
  return top;
}

/**
 * 决策落点：
 * 1. 有暴露同级球 → 直接砸上去合成（危险模式选最高的，否则选最低的——大球压底）
 * 2. 否则按「左大右小」插入：找到最右的 level>=L 的球，落在它右侧坡上滚入缝隙
 * 3. L 比全场都大 → 放最左；危险模式 → 放最低区域
 */
function decide(st) {
  const L = st.heldLevel;
  const r = st.heldR || LEVEL_R[L];
  const balls = st.balls || [];
  const dangerMode = st.danger || pileTop(balls) < LINE_Y + 70;

  const sameLevel = exposedBalls(balls).filter((b) => b.level === L);
  if (sameLevel.length) {
    let target;
    if (dangerMode) {
      target = sameLevel.reduce((a, b) => (a.y < b.y ? a : b)); // 最高的，尽快降高度
    } else {
      // 最低的同级球：合成后新大球位置低，不顶高堆
      target = sameLevel.reduce((a, b) => (a.y > b.y ? a : b));
    }
    return clampAim(target.x, r);
  }

  if (dangerMode) {
    // 救场：往堆得最低的区域放
    const prof = heightProfile(balls);
    let best = 0;
    for (let i = 1; i < prof.length; i++) if (prof[i] > prof[best]) best = i;
    return clampAim(WALL_L + ((best + 0.5) / prof.length) * (WALL_R - WALL_L), r);
  }

  // 插入点：最右的 level>=L 的球（anchor）与其右邻之间的山谷
  const sorted = balls.slice().sort((a, b) => a.x - b.x);
  let anchor = null;
  let rightN = null;
  for (const b of sorted) {
    if (b.level >= L) {
      anchor = b;
    } else if (anchor && !rightN) {
      rightN = b; // anchor 右侧第一个更小的球
    }
  }
  if (!anchor) return clampAim(WALL_L + r + 2, r); // L 全场最大 → 最左
  if (rightN) {
    const gap = rightN.x - rightN.r - (anchor.x + anchor.r); // 缝隙净宽
    if (gap >= r * 1.8) {
      // 山谷能容纳：瞄谷中心，球落进去卡住
      return clampAim((anchor.x + anchor.r + rightN.x - rightN.r) / 2, r);
    }
  }
  // 没有合适山谷：瞄 anchor 右侧坡，让球滚到它右边
  return clampAim(anchor.x + anchor.r * 0.55, r);
}

function settled(st) {
  return (st.balls || []).every((b) => Math.abs(b.vx) < 30 && Math.abs(b.vy) < 30);
}

async function main() {
  let code, playerId, token;

  if (JOIN_CODE) {
    const r = await request('POST', `/api/v1/rooms/${JOIN_CODE}/join`, {
      name: 'KimiBot',
      kind: 'agent',
      agentId: 'kimi-' + Math.random().toString(36).slice(2, 6),
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    ({ code, playerId, token } = r);
    console.log('已加入房间', code);
    console.log('观战:', r.spectateUrl);
  } else {
    const r = await request('POST', '/api/v1/rooms', {
      name: 'KimiBot',
      kind: 'agent',
      agentId: 'kimi-host',
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    ({ code, playerId, token } = r);
    console.log('已创建房间', code);
    console.log('观战:', r.spectateUrl);
  }

  await request('POST', `/api/v1/rooms/${code}/start`, { playerId, token });
  console.log('开局，策略运行中…');

  const getState = () =>
    request(
      'GET',
      `/api/v1/rooms/${code}/state?playerId=${encodeURIComponent(playerId)}&token=${encodeURIComponent(token)}`
    );

  let drops = 0;
  while (true) {
    let st = await getState();
    if (st.phase === 'over') break;
    if (!st.canDrop) {
      await sleep(70);
      continue;
    }

    const aim = decide(st);
    const act = await request('POST', `/api/v1/rooms/${code}/action`, {
      playerId,
      token,
      aimX: Math.round(aim * 10) / 10,
      drop: true,
    });
    if (act.dropped) drops++;
    const dropAt = Date.now();

    // 等停稳；若刚发生合成（comboTimer>0）则缩短等待保连击
    while (true) {
      await sleep(100);
      st = await getState();
      if (st.phase === 'over') break;
      if (!st.canDrop) continue;
      const urgent = st.comboTimer > 0;
      const cap = urgent ? 700 : 2500;
      if (settled(st) || Date.now() - dropAt > cap) break;
    }

    if (drops % 10 === 0 || st.combo >= 3 || st.danger) {
      const top = pileTop(st.balls || []);
      console.log(
        `drops=${drops} score=${st.score} combo=${st.combo} balls=${(st.balls || []).length} top=${top.toFixed(0)}${st.danger ? ' DANGER' : ''}`
      );
    }
    if (st.phase === 'over') break;
  }

  const res = await request('GET', `/api/v1/rooms/${code}/result`);
  const r = res.result || res;
  console.log('=== 对局结束 ===');
  console.log('房间:', code);
  console.log('得分:', r.score, '| 最高级:', r.maxLevelName || r.maxLevel, '| 太阳:', r.sunBorn, '| 湮灭:', r.annihilations, '| 落球:', r.drops);
  if (r.summary) console.log('摘要:', r.summary);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
