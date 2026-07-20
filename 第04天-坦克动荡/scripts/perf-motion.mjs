import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const port = Number(process.env.MOTION_PORT || 3220);
const origin = `http://127.0.0.1:${port}`;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const reportsDir = join(projectRoot, 'reports');
const server = spawn(process.execPath, ['server.js'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(port),
    COUNTDOWN_SECONDS: '.15',
    ROUND_SECONDS: '8',
    ROUND_BREAK_SECONDS: '.2',
    WIN_SCORE: '5',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(path, options) {
  const response = await fetch(origin + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}：${body.err || response.status}`);
  return body;
}
const post = (path, body) => json(path, {
  method: 'POST',
  headers: {'content-type':'application/json'},
  body: JSON.stringify(body),
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/api/v1/docs`)).ok) return; } catch {}
    await sleep(100);
  }
  throw new Error('测试服务启动超时');
}

let browser;
let actionTimer;
const browserErrors = [];
try {
  await waitForServer();
  // seed=1 的右侧纵向走廊贯通全场：乙方向下射击，弹丸撞南墙后返回，
  // 往返时间超过出膛保护，可稳定验证“反弹会打中自己”。
  const a = await post('/api/v1/rooms', {name:'测试甲', kind:'agent', agentId:'perf-a', seed:1});
  const b = await post(`/api/v1/rooms/${a.code}/join`, {name:'测试乙', kind:'agent', agentId:'perf-b'});

  browser = await chromium.launch({channel:'chrome', headless:true, args:['--disable-gpu-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:900}, deviceScaleFactor:1});
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
  await page.goto(`${origin}/?room=${a.code}&spectate=1&debug=1`, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__tankDebug?.tanks?.length === 2, null, {timeout:15000});

  // 乙持续向屏幕上方（-Z）射击但不移动；甲不动。每把乙会被三发回弹击毁。
  actionTimer = setInterval(() => {
    post(`/api/v1/rooms/${a.code}/action`, {
      playerId:b.playerId, token:b.token, mx:0, mz:0, aimX:50, aimZ:-100, fire:true,
    }).catch(() => {});
    post(`/api/v1/rooms/${a.code}/action`, {
      playerId:a.playerId, token:a.token, mx:0, mz:0, aimX:50, aimZ:50, fire:false,
    }).catch(() => {});
  }, 55);

  const samples = await page.evaluate(async () => {
    const rows = [];
    for (let i = 0; i < 180; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const d = window.__tankDebug;
      if (d) rows.push({t:performance.now(), camera:{...d.camera}, wallCount:d.wallCount, mazeSeed:d.mazeSeed});
    }
    return rows;
  });
  await mkdir(reportsDir, {recursive:true});
  // 此时仍在第一把进行中，截图用于目检迷宫、全场机位与 HUD，而不是结束大厅。
  await page.screenshot({path:join(reportsDir,'tank-trouble-arena.png'), fullPage:true});

  let maxBounce = 0;
  let finishedState = null;
  const deadline = Date.now() + 50000;
  while (Date.now() < deadline) {
    const st = await json(`/api/v1/rooms/${a.code}/state?playerId=${a.playerId}&token=${a.token}`);
    for (const bullet of st.bullets || []) maxBounce = Math.max(maxBounce, bullet.bounces || 0);
    if (st.phase === 'finished') { finishedState = st; break; }
    await sleep(80);
  }
  if (!finishedState) throw new Error('整场未在 50 秒内完成');
  const result = (await json(`/api/v1/rooms/${a.code}/result`)).result;

  const frameTimes = samples.slice(1).map((v,i) => v.t - samples[i].t).sort((x,y) => x-y);
  const averageFrame = frameTimes.reduce((sum,v) => sum+v, 0) / Math.max(1, frameTimes.length);
  const cameraDrift = samples.reduce((max, row) => {
    const first = samples[0].camera;
    return Math.max(max, Math.hypot(row.camera.x-first.x, row.camera.y-first.y, row.camera.z-first.z));
  }, 0);
  const selfKills = (result.killLog || []).filter((item) => item.selfKill).length;
  const winner = result.rankings?.[0];
  const report = {
    room:a.code,
    sampleFrames:samples.length,
    averageFps:Number((1000/averageFrame).toFixed(1)),
    p95FrameMs:Number((frameTimes[Math.floor(frameTimes.length*.95)] || 0).toFixed(2)),
    browserErrors,
    mazeSeed:samples.at(-1)?.mazeSeed,
    wallCount:samples.at(-1)?.wallCount,
    fixedCameraDrift:Number(cameraDrift.toFixed(4)),
    maxBounceObserved:maxBounce,
    selfKills,
    rounds:result.roundHistory?.length || 0,
    finalScore:result.rankings?.map((p) => ({name:p.name,score:p.score})) || [],
    render:await page.evaluate(() => window.__tankPerf || null),
  };

  await writeFile(join(reportsDir,'motion-metrics.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (browserErrors.length) failures.push(`浏览器错误 ${browserErrors.join('；')}`);
  if (report.averageFps < 50) failures.push(`平均帧率 ${report.averageFps} < 50`);
  if (report.p95FrameMs > 28) failures.push(`P95 ${report.p95FrameMs}ms > 28ms`);
  if (report.wallCount < 20 || report.mazeSeed !== 1) failures.push('固定种子迷宫未同步');
  if (report.fixedCameraDrift > .001) failures.push(`固定镜头发生漂移 ${report.fixedCameraDrift}`);
  if (maxBounce < 1) failures.push('未观测到炮弹反弹');
  if (selfKills < 5) failures.push(`仅记录 ${selfKills} 次自伤击毁`);
  if (!winner || winner.id !== a.playerId || winner.score !== 5) failures.push('先得 5 分结算错误');
  if (failures.length) throw new Error(failures.join('\n'));
} finally {
  if (actionTimer) clearInterval(actionTimer);
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
