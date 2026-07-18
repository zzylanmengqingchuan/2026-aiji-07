import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const port=Number(process.env.MOTION_PORT||3220);
const origin=`http://127.0.0.1:${port}`;
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const reportsDir=join(projectRoot,'reports');
const server=spawn(process.execPath,['server.js'],{
  cwd:projectRoot,
  env:{...process.env,PORT:String(port),COUNTDOWN_SECONDS:'.15',ROUND_SECONDS:'12',ROUND_BREAK_SECONDS:'.2'},
  stdio:['ignore','pipe','pipe'],
});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function json(path,options){
  const response=await fetch(origin+path,options);
  const body=await response.json();
  if(!response.ok)throw new Error(`${path}：${body.err||response.status}`);
  return body;
}
async function waitForServer(){
  for(let i=0;i<80;i++){
    try{if((await fetch(`${origin}/api/v1/docs`)).ok)return;}catch{}
    await sleep(100);
  }
  throw new Error('移动测试服务启动超时');
}
async function waitForPlaying(code){
  for(let i=0;i<80;i++){
    const room=await json(`/api/v1/rooms/${code}`);
    if(room.phase==='playing')return room;
    await sleep(100);
  }
  throw new Error('对局未进入 playing');
}

let browser;
let actionTimer;
try{
  await waitForServer();
  const a=await json('/api/v1/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'平滑测试甲',kind:'agent',agentId:'motion-a'})});
  const b=await json(`/api/v1/rooms/${a.code}/join`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'平滑测试乙',kind:'agent',agentId:'motion-b'})});
  await waitForPlaying(a.code);
  let tick=0;
  actionTimer=setInterval(()=>{
    tick++;
    const actions=[
      [a,{mx:1,mz:0,aimX:30,aimZ:-38,fire:tick%9===0}],
      [b,{mx:-1,mz:0,aimX:-30,aimZ:38,fire:tick%11===0}],
    ];
    for(const [player,input] of actions){
      fetch(`${origin}/api/v1/rooms/${a.code}/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({playerId:player.playerId,token:player.token,...input})}).catch(()=>{});
    }
  },50);

  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.goto(`${origin}/?room=${a.code}&spectate=1&debug=1`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__tankDebug?.tanks?.length>=2,null,{timeout:15000});
  await page.waitForTimeout(800);
  const samples=await page.evaluate(async()=>{
    const rows=[];
    for(let i=0;i<180;i++){
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const d=window.__tankDebug;
      if(d?.tanks?.[0])rows.push({t:performance.now(),x:d.tanks[0].x,z:d.tanks[0].z});
    }
    return rows;
  });
  const frameTimes=samples.slice(1).map((v,i)=>v.t-samples[i].t).sort((x,y)=>x-y);
  const steps=samples.slice(1).map((v,i)=>Math.hypot(v.x-samples[i].x,v.z-samples[i].z)).filter(v=>v>.0001);
  const mean=steps.reduce((sum,v)=>sum+v,0)/Math.max(1,steps.length);
  const variance=steps.reduce((sum,v)=>sum+(v-mean)**2,0)/Math.max(1,steps.length);
  const report={
    sampleFrames:samples.length,
    averageFps:Number((1000/(frameTimes.reduce((s,v)=>s+v,0)/Math.max(1,frameTimes.length))).toFixed(1)),
    p95FrameMs:Number((frameTimes[Math.floor(frameTimes.length*.95)]||0).toFixed(2)),
    movementStepCv:Number((Math.sqrt(variance)/Math.max(.0001,mean)).toFixed(3)),
    render:await page.evaluate(()=>window.__tankPerf||null),
  };
  await mkdir(reportsDir,{recursive:true});
  await page.screenshot({path:join(reportsDir,'game-motion.png'),fullPage:true});
  await writeFile(join(reportsDir,'motion-metrics.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`移动测试完成：${report.averageFps} 帧/秒，P95 ${report.p95FrameMs}ms，步长波动 ${report.movementStepCv}`);
  if(report.averageFps<50||report.p95FrameMs>28||report.movementStepCv>.45)process.exitCode=1;
}finally{
  if(actionTimer)clearInterval(actionTimer);
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
