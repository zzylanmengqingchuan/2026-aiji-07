// 台球桌版截图验收：首页新文案 / 空旷场地+边框墙+HUD 规则行 / 对手逃离 banner / 无 console error
// 前提：服务已在 ORIGIN（默认 http://127.0.0.1:3101）运行
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ORIGIN = process.env.ORIGIN || 'http://127.0.0.1:3101';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const reportsDir = join(projectRoot, 'reports');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browserErrors = [];
const failures = [];
function check(cond, label, detail = '') {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' · ' + detail : ''}`);
  if (!cond) failures.push(label + (detail ? ' · ' + detail : ''));
}
async function post(path, body) {
  const r = await fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function get(path) {
  const r = await fetch(ORIGIN + path);
  return r.json();
}
function watchPage(page, tag) {
  page.on('pageerror', (e) => browserErrors.push(`[${tag}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') browserErrors.push(`[${tag}] ${m.text()}`); });
}

await mkdir(reportsDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu-sandbox'] });
let fireTimer = null;
try {
  // ---------- 1) 首页新文案 ----------
  console.log('\n== 截图 1：首页新文案 ==');
  const home = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  watchPage(home, 'home');
  await home.goto(`${ORIGIN}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const tagline = await home.textContent('.tagline');
  const kicker = await home.textContent('.kicker');
  check(/台球桌/.test(tagline) && /直射无效/.test(tagline) && /8 次/.test(tagline), '首页 tagline 为台球桌版规则', tagline.trim());
  check(/台球桌/.test(kicker), '首页 kicker 已更新', kicker.trim());
  await home.screenshot({ path: join(reportsDir, 'billiard-home.png') });
  await home.close();

  // ---------- 2) 对局画面：空旷场地 + 边框墙 + HUD 规则行 + 反弹弹光晕 ----------
  console.log('\n== 截图 2：对局画面（空旷台球桌 + HUD 规则行 + 反弹弹光晕）==');
  const room = await post('/api/v1/rooms', { empty: true });
  check(!!room.ok, 'REST 建空房', room.code);
  const agent = await post(`/api/v1/rooms/${room.code}/join`, { name: 'Agent-甲', kind: 'agent', agentId: 'shot-a' });
  check(!!agent.ok, 'Agent 加入', agent.playerId);
  const game = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  watchPage(game, 'game');
  await game.goto(`${ORIGIN}/?room=${room.code}&autojoin=1&debug=1&name=测试员`, { waitUntil: 'domcontentloaded' });
  // 等自动开局进入 playing
  let phase = '';
  for (let i = 0; i < 60; i++) {
    const st = await get(`/api/v1/rooms/${room.code}/state`);
    phase = st.phase;
    if (phase === 'playing') break;
    await sleep(250);
  }
  check(phase === 'playing', '满 2 人自动开局进入 playing', `phase=${phase}`);
  const stNow = await get(`/api/v1/rooms/${room.code}/state`);
  check(Array.isArray(stNow.walls) && stNow.walls.length === 0, '对局 walls 为空（无迷宫墙残留）', `len=${stNow.walls?.length}`);
  await game.waitForFunction(() => window.__tankDebug?.tanks?.length === 2, null, { timeout: 15000 });
  const wallCount = await game.evaluate(() => window.__tankDebug.wallCount);
  check(wallCount === 0, '前端 mazeGroup 无墙体 mesh（mazeWalls.length=0）', `wallCount=${wallCount}`);
  // Agent-甲持续斜向开火，制造"未反弹实心弹"与"反弹后炽红光晕弹"同框
  fireTimer = setInterval(() => {
    post(`/api/v1/rooms/${room.code}/action`, {
      playerId: agent.playerId, token: agent.token, mx: 0, mz: 0, aimX: 0, aimZ: 90, fire: true,
    }).catch(() => {});
  }, 120);
  await sleep(2600); // 等部分炮弹完成反弹
  const bulletStates = await get(`/api/v1/rooms/${room.code}/state`);
  const bStates = (bulletStates.bullets || []).map((b) => b.bounces || 0);
  check(bStates.length > 0 && Math.max(...bStates, 0) >= 1, '场上同时存在未反弹与已反弹炮弹', `bounces=${JSON.stringify(bStates)}`);
  const buffsText = await game.textContent('#buffs');
  check(/直射无效/.test(buffsText) && /反弹才致命/.test(buffsText) && /8 次/.test(buffsText), 'HUD 规则行已更新', buffsText.trim());
  await game.screenshot({ path: join(reportsDir, 'billiard-game.png') });

  // ---------- 3) 对手逃离战场 banner ----------
  console.log('\n== 截图 3：对手逃离战场提示 ==');
  const room2 = await post('/api/v1/rooms', { empty: true });
  const stay = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  watchPage(stay, 'stay');
  await stay.goto(`${ORIGIN}/?room=${room2.code}&autojoin=1&debug=1&name=留守者`, { waitUntil: 'domcontentloaded' });
  const flee = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  watchPage(flee, 'flee');
  await flee.goto(`${ORIGIN}/?room=${room2.code}&autojoin=1&debug=1&name=逃跑者`, { waitUntil: 'domcontentloaded' });
  let phase2 = '';
  for (let i = 0; i < 60; i++) {
    const st = await get(`/api/v1/rooms/${room2.code}/state`);
    phase2 = st.phase;
    if (phase2 === 'playing' || phase2 === 'countdown') break;
    await sleep(250);
  }
  check(['playing', 'countdown'].includes(phase2), '第二房间开局', `phase=${phase2}`);
  await flee.close(); // 模拟对手中途离场（WS 断开）
  let bannerText = '';
  for (let i = 0; i < 30; i++) {
    bannerText = (await stay.textContent('#banner')) || '';
    const opacity = await stay.evaluate(() => document.getElementById('banner').style.opacity);
    if (/逃离战场/.test(bannerText) && Number(opacity) > 0) break;
    await sleep(200);
  }
  check(/您的对手已逃离战场/.test(bannerText), '留守方顶部出现"您的对手已逃离战场"', bannerText.trim());
  await sleep(300);
  await stay.screenshot({ path: join(reportsDir, 'billiard-opponent-left.png') });
  // 战报 recap 措辞（leave 计入 roundHistory）
  const room2State = await get(`/api/v1/rooms/${room2.code}/state`);
  const leaveRound = (room2State.roundHistory || []).find((r) => r.reason === 'leave');
  check(!!leaveRound, 'roundHistory 以 leave 记录逃离把', JSON.stringify(room2State.roundHistory || []));

  await stay.close();
  await game.close();

  // ---------- 4) console 错误 ----------
  console.log('\n== console 错误检查（?debug=1）==');
  check(browserErrors.length === 0, '三个页面均无 console error / pageerror', browserErrors.join('；') || '无');
} finally {
  if (fireTimer) clearInterval(fireTimer);
  await browser.close();
}
console.log('\n截图输出：reports/billiard-home.png · reports/billiard-game.png · reports/billiard-opponent-left.png');
if (failures.length) {
  console.error('未通过项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('截图验收全部通过 ✅');
