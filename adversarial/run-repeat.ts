import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const root='/tmp/ovis-receipt-adversarial';
const installed=JSON.parse(readFileSync('/tmp/ovis-fork-receipt-installed.json','utf8')).root;
const results=[];
for(const [name,repo] of [['upstream-pr',process.cwd()],['deployed-fork-source',installed]]) {
 const evidence=root+'/'+name+'-repeat-resume-phone'; mkdirSync(evidence,{recursive:true});
 const child=Bun.spawn([process.execPath,root+'/scenario-repeat.ts'],{env:{...process.env,OVIS_QA_REPO:repo,OVIS_QA_EVIDENCE:evidence,OVIS_QA_CASE:'repeat-resume',OVIS_QA_PHONE:'1'},stdout:Bun.file(evidence+'/run.log'),stderr:Bun.file(evidence+'/errors.log')});
 const timer=setTimeout(()=>child.kill('SIGTERM'),60000); const code=await child.exited; clearTimeout(timer);
 let detail=null;try{detail=JSON.parse(readFileSync(evidence+'/browser-result.json','utf8'));}catch{}
 results.push({name,code,detail}); writeFileSync(root+'/repeat-results.json',JSON.stringify(results,null,2)+'\n');
 console.log(code===0?'PASS':'FAIL',name,'six repeated successful reconnects');
 if(code!==0){console.log(readFileSync(evidence+'/errors.log','utf8').slice(-4500));process.exitCode=1;}
}
