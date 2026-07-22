'use strict';
/**
 * 星球合成 · 静态资源 + Agent REST API + 观战
 * 零依赖：Node 内置 http / fs / path / url / crypto
 * 启动：PORT=3132 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const {
  CFG,
  LEVELS,
  mergeScore,
  GameSession,
  roomCode,
  playerId,
  token,
} = require('./lib/engine');

const PORT = Number(process.env.PORT) || 3132;
const ROOT = __dirname;
const STEP = 1 / 60;
const ROOM_TTL_MS = 45 * 60 * 1000;
const RESULT_TTL_MS = 30 * 60 * 1000;

const rooms = new Map(); // code -> GameSession
const resultArchive = new Map(); // code -> result

// ---- 成绩持久化（JSONL，无需数据库）----
const DATA_DIR = path.join(ROOT, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'results.jsonl');
fs.mkdirSync(DATA_DIR, { recursive: true });

function persistResult(rec) {
  try {
    fs.appendFileSync(RESULTS_FILE, JSON.stringify(rec) + '\n');
  } catch (e) {
    console.error('[persistResult]', e.message);
  }
}

function readResults() {
  let lines;
  try {
    lines = fs.readFileSync(RESULTS_FILE, 'utf8').split('\n');
  } catch (e) {
    return [];
  }
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {
      /* 跳过坏行 */
    }
  }
  return out;
}

function resultRecord(room) {
  const r = room.result;
  const p = r.player || {};
  return {
    code: r.code,
    name: String(p.name || 'Agent').slice(0, 24),
    kind: p.kind === 'human' ? 'human' : 'agent',
    agentId: p.agentId || null,
    score: r.score,
    drops: r.drops,
    maxLevelName: r.maxLevelName,
    sunBorn: r.sunBorn,
    annihilations: r.annihilations,
    durationSec: r.durationSec,
    finishedAt: r.finishedAt,
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function publicBase(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `127.0.0.1:${PORT}`;
  return `${proto}://${host}`;
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 256 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function roomLinks(base, code, pid, tok) {
  const docsUrl = `${base}/api/v1/docs`;
  const spectateUrl = `${base}/?spectate=1&room=${encodeURIComponent(code)}`;
  const humanUrl = `${base}/`;
  const shareText = [
    `【星球合成 · Agent 试玩】房间号：${code}`,
    `服务器：${base}`,
    ``,
    `把下面整段发给你的 Agent（如 Codex / Claude Code）：`,
    `你要作为选手游玩「星球合成」（Suika 变体，合成大太阳）。这是单人权威服务端局。`,
    `服务器 ${base}，房间 ${code}。`,
    `1) POST ${base}/api/v1/rooms/${code}/join`,
    `   {"name":"你的名字","kind":"agent","agentId":"唯一id"}`,
    `   （若房间已有人则失败；也可直接 POST ${base}/api/v1/rooms 自己开房）`,
    `2) 保存 playerId、token`,
    `3) POST ${base}/api/v1/rooms/${code}/start  {"playerId":"...","token":"..."}`,
    `4) 循环：GET .../state?playerId&token → 决策 → POST .../action`,
    `   action 示例：{"playerId":"...","token":"...","aimX":240,"drop":true}`,
    `   仅当 state.canDrop===true 时 drop 才会落下`,
    `   强烈建议：写一个自动策略脚本循环跑（毫秒级决策），不要靠你一步步人工推理——`,
    `   连击窗口只有 1.5 秒，慢了连击全断，分数会差很多`,
    `5) phase=over 后 GET .../result 汇报得分与合成过程`,
    `6) 接入成功后，立刻在终端运行 open '${spectateUrl}'（macOS；Linux 用 xdg-open）`,
    `   为观察者弹出观战窗口，然后直接开始玩，不要再等用户操作`,
    `规则摘要：同级球碰撞合成更高级；合成得分=三角数×连击；两太阳湮灭得150×连击；堆过警戒线约2.2秒失败。`,
    `策略要点：大球固定堆一侧、小球放另一侧，同级相邻才能连锁；别让小球卡进大球缝隙；`,
    `         利用 heldLevel+nextLevel 规划连续两球落点，尽量一次落下触发多次链式合成冲连击。`,
    `完整文档：${docsUrl}`,
    `人类观战：${spectateUrl}`,
  ].join('\n');

  return {
    humanUrl,
    spectateUrl,
    agentDocUrl: docsUrl,
    docsUrl,
    shareText,
    stateUrl: pid
      ? `${base}/api/v1/rooms/${code}/state?playerId=${encodeURIComponent(pid)}&token=${encodeURIComponent(tok)}`
      : `${base}/api/v1/rooms/${code}/state`,
    actionUrl: `${base}/api/v1/rooms/${code}/action`,
    resultUrl: `${base}/api/v1/rooms/${code}/result`,
    startUrl: `${base}/api/v1/rooms/${code}/start`,
  };
}

function getAuth(room, playerIdStr, tokenStr) {
  if (!room || !room.player) return null;
  if (room.player.id === playerIdStr && room.player.token === tokenStr) return room.player;
  return null;
}

function ensureRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

function archiveIfOver(room) {
  if (room.phase === 'over' && room.result) {
    resultArchive.set(room.code, room.result);
    if (!room._persisted) {
      room._persisted = true;
      persistResult(resultRecord(room));
    }
  }
}

// ---- 全局 60Hz 模拟 ----
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.phase === 'playing') {
      room.tick(STEP);
      if (room.phase === 'over') archiveIfOver(room);
    }
    if (now - room.lastTouchedAt > ROOM_TTL_MS) {
      archiveIfOver(room);
      rooms.delete(code);
    }
  }
  for (const [code, r] of resultArchive) {
    if (now - (r.finishedAt || 0) > RESULT_TTL_MS) resultArchive.delete(code);
  }
}, 1000 / 60);

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    });
    res.end();
    return true;
  }

  const p = url.pathname;

  if (req.method === 'GET' && p === '/health') {
    sendJson(res, 200, {
      ok: true,
      name: 'suika-merge',
      title: '星球合成 · 合成大太阳',
      version: '2-0-agent',
      theme: 'soft-pop',
      layout: 'left-intro-options-right-stage',
      agent: true,
      rooms: rooms.size,
    });
    return true;
  }

  if (req.method === 'GET' && p === '/api/v1/docs') {
    sendJson(res, 200, {
      name: 'Planet Merge (Suika) Agent API',
      version: '2.0',
      mode: 'single-player-authoritative',
      summary:
        '单人合成游戏。Agent 通过 REST 创建/加入房间、开局、观测 state、drop 落球；人类用 spectateUrl 实时观看合成过程。',
      rules: {
        levels: LEVELS.map((L, i) => ({
          index: i,
          name: L.name,
          r: L.r,
          mergeScore: i === 0 ? 0 : mergeScore(i),
        })),
        spawnLevels: CFG.spawnLevels,
        dropCooldownSec: CFG.dropCooldown,
        lineY: CFG.lineY,
        overLineTimeSec: CFG.overLineTime,
        comboWindowSec: CFG.comboWindow,
        annihilateScore: '150 * combo',
        mergeScoreFormula: 'levelIdx+1 的三角数 × combo；level 从 0 起',
        goal: '合成太阳（最高级）并尽量高分；堆过警戒线失败',
      },
      strategy: [
        '大球固定堆一侧（如从左墙开始按大到小排），小球放另一侧，同级相邻才能连锁合成',
        '不要让小球滚进大球之间的缝隙，会堵死后续合成路径',
        'heldLevel 与 nextLevel 都已知：一次决策规划好连续两球的落点',
        'combo 窗口 1.5s：一次落下触发多次链式合成可叠连击，得分=三角数×combo，连击是冲分关键',
        '建议写自动策略脚本循环跑（毫秒级决策），不要逐步人工推理，否则连击全断',
        'drop 冷却 0.55s；落下后等场上球停稳（balls 的 vx/vy≈0）再做下一次决策',
        '堆高接近 lineY 时优先把新球放到空旷一侧救场，避免单点堆死',
        '两个太阳相遇湮灭得 150×combo，是后期冲分关键',
      ],
      flow: [
        '1. POST /api/v1/rooms 创建（Agent 自己开房）或人类创建 empty 房后 Agent join',
        '2. 把 spectateUrl 给人类打开观战',
        '3. POST .../start',
        '4. 循环 GET state + POST action（aimX + drop）',
        '5. phase=over 后 GET result',
      ],
      endpoints: {
        'POST /api/v1/rooms': {
          body: { name: 'string', kind: 'agent|human', agentId: 'string?', empty: 'bool? 空房等人 join' },
        },
        'POST /api/v1/rooms/:code/join': {
          body: { name: 'string', kind: 'agent|human', agentId: 'string?' },
          note: '单人局仅 1 个选手位',
        },
        'POST /api/v1/rooms/:code/start': { body: { playerId: 'string', token: 'string' } },
        'GET /api/v1/rooms/:code/state': {
          query: { playerId: 'optional', token: 'optional' },
          note: '无鉴权也可观战（只读）',
        },
        'POST /api/v1/rooms/:code/action': {
          body: {
            playerId: 'string',
            token: 'string',
            aimX: 'number?',
            aimDx: 'number?',
            drop: 'boolean?',
          },
        },
        'GET /api/v1/rooms/:code/result': '终局结果（结束后约 30 分钟可查）',
        'GET /api/v1/rooms/:code': '房间摘要',
        'GET /api/v1/leaderboard?kind=all|agent|human&limit=30': '排行榜（分数降序）',
        'GET /api/v1/history?name=xx&limit=50': '个人历史（分数降序）',
        'POST /api/v1/scores': { body: { name: 'string', score: 'number', maxLevelName: 'string?' }, note: '人类成绩上报（荣誉制）' },
      },
      coordinate: {
        note: '2D Canvas 逻辑像素，原点左上，x 向右，y 向下',
        W: CFG.W,
        H: CFG.H,
        wallL: CFG.wallL,
        wallR: CFG.wallR,
        floorY: CFG.floorY,
        lineY: CFG.lineY,
        dropY: CFG.dropY,
      },
      rateHint: '建议 5～15 次 state/秒；drop 冷却 0.55s，勿在 canDrop=false 时狂 drop',
    });
    return true;
  }

  // GET /api/v1/leaderboard?kind=all|agent|human&limit=30 —— 排行榜（分数降序）
  if (req.method === 'GET' && p === '/api/v1/leaderboard') {
    const kind = (url.searchParams.get('kind') || 'all').toLowerCase();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '30', 10) || 30, 1), 100);
    let items = readResults();
    if (kind === 'agent' || kind === 'human') items = items.filter((r) => r.kind === kind);
    items.sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);
    sendJson(res, 200, {
      ok: true,
      kind,
      total: items.length,
      items: items.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
    });
    return true;
  }

  // GET /api/v1/history?name=xx&limit=50 —— 个人历史（分数降序）
  if (req.method === 'GET' && p === '/api/v1/history') {
    const name = String(url.searchParams.get('name') || '').trim();
    if (!name) {
      sendJson(res, 400, { ok: false, err: '缺少 name' });
      return true;
    }
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
    const items = readResults()
      .filter((r) => r.name === name)
      .sort((a, b) => b.score - a.score || a.finishedAt - b.finishedAt);
    sendJson(res, 200, { ok: true, name, total: items.length, items: items.slice(0, limit) });
    return true;
  }

  // POST /api/v1/scores —— 人类成绩上报（荣誉制；Agent 成绩由服务端自动权威记录）
  if (req.method === 'POST' && p === '/api/v1/scores') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, 400, { ok: false, err: e.message });
      return true;
    }
    const name = String(body.name || '').trim().slice(0, 24);
    const score = Math.floor(Number(body.score));
    if (!name) {
      sendJson(res, 400, { ok: false, err: '缺少 name' });
      return true;
    }
    if (!Number.isFinite(score) || score < 0 || score > 10000000) {
      sendJson(res, 400, { ok: false, err: 'score 非法' });
      return true;
    }
    persistResult({
      code: null,
      name,
      kind: 'human',
      agentId: null,
      score,
      drops: Math.max(0, Math.floor(Number(body.drops) || 0)) || null,
      maxLevelName: String(body.maxLevelName || '').slice(0, 8) || null,
      sunBorn: null,
      annihilations: null,
      durationSec: null,
      finishedAt: Date.now(),
    });
    sendJson(res, 200, { ok: true });
    return true;
  }

  // POST /api/v1/rooms
  if (req.method === 'POST' && p === '/api/v1/rooms') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJson(res, 400, { ok: false, err: e.message });
      return true;
    }
    const base = publicBase(req);

    // 空房：人类先开观战，再让 Agent join
    if (body.empty || body.mode === 'agent_lobby') {
      let code;
      do {
        code = roomCode();
      } while (rooms.has(code));
      const room = new GameSession(code);
      rooms.set(code, room);
      const links = roomLinks(base, code, null, null);
      sendJson(res, 200, {
        ok: true,
        code,
        empty: true,
        phase: room.phase,
        ...links,
        openSpectateHint: '请立即打开 spectateUrl 观战，再把 shareText 发给 Agent',
      });
      return true;
    }

    let code;
    do {
      code = roomCode();
    } while (rooms.has(code));
    const room = new GameSession(code);
    const id = playerId();
    const tok = token();
    const kind = body.kind === 'human' ? 'human' : 'agent';
    room.setPlayer({
      id,
      token: tok,
      name: String(body.name || (kind === 'agent' ? 'Agent' : '玩家')).slice(0, 24),
      kind,
      agentId: body.agentId ? String(body.agentId).slice(0, 64) : null,
    });
    rooms.set(code, room);
    const links = roomLinks(base, code, id, tok);
    sendJson(res, 200, {
      ok: true,
      code,
      playerId: id,
      token: tok,
      phase: room.phase,
      ...links,
      openSpectateHint: '请用户浏览器打开 spectateUrl 即可实时观看 Agent 合成过程',
    });
    return true;
  }

  // /api/v1/rooms/:code/...
  const m = p.match(/^\/api\/v1\/rooms\/([A-Za-z0-9]+)(?:\/(join|start|state|action|result))?$/);
  if (m) {
    const code = m[1].toUpperCase();
    const action = m[2] || '';
    const room = ensureRoom(code);
    const base = publicBase(req);

    if (req.method === 'POST' && action === 'join') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        sendJson(res, 400, { ok: false, err: e.message });
        return true;
      }
      if (!room) {
        sendJson(res, 404, { ok: false, err: '房间不存在' });
        return true;
      }
      if (room.player) {
        sendJson(res, 400, { ok: false, err: '房间已有选手（单人局）' });
        return true;
      }
      if (room.phase !== 'lobby') {
        sendJson(res, 400, { ok: false, err: '房间已开始或已结束' });
        return true;
      }
      const id = playerId();
      const tok = token();
      const kind = body.kind === 'human' ? 'human' : 'agent';
      room.setPlayer({
        id,
        token: tok,
        name: String(body.name || (kind === 'agent' ? 'Agent' : '玩家')).slice(0, 24),
        kind,
        agentId: body.agentId ? String(body.agentId).slice(0, 64) : null,
      });
      room.touch();
      sendJson(res, 200, {
        ok: true,
        code,
        playerId: id,
        token: tok,
        phase: room.phase,
        ...roomLinks(base, code, id, tok),
      });
      return true;
    }

    if (req.method === 'POST' && action === 'start') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        sendJson(res, 400, { ok: false, err: e.message });
        return true;
      }
      if (!room) {
        sendJson(res, 404, { ok: false, err: '房间不存在' });
        return true;
      }
      const me = getAuth(room, body.playerId, body.token);
      if (!me) {
        sendJson(res, 401, { ok: false, err: '鉴权失败' });
        return true;
      }
      const r = room.start();
      if (!r.ok) {
        sendJson(res, 400, r);
        return true;
      }
      sendJson(res, 200, { ok: true, phase: room.phase, seed: room.seed });
      return true;
    }

    if (req.method === 'GET' && (action === 'state' || action === '')) {
      if (!room) {
        const archived = resultArchive.get(code);
        if (archived) {
          sendJson(res, 200, {
            ok: true,
            code,
            phase: 'over',
            result: archived,
            archived: true,
            balls: [],
            score: archived.score,
          });
          return true;
        }
        if (action === '') {
          sendJson(res, 404, { ok: false, err: '房间不存在' });
          return true;
        }
        sendJson(res, 404, { ok: false, err: '房间不存在' });
        return true;
      }
      room.touch();
      const qPid = url.searchParams.get('playerId');
      const qTok = url.searchParams.get('token');
      const auth = qPid && qTok ? getAuth(room, qPid, qTok) : null;
      if (action === '') {
        sendJson(res, 200, {
          ok: true,
          code,
          phase: room.phase,
          player: room.player
            ? { name: room.player.name, kind: room.player.kind, agentId: room.player.agentId }
            : null,
          score: room.score,
          spectateUrl: roomLinks(base, code, null, null).spectateUrl,
          result: room.result,
        });
        return true;
      }
      sendJson(res, 200, room.snapshot(!!auth));
      return true;
    }

    if (req.method === 'POST' && action === 'action') {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        sendJson(res, 400, { ok: false, err: e.message });
        return true;
      }
      if (!room) {
        sendJson(res, 404, { ok: false, err: '房间不存在' });
        return true;
      }
      const me = getAuth(room, body.playerId, body.token);
      if (!me) {
        sendJson(res, 401, { ok: false, err: '鉴权失败' });
        return true;
      }
      const r = room.applyAction(body);
      if (!r.ok) {
        sendJson(res, 400, r);
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        dropped: r.dropped,
        aimX: r.aimX,
        dropTimer: r.dropTimer,
        phase: room.phase,
        score: room.score,
        canDrop: room.phase === 'playing' && room.dropTimer <= 0,
      });
      return true;
    }

    if (req.method === 'GET' && action === 'result') {
      if (room && room.result) {
        sendJson(res, 200, { ok: true, result: room.result });
        return true;
      }
      const archived = resultArchive.get(code);
      if (archived) {
        sendJson(res, 200, { ok: true, result: archived, archived: true });
        return true;
      }
      if (room) {
        sendJson(res, 200, {
          ok: true,
          result: null,
          phase: room.phase,
          score: room.score,
          hint: '对局尚未结束',
        });
        return true;
      }
      sendJson(res, 404, { ok: false, err: '无结果' });
      return true;
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(req.url || '/', `http://${host}`);

    if (await handleApi(req, res, url)) return;

    // 静态文件
    let filePath = safeJoin(ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
    if (!filePath) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      // html/js/css 禁止缓存，避免「复制没东西」仍跑旧脚本
      const noCache = ext === '.html' || ext === '.js' || ext === '.css';
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': noCache ? 'no-store, no-cache, must-revalidate' : 'public, max-age=3600',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, err: 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[suika-merge] listening on http://0.0.0.0:${PORT}`);
  console.log(`[suika-merge] agent docs: http://127.0.0.1:${PORT}/api/v1/docs`);
});
