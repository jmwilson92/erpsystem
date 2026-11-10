/** Optional full local browser smoke against an isolated in-memory DB; no real data.
 * Uses only synthetic sessions created in that DB. Provider keys disabled. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash,randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { TENANT_TABLES_SQL,TENANT_FKS_SQL } from '../src/lib/tenant-template';
async function main() {
 const db=await PGlite.create();await db.exec(TENANT_TABLES_SQL+'\n'+TENANT_FKS_SQL);
 const socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:8});await socket.start();
 process.env.DATABASE_URL=`postgresql://postgres@${socket.getServerConn()}/postgres`;
 process.env.DATABASE_POOL_MAX='1';process.env.DEMO_MODE='0';
 const {prisma}=await import('../src/lib/db');
 const token=randomBytes(32).toString('hex');
 const user=await prisma.user.create({data:{name:'AI Browser Fixture',email:'ai-browser@example.invalid',role:'ADMIN'}});
 await prisma.companySettings.create({data:{id:'default',name:'Isolated AI fixture'}});
 await prisma.authSession.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),userId:user.id,expiresAt:new Date(Date.now()+3600000)}});
 const port=3093,base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port)],{env:{...process.env,NODE_ENV:'production',DATABASE_POOL_MAX:'1',DEMO_MODE:'0',XAI_API_KEY:'',TTS_API_KEY:'',APP_URL:base,NEXT_PUBLIC_APP_URL:base},stdio:['ignore','pipe','pipe']});
 const log=fs.createWriteStream('/workspace/ai-help-browser-server.log');child.stdout.on('data',d=>log.write(d));child.stderr.on('data',d=>log.write(d));
 const startup=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Server startup timeout')),30000);child.stdout.on('data',d=>{if(String(d).includes('Ready')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Server stopped'));});});
 let browser;
 try {
  await startup;
  assert.ok([307,401].includes((await fetch(base+'/api/tts',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'test'})})).status));
  assert.equal((await fetch(base+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'forge-session=synthetic-invalid'},body:JSON.stringify({text:'test'})})).status,401);
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();await context.addCookies([{name:'forge-session',value:token,url:base,httpOnly:true}]);
  const page=await context.newPage();
  await page.goto(base+'/ai');
  await page.getByPlaceholder('Message Carina…').waitFor({state:'visible',timeout:30000});
  assert.match(await page.locator('body').innerText(),/AI can make mistakes/);
  await page.getByPlaceholder('Message Carina…').fill('Does a standalone production work order need a certified BOM?');
  await page.getByPlaceholder('Message Carina…').press('Enter');
  const feedback=page.getByRole('button',{name:'Unhelpful answer',exact:true});await feedback.waitFor({state:'visible',timeout:30000});
  await feedback.click();await page.getByText('Thanks for the feedback.').waitFor();
  const row=await prisma.auditLog.findFirstOrThrow({where:{entityType:'CarinaHelp',action:'ANSWER',userId:user.id}});
  assert.equal(JSON.parse(row.metadata || '{}').page,'/ai');assert.equal(JSON.parse(row.changes || '{}').helpful,false);
  assert.equal(await prisma.workOrder.count(),0);assert.equal(await prisma.purchaseRequest.count(),0);
  await page.goto(base+'/help/bom-certification');assert.match(await page.locator('body').innerText(),/prototype step is optional/i);
  console.log('Browser disclosure, authenticated chat, feedback, article, invalid-session TTS and no-mutation smoke passed.');
 } finally {await browser?.close();child.kill('SIGTERM');await prisma.$disconnect();await socket.stop();await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
