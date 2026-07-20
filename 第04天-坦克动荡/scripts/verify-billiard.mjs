// 台球桌版验收：REST 全流程 / 直射无效 / 反弹致命 / 移动顺滑
// 用法：先启动服务（默认 http://127.0.0.1:3101），再 `node scripts/verify-billiard.mjs`
import WebSocket from 'ws';

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(cond, label, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ' · ' + detail : ''}`);
  if (!cond) failures.push(label + (detail ? ' · ' + detail : ''));
}

async function post(path, body) {
  const r = await fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function get(path) {
  const r = await fetch(ORIGIN + path);
  return { status: r.status, body: await r.json() };
}

/** 建空房 + 两个 agent 加入（botA 先加入 = slot0 = (-38,-38)，botB = slot1 = (38,38)） */
async function makeRoom(tag) {
  const room = (await post('/api/v1/rooms', { empty: true })).body;
  if (!room.ok || !room.hostKey) throw new Error('建空房失败：' + JSON.stringify(room));
  const a = (await post(`/api/v1/rooms/${room.code}/join`, { name: `botA-${tag}`, kind: 'agent', agentId: `va-${tag}` })).body;
  const b = (await post(`/api/v1/rooms/${room.code}/join`, { name: `botB-${tag}`, kind: 'agent', agentId: `vb-${tag}` })).body;
  if (!a.ok || !b.ok) throw new Error('agent 加入失败');
  const ctx = { code: room.code, hostKey: room.hostKey, a, b };
  for (const bot of [a, b]) {
    bot.code = room.code;
    bot.cmd = { mx: 0, mz: 0, aimX: 0, aimZ: 0, fire: false };
    bot.timer = setInterval(() => {
      post(`/api/v1/rooms/${room.code}/action`, {
        playerId: bot.id ?? bot.playerId, token: bot.token, ...bot.cmd,
      }).catch(() => {});
    }, 50);
  }
  return ctx;
}
function stopDrivers(ctx) {
  for (const bot of [ctx.a, ctx.b]) clearInterval(bot.timer);
}
async function stopMatch(ctx) {
  await post(`/api/v1/rooms/${ctx.code}/stop`, { hostKey: ctx.hostKey }).catch(() => {});
}
async function stateOf(ctx) {
  const r = await get(`/api/v1/rooms/${ctx.code}/state`);
  return r.body;
}
function me(st, bot) {
  const id = bot.id ?? bot.playerId;
  return (st.players || []).find((p) => p.id === id);
}
async function waitPhase(ctx, want, timeoutMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await stateOf(ctx);
    if (want.includes(st.phase)) return st;
    await sleep(120);
  }
  throw new Error(`${ctx.code} 等待 phase=${want} 超时`);
}
/** 闭环开车到目标点附近：服务端对输入归一化，全速 homing 在目标附近会摆动 ~2u，
 *  因此只保证"够近"，返回到位误差供调用方参考（功能判定不依赖精确站位） */
async function driveTo(ctx, bot, tx, tz, tol = 2, timeoutMs = 15000) {
  const t0 = Date.now();
  let last = Infinity;
  while (Date.now() - t0 < timeoutMs) {
    const st = await stateOf(ctx);
    const p = me(st, bot);
    if (!p) { await sleep(120); continue; }
    const dx = tx - p.x, dz = tz - p.z;
    last = Math.hypot(dx, dz);
    if (last <= tol) {
      bot.cmd.mx = 0; bot.cmd.mz = 0;
      await sleep(1600); // 等刹车停稳后取最终误差
      const st2 = await stateOf(ctx);
      const p2 = me(st2, bot);
      return p2 ? Math.hypot(tx - p2.x, tz - p2.z) : last;
    }
    bot.cmd.mx = dx; bot.cmd.mz = dz;
    await sleep(100);
  }
  bot.cmd.mx = 0; bot.cmd.mz = 0;
  return last;
}

// ---------- 1) REST 全流程 + 直射无效 ----------
async function testDirect() {
  console.log('\n== 用例 1：REST 全流程 + 直射无效（直射 10 秒，hp 必须恒为 3）==');
  const ctx = await makeRoom('d1');
  try {
    const st0 = await waitPhase(ctx, ['countdown', 'playing']);
    check(['countdown', 'playing'].includes(st0.phase), '空房 + 两 agent 加入后自动开局', `phase=${st0.phase}`);
    check(Array.isArray(st0.walls) && st0.walls.length === 0, 'state.walls 为空数组', `len=${st0.walls?.length}`);
    check(st0.mazeSeed === null, 'state.mazeSeed 固定为 null', `mazeSeed=${st0.mazeSeed}`);
    check(st0.rules?.maxBounces === 8 && st0.rules?.bulletLife === 6, 'rules 下发 8 次/6 秒', JSON.stringify({ b: st0.rules?.maxBounces, l: st0.rules?.bulletLife }));

    // botA 离开出生点开到 (0,30) 站桩（脱离出生对角线，避免角部双反弹原路返回干扰）；
    // botB 原地不动，瞄准取 botA 实时坐标
    const arrivedDist = await driveTo(ctx, ctx.a, 0, 30);
    const stA = await stateOf(ctx);
    const paA = me(stA, ctx.a);
    const offSpawn = paA ? Math.hypot(paA.x + 38, paA.z + 38) : 0;
    check(arrivedDist <= 4 && offSpawn > 20, 'botA 离开出生点开至 (0,30) 附近', `到位误差 ${arrivedDist.toFixed(2)}，离出生点 ${offSpawn.toFixed(1)}`);

    // botB 用 state 里 botA 的实时坐标直接瞄准，连射 10 秒
    let minHp = 99;
    let closePass = Infinity; // 未反弹炮弹与 botA 的最近距离
    let sawBullets = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const st = await stateOf(ctx);
      const pa = me(st, ctx.a);
      const pb = me(st, ctx.b);
      if (!pa || !pb) { await sleep(100); continue; }
      if (st.phase === 'playing' || st.phase === 'countdown') {
        ctx.b.cmd.aimX = pa.x; ctx.b.cmd.aimZ = pa.z; ctx.b.cmd.fire = true;
      }
      minHp = Math.min(minHp, pa.hp);
      for (const bu of st.bullets || []) {
        if (bu.owner !== pb.id) continue;
        sawBullets++;
        if ((bu.bounces || 0) === 0) {
          closePass = Math.min(closePass, Math.hypot(bu.x - pa.x, bu.z - pa.z));
        }
      }
      await sleep(100);
    }
    ctx.b.cmd.fire = false;
    check(sawBullets >= 5, 'botB 确实直射出多发炮弹', `观测到 ${sawBullets} 次 botB 活跃弹`);
    check(closePass < 3, '未反弹炮弹确实穿过 botA 所在位置', `最近距离 ${closePass === Infinity ? '无' : closePass.toFixed(2)}（命中半径 1.7）`);
    check(minHp === 3, '直射 10 秒 botA 的 hp 始终为 3', `观测到的最低 hp=${minHp}`);
    console.log(`  数据：minHp=${minHp} closePass=${closePass.toFixed ? closePass.toFixed(2) : closePass}`);
  } finally {
    stopDrivers(ctx);
    await stopMatch(ctx);
  }
}

// ---------- 2) 反弹致命 ----------
async function testBounce() {
  console.log('\n== 用例 2：反弹致命（贴墙回弹命中 + bounces 观测）==');
  const ctx = await makeRoom('b2');
  try {
    await waitPhase(ctx, ['countdown', 'playing']);
    const distA = await driveTo(ctx, ctx.a, 51, 0);
    const distB = await driveTo(ctx, ctx.b, 30, 0);
    const st2 = await stateOf(ctx);
    const pa0 = me(st2, ctx.a), pb0 = me(st2, ctx.b);
    console.log(`  就位：botA=(${pa0?.x},${pa0?.z}) botB=(${pb0?.x},${pb0?.z})（到位误差 ${distA.toFixed(2)}/${distB.toFixed(2)}）`);
    // 镜面反射几何：botB 只需站在 botA 左侧，开火时瞄准 botA 关于 x=55 库边的镜像点 (110-pa.x, pa.z)，
    // 回弹必然穿过 botA——对到位误差不敏感（站位仅做宽松 sanity 检查）
    check(pa0 && pb0 && pa0.x >= 40 && pa0.x - pb0.x >= 8,
      'botA 在右侧半场、botB 在其左侧就位', `botA=(${pa0?.x},${pa0?.z}) botB=(${pb0?.x},${pb0?.z})`);

    // botB 交替「镜像点回弹射击」与「斜上方」开火：前者回弹必中 botA，后者用来观测多次反弹
    let minHpA = 99;
    let killLog = [];
    let maxBounces = 0;
    let sawBounced = false;
    let flip = false;
    const aimTimer = setInterval(() => {
      flip = !flip;
      ctx.b.cmd.mirror = flip;
      if (!flip) { ctx.b.cmd.aimX = 0; ctx.b.cmd.aimZ = 80; }
    }, 350);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const st = await stateOf(ctx);
      const pa = me(st, ctx.a);
      const pb = me(st, ctx.b);
      if (pa) minHpA = Math.min(minHpA, pa.hp);
      if (pa && pb && (st.phase === 'playing' || st.phase === 'countdown')) {
        // 镜像瞄准：打 botA 关于 x=55 库边的镜像点，炮弹撞库边回弹后必穿 botA
        if (ctx.b.cmd.mirror) { ctx.b.cmd.aimX = 110 - pa.x; ctx.b.cmd.aimZ = pa.z; }
        ctx.b.cmd.fire = true;
      }
      killLog = st.killLog || killLog;
      for (const bu of st.bullets || []) {
        if ((bu.bounces || 0) > 0) sawBounced = true;
        maxBounces = Math.max(maxBounces, bu.bounces || 0);
      }
      // 继续开火直到 botA 被回弹打死（killLog 落账）且观测到 3 次以上反弹
      if (minHpA < 3 && killLog.length > 0 && maxBounces >= 3) break;
      await sleep(100);
    }
    clearInterval(aimTimer);
    ctx.b.cmd.fire = false;
    check(minHpA < 3, '30 秒内 botA 出现 hp 下降（回弹命中）', `botA 最低 hp=${minHpA}`);
    check(killLog.length > 0, 'killLog 有击杀记录', `${killLog.length} 条`);
    for (const k of killLog.slice(-3)) {
      console.log(`  killLog：${k.killerName} → ${k.victimName}${k.selfKill ? '（自杀）' : ''}`);
    }
    check(sawBounced, '观测到 bounces>0 的炮弹');
    check(maxBounces >= 3, '观测到的最大反弹次数 > 3', `maxBounces=${maxBounces}`);
    console.log(`  数据：minHpA=${minHpA} killLog=${killLog.length} maxBounces=${maxBounces}`);
  } finally {
    stopDrivers(ctx);
    await stopMatch(ctx);
  }
}

// ---------- 3) 移动顺滑（贴库边斜向滑行，统计 impact 事件） ----------
async function testSmooth() {
  console.log('\n== 用例 3：移动顺滑（贴边斜向输入 10 秒，impact 不应每 tick 触发）==');
  const ctx = await makeRoom('s3');
  let ws;
  try {
    await waitPhase(ctx, ['countdown', 'playing']);
    let impacts = 0;
    let ticks = 0;
    const impactLog = [];
    ws = new WebSocket(ORIGIN.replace(/^http/, 'ws'));
    await new Promise((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'spectate', code: ctx.code, name: '验收观战' }));
        resolve();
      });
      ws.on('error', reject);
    });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch { return; }
      if (m.type !== 'state') return;
      ticks++;
      for (const e of m.events || []) {
        if (e.kind === 'impact') { impacts++; impactLog.push({ t: Date.now(), speed: e.speed }); }
      }
    });
    // botA 从 (-38,-38) 以 (1,1) 斜向输入冲向角落并贴墙滑行
    ctx.a.cmd.mx = 1; ctx.a.cmd.mz = 1;
    await sleep(10000);
    ctx.a.cmd.mx = 0; ctx.a.cmd.mz = 0;
    await sleep(400);
    const ratio = ticks ? (impacts / ticks).toFixed(3) : 'n/a';
    check(ticks > 100, '观战端持续收到 tick', `${ticks} 个 state 包`);
    check(impacts <= 15, 'impact 事件 0 或极少（非每 tick 触发）', `impacts=${impacts} / ticks=${ticks}（占比 ${ratio}）`);
    console.log(`  数据：impacts=${impacts} ticks=${ticks} ratio=${ratio}`);
    if (impactLog.length) console.log(`  impact 明细：${impactLog.map((i) => i.speed).join(', ')}`);
  } finally {
    if (ws) ws.close();
    stopDrivers(ctx);
    await stopMatch(ctx);
  }
}

const only = (process.argv[2] || 'direct,bounce,smooth').split(',');
const t0 = Date.now();
if (only.includes('direct')) await testDirect();
if (only.includes('bounce')) await testBounce();
if (only.includes('smooth')) await testSmooth();
console.log(`\n== 验收结束（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）==`);
if (failures.length) {
  console.error('未通过项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('全部通过 ✅');
