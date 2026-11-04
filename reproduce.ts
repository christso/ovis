import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const repo=process.env.OVIS_REPO ?? process.cwd();
const {buildDemoApp}=await import(repo+'/scripts/demo-build.ts');
const {chromium}=await import(repo+'/node_modules/playwright-core/index.mjs');
const root=process.env.OVIS_EVIDENCE_DIR ?? '/tmp/ovis-shadow-browser-evidence';mkdirSync(root,{recursive:true});
const app=join(root,'app');await buildDemoApp(app);
const pane=JSON.parse(readFileSync(repo+'/site/demo/fixtures/panes.json','utf8')).omp;
const hook=`<script>(()=>{
 const target=${JSON.stringify(pane)},demo=window.fetch,NativeSocket=window.WebSocket;
 const params=new URLSearchParams(location.search);
 const lab=window.shadowLab={blockReads:params.get('hold')==='1',skew:Number(params.get('skew')||0),sends:0,sendAt:null,reads:[],samples:[],text:'Explain the root cause in plain English.',sockets:[]};
 const Socket=function(...args){const socket=new NativeSocket(...args);lab.sockets.push(socket);const send=socket.send.bind(socket);socket.send=raw=>{let frame;try{frame=JSON.parse(raw)}catch{};if(frame?.type==='submit'&&frame.pane_id===target){lab.sends++;lab.sendAt=Date.now();lab.delivery=frame.delivery;}return send(raw)};return socket};
 Socket.prototype=NativeSocket.prototype;Object.setPrototypeOf(Socket,NativeSocket);window.WebSocket=Socket;
 window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname!=='/api/pane/conversation'||url.searchParams.get('pane_id')!==target)return demo(input,init);
 const serve=()=>Promise.resolve(demo(input,init)).then(async response=>{if(!response.ok)return response;const body=await response.json();if(lab.sendAt!==null&&Array.isArray(body.turns))for(const turn of body.turns)if(turn.role==='user'&&turn.parts.some(part=>part.kind==='text'&&part.text===lab.text))turn.ts=new Date(lab.sendAt+lab.skew).toISOString();return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}})});
 if(!lab.blockReads)return serve();return new Promise(resolve=>lab.reads.push(()=>resolve(serve())));
 };
 lab.release=()=>{lab.blockReads=false;for(const serve of lab.reads.splice(0))serve()};
 lab.drop=()=>lab.sockets.forEach(socket=>socket.close());
 function tick(){const nodes=[...document.querySelectorAll('.chat-turn-user')].filter(node=>node.textContent.includes(lab.text));const faded=nodes.filter(node=>node.classList.contains('chat-turn-waiting'));lab.samples.push({at:performance.now(),real:nodes.length-faded.length,faded:faded.length,clock:document.querySelectorAll('.chat-sent-late').length});requestAnimationFrame(tick)}requestAnimationFrame(tick);
})();</script>`;
const index=join(app,'index.html');writeFileSync(index,readFileSync(index,'utf8').replace(/<script type="module"/,`<script src="./demo-transport.js"></script>${hook}<script type="module"`));
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async req=>{let path=decodeURIComponent(new URL(req.url).pathname).replace(/^\//,'');if(path.includes('..'))return new Response('bad',{status:400});if(!path||path.endsWith('/'))path+='index.html';const file=Bun.file(join(app,path));return await file.exists()?new Response(file):new Response('missing',{status:404})}});
const browser=await chromium.launch({executablePath:'/opt/google/chrome/chrome',headless:true,args:['--no-sandbox','--accept-lang=en-US']});
const results=[];
try{
 for(const spec of [{name:'idle-loaded',hold:false,skew:0},{name:'idle-first-read-accurate',hold:true,skew:0},{name:'idle-first-read-clock-skew',hold:true,skew:-150}]){
  const folder=join(root,spec.name);mkdirSync(folder,{recursive:true});
  const context=await browser.newContext({viewport:{width:1280,height:800},locale:'en-US',recordVideo:{dir:folder,size:{width:1280,height:800}}});
  await context.addInitScript(p=>{localStorage.setItem('ovis:settings',JSON.stringify({language:'en',alertsOn:false}));localStorage.setItem('ovis:view:'+p,'chat')},pane);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.port+'/?pane='+encodeURIComponent(pane)+'&hold='+(spec.hold?'1':'0')+'&skew='+spec.skew);
  await page.locator('.conn-live').waitFor({state:'attached'});await page.locator('.terminal-stack.is-chat').waitFor();
  const composer=page.getByRole('textbox',{name:'Message',exact:true});
  if(!spec.hold)await page.waitForFunction(()=>document.querySelectorAll('[data-chat-row]').length>=2);
  await page.waitForTimeout(500);await composer.fill('Explain the root cause in plain English.');await composer.press('Enter');
  await page.waitForFunction(()=>window.shadowLab.sends===1);
  await page.waitForTimeout(300);await page.evaluate(()=>window.shadowLab.release());
  await page.waitForTimeout(6500);
  const observed=await page.evaluate(()=>{const l=window.shadowLab;return {submits:l.sends,delivery:l.delivery,duplicates:l.samples.filter(s=>s.real>0&&s.faded>0),last:l.samples.at(-1)}});
  if(spec.skew<0&&observed.duplicates.length){await page.screenshot({path:join(folder,'duplicate.png')});console.log('VISIBLE_DUPLICATE',spec.name,JSON.stringify(observed.last));await page.waitForTimeout(55000);}
  const final=await page.evaluate(()=>{const l=window.shadowLab;return {submits:l.sends,delivery:l.delivery,firstDuplicate:l.samples.find(s=>s.real>0&&s.faded>0)??null,lastDuplicate:l.samples.findLast(s=>s.real>0&&s.faded>0)??null,last:l.samples.at(-1)}});
  await page.screenshot({path:join(folder,'final.png')});
  const video=page.video();await context.close();const videoPath=await video.path();
  const result={...spec,...final,errors,video:videoPath};results.push(result);writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2));console.log('RESULT',JSON.stringify(result));
 }
}finally{await browser.close();server.stop(true)}
