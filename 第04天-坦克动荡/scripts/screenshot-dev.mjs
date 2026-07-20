import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const port=Number(process.env.SHOWCASE_PORT||3217);
const origin=`http://127.0.0.1:${port}`;
const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const reportsDir=join(projectRoot,'reports');
const server=spawn(process.execPath,['server.js'],{
  cwd:projectRoot,
  env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe'],
});

async function waitForServer(){
  for(let i=0;i<80;i++){
    try{const response=await fetch(`${origin}/dev/showcase/`);if(response.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('本地预览服务启动超时');
}

let browser;
try{
  await waitForServer();
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  await page.goto(`${origin}/dev/showcase/?capture=1`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__showcaseReady===true,null,{timeout:15000});
  await mkdir(reportsDir,{recursive:true});
  await page.screenshot({path:join(reportsDir,'showcase.png'),fullPage:true});
  await page.waitForTimeout(700);
  await page.screenshot({path:join(reportsDir,'showcase-2.png'),fullPage:true});
  const report=await page.evaluate(()=>({metrics:window.__showcaseMetrics,consoleReady:window.__showcaseReady,viewport:{width:innerWidth,height:innerHeight}}));
  await writeFile(join(reportsDir,'showcase-metrics.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`预览截图完成：${report.metrics.fps} 帧/秒，${report.metrics.drawCalls} 次绘制调用`);
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
