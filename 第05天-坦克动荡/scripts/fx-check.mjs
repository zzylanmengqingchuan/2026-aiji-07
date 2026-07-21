import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const port=3331;
const origin=`http://127.0.0.1:${port}`;
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const outDir=join(projectRoot,'reports','fx-check');
const server=spawn(process.execPath,['server.js'],{
  cwd:projectRoot,
  env:{...process.env,PORT:String(port),COUNTDOWN_SECONDS:'.15',ROUND_SECONDS:'30',ROUND_BREAK_SECONDS:'.2'},
  stdio:['ignore','pipe','pipe'],
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function json(path,options){
  const res=await fetch(origin+path,options);
  const body=await res.json();
  if(!res.ok)throw new Error(`${path}: ${body.err||res.status}`);
  return body;
}
let browser, actionTimer;
try{
  for(let i=0;i<80;i++){ try{ if((await fetch(`${origin}/api/v1/docs`)).ok)break; }catch{} await sleep(100); }
  const a=await json('/api/v1/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'FX甲',kind:'agent',agentId:'fx-a'})});
  const b=await json(`/api/v1/rooms/${a.code}/join`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'FX乙',kind:'agent',agentId:'fx-b'})});
  for(let i=0;i<80;i++){ const room=await json(`/api/v1/rooms/${a.code}`); if(room.phase==='playing')break; await sleep(100); }
  let tick=0;
  actionTimer=setInterval(async()=>{
    tick++;
    try{
      // 读实时状态，互相朝对方开并瞄准对方，尽快打出击毁爆炸
      const s=await json(`/api/v1/rooms/${a.code}/state?playerId=${a.playerId}&token=${encodeURIComponent(a.token)}`);
      const pa=(s.players||[]).find(p=>p.id===a.playerId), pb=(s.players||[]).find(p=>p.id===b.playerId);
      if(!pa||!pb)return;
      // 先各自开到南侧开阔走廊的两个集结点，再互射，避免被建筑挡住
      const rallyA={x:-9,z:-40}, rallyB={x:9,z:-40};
      const drive=(p,t)=>{const dx=t.x-p.x,dz=t.z-p.z,d=Math.hypot(dx,dz);return d>2?{mx:dx/d,mz:dz/d}:{mx:0,mz:0};};
      const ma=drive(pa,rallyA), mb=drive(pb,rallyB);
      const readyA=ma.mx===0&&ma.mz===0, readyB=mb.mx===0&&mb.mz===0;
      const actions=[
        [a,{mx:ma.mx,mz:ma.mz,aimX:pb.x,aimZ:pb.z,fire:readyA&&readyB&&tick%3===0}],
        [b,{mx:mb.mx,mz:mb.mz,aimX:pa.x,aimZ:pa.z,fire:readyA&&readyB&&tick%3===0}],
      ];
      for(const [player,input] of actions){
        fetch(`${origin}/api/v1/rooms/${a.code}/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:player.playerId,token:player.token,...input})}).catch(()=>{});
      }
    }catch{}
  },50);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  await page.goto(`${origin}/?room=${a.code}&spectate=1&debug=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__tankDebug?.tanks?.length>=2,null,{timeout:15000});
  // 跟随甲并放大视角，近距离看爆炸
  await page.selectOption('#followSelect',{index:1});
  for(let i=0;i<12;i++){ await page.mouse.wheel(0,-400); await page.waitForTimeout(60); }
  await mkdir(outDir,{recursive:true});
  await page.waitForTimeout(1500); // 等相机平滑到位
  // 用调试钩子在被跟踪坦克旁边直接触发一次大爆炸，连续抓帧看分层效果
  await page.evaluate(()=>{
    const t=window.__tankDebug?.tanks?.[0];
    if(t&&window.__tankFx) window.__tankFx.explode(t.x+4,t.z+2,1.6);
  });
  for(let i=0;i<8;i++){
    await page.screenshot({path:join(outDir,`boom-${i}.png`)});
    await page.waitForTimeout(220);
  }
  // 触发撞击特效 + 给坦克打凹痕
  await page.evaluate(()=>{
    const t=window.__tankDebug?.tanks?.[0];
    if(!t||!window.__tankFx) return;
    window.__tankFx.impact(t.x+1.8,t.z,-1,0,12,t.id);
    window.__tankFx.dent(t.id,t.x+1.8,t.z,-1,0);
    window.__tankFx.dent(t.id,t.x,t.z+2.2,0,-1);
  });
  await page.screenshot({path:join(outDir,'impact-0.png')});
  await page.waitForTimeout(600);
  await page.screenshot({path:join(outDir,'impact-1.png')});
  console.log('done');
}finally{
  if(actionTimer)clearInterval(actionTimer);
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
