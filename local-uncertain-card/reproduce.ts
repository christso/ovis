import {chmodSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import assert from 'node:assert/strict';
import {spyOn} from 'bun:test';
const repo=process.env.OVIS_REPO??process.cwd();
await import(repo+'/scripts/test-herdr.ts');
const client=await import(repo+'/server/herdr/client.ts');
const {createServer}=await import(repo+'/server/index.ts');const {chromium}=await import(repo+'/node_modules/playwright-core/index.mjs');
const root=mkdtempSync(join(tmpdir(),'ovis-local-ack-'));const evidence=process.env.OVIS_EVIDENCE_DIR??'/tmp/ovis-local-uncertain-card-evidence';mkdirSync(evidence,{recursive:true});
const text='Please record the evidence once.';let server:any,browser:any,workspace:string|undefined,spy:any;
async function until(check:()=>any,label:string){const deadline=Date.now()+20000;while(!await check()){assert.ok(Date.now()<deadline,'Timed out: '+label);await Bun.sleep(25)}}
try{
 const made=await client.herdrRpc('workspace.create',{cwd:root,label:'Local receipt diagnostic fixture',focus:false});workspace=made.workspace.workspace_id;const pane=made.root_pane.pane_id;
 const program=join(root,'codex'),record=join(root,'record.cjs'),log=join(root,'input.jsonl');copyFileSync(process.execPath,program);chmodSync(program,0o755);
 writeFileSync(record,'const fs=require("node:fs");process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write("\\x1b[?2004h\\n› Message\\n",()=>fs.writeFileSync(process.argv[2],""));process.stdin.on("data",c=>fs.appendFileSync(process.argv[2],JSON.stringify(c.toString())+"\\n"));');
 await client.herdrRpc('pane.send_text',{pane_id:pane,text:`exec '${program}' '${record}' '${log}'\n`});await until(()=>existsSync(log),'recorder ready');
 const bytes=()=>readFileSync(log,'utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s)).join('');
 await client.herdrRpc('pane.report_agent',{pane_id:pane,source:'manual',agent:'codex',state:'working'});
 let failedAck=false,enterWrites=0;const original=client.paneSendKeys;
 spy=spyOn(client,'paneSendKeys').mockImplementation(async(...args:any[])=>{const result=await original(...args);if(args[0]===pane&&args[1].includes('Enter')&&!failedAck){enterWrites++;failedAck=true;await Bun.sleep(2000);throw new client.HerdrError('terminal_write_timeout','Injected acknowledgement failure after Enter was written');}return result});
 mkdirSync(join(root,'native-codex'));
 server=createServer({codexHome:join(root,'native-codex'),port:0,hostname:'127.0.0.1',stateDir:join(root,'state'),token:''});
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--accept-lang=en-US']});
 const context=await browser.newContext({viewport:{width:1280,height:800},locale:'en-US',recordVideo:{dir:evidence,size:{width:1280,height:800}}});
 await context.addInitScript(()=>localStorage.setItem('ovis:settings',JSON.stringify({language:'en',defaultView:'chat',alertsOn:false,autoSendQueued:true})));
 const page=await context.newPage();const errors:string[]=[],frames:any[]=[],outbound:any[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/pane/conversation?**',async route=>{const delivered=bytes().endsWith('\r');await route.fulfill({json:{source:'codex-transcript',turns:delivered?[{role:'user',ts:new Date().toISOString(),parts:[{kind:'text',text}]}]:[],metadata:null,cursor:null,history_id:'owned-fixture-history'}})});
 await page.routeWebSocket(/\/ws(?:\?|$)/,socket=>{const upstream=socket.connectToServer();socket.onMessage(raw=>{outbound.push(JSON.parse(String(raw)));upstream.send(raw)});upstream.onMessage(raw=>{frames.push(JSON.parse(String(raw)));socket.send(raw)})});
 await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}&view=chat`);await page.locator('.conn-live').waitFor();try { await until(()=>frames.some(f=>f.type==='input-ready'&&f.pane_id===pane&&f.ready!==false),'input-ready'); } catch(e) { await page.screenshot({path:join(evidence,'setup-failure.png')}); console.log('SETUP',JSON.stringify({pane,frames:frames.map(f=>({type:f.type,pane_id:f.pane_id,code:f.code})),outbound:outbound.map(f=>({type:f.type,pane_id:f.pane_id})),body:(await page.locator('body').innerText()).slice(-2500)}));throw e; }
 const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();await page.locator('.pending-message').filter({hasText:text}).waitFor();
 await client.herdrRpc('pane.report_agent',{pane_id:pane,source:'manual',agent:'codex',state:'idle'});
 await until(()=>failedAck&&bytes().endsWith('\r'),'Enter delivered');await page.locator('.pending-message[data-state="uncertain"]').waitFor({timeout:20000});
 await page.waitForFunction(t=>[...document.querySelectorAll('.chat-turn-user')].some(e=>e.textContent?.includes(t)),text,{timeout:20000});
 await page.screenshot({path:join(evidence,'uncertain-delivered.png')});await page.waitForTimeout(2000);
 const before=bytes();assert.equal(before,`\x1b[200~${text}\x1b[201~\r`);assert.equal(outbound.filter(f=>f.type==='submit').length,1);assert.equal(enterWrites,1);assert.equal(await page.locator('.pending-message-send').count(),0);
 const summary={source:Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:repo}).stdout.toString().trim(),faultInjected:'successful real Enter followed by a 2000 ms delayed acknowledgement error',transcriptFixture:true,nativeAgent:false,submitCount:outbound.filter(f=>f.type==='submit').length,enterWrites,terminalBytes:before.length,pendingState:await page.locator('.pending-message').getAttribute('data-state'),cardText:(await page.locator('.pending-message').innerText()).replace(text,'<fixture message>'),pendingFrames:frames.filter(f=>f.type==='pending-messages').map(f=>({states:f.messages.map((m:any)=>({state:m.state,code:m.error?.code})),removed:f.removed?.map((r:any)=>({outcome:r.outcome}))})),errors};
 assert.deepEqual(errors,[]);const video=page.video();await context.close();summary.video=await video.path();writeFileSync(join(evidence,'result.json'),JSON.stringify(summary,null,2));console.log('PASS',JSON.stringify(summary));
}finally{spy?.mockRestore();await browser?.close();server?.stop(true);if(workspace)await client.herdrRpc('workspace.close',{workspace_id:workspace}).catch(()=>{});rmSync(root,{recursive:true,force:true})}
