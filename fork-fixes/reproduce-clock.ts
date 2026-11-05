import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,chmodSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';
const repo=process.env.OVIS_REPO??process.cwd();
const sourceCodexHome=process.env.CODEX_HOME??join(process.env.HOME!,'.codex');
await import(repo+'/scripts/test-herdr.ts');const c=await import(repo+'/server/herdr/client.ts');
const {createServer}=await import(repo+'/server/index.ts');const {chromium}=await import(repo+'/node_modules/playwright-core/index.mjs');
const root=mkdtempSync(join(tmpdir(),'ovis-native-dogfood-')),home=join(root,'codex-home'),cwd=join(root,'workspace');mkdirSync(home,{mode:0o700});mkdirSync(cwd);
copyFileSync(join(sourceCodexHome,'auth.json'),join(home,'auth.json'));chmodSync(join(home,'auth.json'),0o600);
// Only a new temporary folder is trusted; no existing user's trust state is changed.
writeFileSync(join(home,'config.toml'),`[projects.${JSON.stringify(cwd)}]\ntrust_level = "trusted"\n`);
const evidence=process.env.OVIS_NATIVE_EVIDENCE??'/tmp/ovis-shadow-investigation/green-clock';mkdirSync(evidence,{recursive:true});let workspace:string|undefined,server:any,browser:any,page:any;
const results:any[]=[];const errors:string[]=[];const frames:any[]=[],outbound:any[]=[];let currentText='';
async function until(check:()=>any,label:string,ms=90000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw new Error('Timed out: '+label);await Bun.sleep(100)}}
const textOf=(t:any)=>t.parts.filter((p:any)=>p.kind==='text').map((p:any)=>p.text).join('\n');
try{
 const made=await c.herdrRpc('workspace.create',{cwd,label:'Native chat delivery dogfood',focus:false,env:{CODEX_HOME:home}});workspace=made.workspace.workspace_id;const pane=made.root_pane.pane_id;writeFileSync(join(evidence,'owned-pane.json'),JSON.stringify({workspace,pane,socket:process.env.HERDR_SOCKET,root}));
 console.log('START',pane);
 await c.agentStart({name:'chat-dogfood',kind:'codex',paneId:pane,args:['--no-daemon','--ask-for-approval','never','--sandbox','read-only'],timeoutMs:30000});
 console.log('NATIVE_READY');
 server=createServer({port:0,hostname:'127.0.0.1',stateDir:join(root,'state'),token:'',codexHome:home});
 browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--accept-lang=en-US']});
 const contexts=[];let warm=true;
 for(const spec of [{name:'clock-aligned-loaded',offset:0,hold:false},{name:'clock-ahead-loaded',offset:2000,hold:false},{name:'clock-ahead-first-read',offset:2000,hold:true}]){
  console.log('CLOCK_CASE',spec.name);const folder=join(evidence,spec.name);mkdirSync(folder,{recursive:true});frames.length=0;outbound.length=0;
  const context=await browser.newContext({viewport:process.env.OVIS_MOBILE==='1'?{width:390,height:844}:{width:1280,height:800},locale:'en-US',recordVideo:{dir:folder,size:{width:1280,height:800}}});contexts.push(context);
  await context.addInitScript(({offset})=>{const original=Date.now;Date.now=()=>original()+offset;localStorage.setItem('ovis:settings',JSON.stringify({language:'en',defaultView:'chat',autoSendQueued:true,alertsOn:false}));},spec);
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',(e:any)=>errors.push(e.message));
  let holding=spec.hold;const held=[];await page.route('**/api/pane/conversation?**',async route=>{if(holding)held.push(route);else await route.continue()});
  await page.routeWebSocket(/\/ws(?:\?|$)/,(socket:any)=>{const up=socket.connectToServer();socket.onMessage((raw:any)=>{const f=JSON.parse(String(raw));outbound.push({...f,at:Date.now()});up.send(raw)});up.onMessage((raw:any)=>{const f=JSON.parse(String(raw));frames.push({...f,at:Date.now()});socket.send(raw)})});
  await page.goto(`http://127.0.0.1:${server.port}/?pane=${encodeURIComponent(pane)}&view=chat`);await page.locator('.conn-live').waitFor();await until(()=>frames.some(f=>f.type==='input-ready'&&f.pane_id===pane&&f.ready!==false),'clock input ready');
  if(!spec.hold&&!warm)await page.waitForFunction(()=>document.querySelectorAll('[data-chat-row]').length>0);
  await Bun.sleep(400);const text=`Reply with exactly ACK-${spec.name}. Do not run tools or read or write files.`;const started=Date.now();const composer=page.getByRole('textbox',{name:'Message',exact:true});await composer.fill(text);await page.getByRole('button',{name:'Send message',exact:true}).click();await until(()=>frames.some(f=>f.type==='submit-result'),'clock submit result');
  holding=false;for(const route of held.splice(0))await route.continue();
  const conversation=async()=>await(await fetch(`http://127.0.0.1:${server.port}/api/pane/conversation?pane_id=${encodeURIComponent(pane)}&prompts=25`)).json();await until(async()=>{const p=await conversation();return p.turns?.some(t=>t.role==='assistant'&&textOf(t).includes('ACK-'+spec.name))},'clock native answer');await Bun.sleep(6000);
  const p=await conversation();const t=p.turns.find(t=>t.role==='user'&&textOf(t)===text);const result={...spec,nativeAgent:true,transcriptFixture:false,faultInjected:false,source:p.source,submitCount:outbound.filter(f=>f.type==='submit'&&f.text===text).length,userTurns:p.turns.filter(t=>t.role==='user'&&textOf(t)===text).length,nativeTimestamp:t?.ts,serverObservedSendTime:started,fadedBubbles:await page.locator('.chat-turn-waiting').count(),uncertainCards:await page.locator('.pending-message[data-state="uncertain"]').count(),compactStatuses:await page.locator('.chat-sent-status').count(),horizontalOverflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};await page.screenshot({path:join(folder,'state.png')});
  if(spec.hold){const n=outbound.filter(f=>f.type==='submit').length;await page.reload();await page.locator('.conn-live').waitFor();await Bun.sleep(1800);Object.assign(result,{fadedAfterReload:await page.locator('.chat-turn-waiting').count(),submitsAfterReload:outbound.filter(f=>f.type==='submit').length-n});await page.screenshot({path:join(folder,'after-reload.png')})}
  const video=page.video();await context.close();Object.assign(result,{video:await video.path()});results.push(result);writeFileSync(join(evidence,'results.json'),JSON.stringify({results,errors},null,2));console.log('CLOCK_RESULT',JSON.stringify(result));assert.equal(result.userTurns,1);assert.equal(result.submitCount,1);if(process.env.OVIS_EXPECT_GREEN==='1'){assert.equal(result.fadedBubbles,0, spec.name+' leaves no duplicate');assert.equal(result.horizontalOverflow,false);if(spec.hold)assert.equal(result.compactStatuses,1);}warm=false;
 }
 console.log('DONE');
}catch(e){console.log('FAILED',String(e));if(page){await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});writeFileSync(join(evidence,'failure.json'),JSON.stringify({error:String(e),frames:frames.filter(f=>['submit-result','pending-result','pending-messages','error'].includes(f.type)),outbound:outbound.filter(f=>['submit','pending-action'].includes(f.type)),body:(await page.locator('body').innerText()).slice(-3500)},null,2));}else if(workspace){const made=JSON.parse(readFileSync(join(evidence,'owned-pane.json'),'utf8'));const read=await c.paneRead({paneId:made.pane,source:'visible'}).catch(()=>null);writeFileSync(join(evidence,'startup-failure.txt'),read?.text??'unavailable');}throw e;
}finally{await browser?.close();server?.stop(true);if(workspace)await c.herdrRpc('workspace.close',{workspace_id:workspace}).catch(()=>{});rmSync(root,{recursive:true,force:true})}
