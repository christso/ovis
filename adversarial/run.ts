import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = '/tmp/ovis-receipt-adversarial';
const installed = JSON.parse(readFileSync('/tmp/ovis-fork-receipt-installed.json', 'utf8')).root;
const sources = [['upstream-pr', process.cwd()], ['deployed-fork-source', installed]];
const jobs: any[] = [];
for (const [source, repo] of sources) {
  for (const phone of [false, true]) for (let trial = 0; trial < 3; trial++) jobs.push({source, repo, scenario:'recover', phone, trial, jitter:[0,30,120][trial]});
  for (const scenario of ['reload','discard-saved-copy','disconnect-before-delivery','invalid-resume-id']) for (const phone of [false,true]) jobs.push({source,repo,scenario,phone,trial:0,jitter:0});
  for (const scenario of ['flaps','isolation','bridge-restart','central-restart','early-submit']) jobs.push({source,repo,scenario,phone:false,trial:0,jitter:0});
}
const results: any[] = [];
const selected = process.env.OVIS_QA_LIMIT ? jobs.slice(0,Number(process.env.OVIS_QA_LIMIT)) : jobs;
for (const [i,job] of selected.entries()) {
  const name = `${job.source}-${job.scenario}-${job.phone?'phone':'desktop'}-${job.trial}`;
  const evidence = join(root, name); mkdirSync(evidence, { recursive:true });
  const child = Bun.spawn([process.execPath, join(root,'scenario.ts')], {env:{...process.env, OVIS_QA_REPO:job.repo, OVIS_QA_EVIDENCE:evidence, OVIS_QA_CASE:job.scenario, OVIS_QA_PHONE:job.phone?'1':'0', OVIS_QA_TRIAL:String(job.trial), OVIS_QA_JITTER:String(job.jitter)},stdout:Bun.file(join(evidence,'run.log')),stderr:Bun.file(join(evidence,'errors.log'))});
  const timer = setTimeout(()=>child.kill('SIGTERM'),60000);
  const code = await child.exited; clearTimeout(timer);
  let detail: any = null; try {detail=JSON.parse(readFileSync(join(evidence,'browser-result.json'),'utf8'));} catch {}
  results.push({name,code,detail});
  writeFileSync(join(root,'results.json'),JSON.stringify({total:selected.length,completed:results.length,passed:results.filter(r=>r.code===0).length,failed:results.filter(r=>r.code!==0).length,results},null,2)+'\n');
  console.log(`${i+1}/${selected.length}`,code===0?'PASS':'FAIL',name);
  if (code!==0) {
    console.log(readFileSync(join(evidence,'errors.log'),'utf8').slice(-4500));
    if(results.filter(r=>r.code!==0).length>=2) break;
  }
}
if(results.some(r=>r.code!==0)||results.length!==selected.length) process.exitCode=1;
