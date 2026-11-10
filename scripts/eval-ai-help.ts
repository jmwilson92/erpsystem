/** Opt-in live eval using only synthetic product questions and existing process env.
 * Never loads dotenv, logs keys or queries an ERP database. Output is a rubric pass rate,
 * NOT a claim of complete semantic correctness or a flawless assistant. */
import fs from 'node:fs';
import { answerHelp } from '../src/lib/ai-help/answer';
import { retrieveHelp } from '../src/lib/ai-help/knowledge';
import { grokModel, grokConfigured } from '../src/lib/services/grok';
type Case={id:string;question:string;expectedSource:string|null;mustMatch:string;mustNotMatch:string|null;allowedSources?:string[]};
async function main() {
  const cases:Case[]=JSON.parse(fs.readFileSync('docs/ai-help/eval.json','utf8'));
  const live=process.argv.includes('--live');
  if(live && !grokConfigured()) throw new Error('Live eval requires securely injected XAI_API_KEY');
  const prior=process.argv.includes('--retry-failed')?JSON.parse(fs.readFileSync('docs/ai-help/eval-live-results.json','utf8')).results:[];
  function passes(c:Case,out:{text:string;citations:{id:string}[]}) {
    return new RegExp(c.mustMatch,'i').test(out.text) && (!c.mustNotMatch || !new RegExp(c.mustNotMatch,'i').test(out.text)) && (!c.expectedSource || out.citations.some(s=>(c.allowedSources || [c.expectedSource]).includes(s.id)));
  }
  const results=[];let retested=0;
  for(const c of cases) {
    const retrieved=retrieveHelp(c.question).map(e=>e.id);
    if(!live) { results.push({id:c.id,pass:!c.expectedSource || retrieved.includes(c.expectedSource),retrieved}); continue; }
    const existing=prior.find((r:{id:string})=>r.id===c.id);
    if(existing && passes(c,existing)) { results.push({...existing,pass:true});continue; }
    const out=await answerHelp(c.question);retested++;
    const pass=passes(c,out);
    results.push({id:c.id,question:c.question,pass,source:out.source,text:out.text,citations:out.citations,retrieved});
    fs.writeFileSync('/workspace/ai-help-eval-progress.json',JSON.stringify(results,null,2));
    console.log(`${c.id}: ${pass?'PASS':'FAIL'} (${out.source})`);
    // An invalid key/model/quota makes all factual cases local: stop after 3, not 50 retries.
    if(results.length===3 && results.every(r=>'source' in r && r.source==='local')) break;
  }
  const passed=results.filter(r=>r.pass).length;
  const report={mode:live?'live rubric':'retrieval coverage',model:grokModel(),retested,total:cases.length,executed:results.length,passed,percent:Math.round(passed/results.length*100),note:'Automated expected-source and regex rubric; human semantic review still required. Not a promise of perfection.',results};
  const dest=live?'docs/ai-help/eval-live-results.json':'docs/ai-help/eval-retrieval-results.json';
  fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
  console.log(`${passed}/${results.length} checks passed; ${dest}`);
  if(passed!==cases.length) process.exitCode=1;
}
main().catch(()=>{console.error('Eval failed without exposing upstream details.');process.exitCode=1;});
