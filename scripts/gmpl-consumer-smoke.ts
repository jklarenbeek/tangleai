/** Public keyless consumer. The same host is qualified from installed JavaScript. */
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runGmplExample} from '../examples/gmpl.ts';
const directory=await mkdtemp(join(tmpdir(),'gmpl-consumer-'));
const previous=globalThis.fetch;globalThis.fetch=async()=>{throw Error('GMPL consumer forbids network access');};
try{
  const rows=[];
  for(const domain of ['document-review','estimate-panel'] as const){const run=await runGmplExample(join(directory,domain+'.db'),domain);rows.push({domain,pattern:run.pattern,calls:run.calls,responses:run.responses,reopens:run.reopens,replayCalls:run.replayCalls});}
  const run=await runGmplExample(join(directory,'clarification.db'),'document-review',{pattern:'clarification'},true);
  if(run.responses!==2)throw Error('Two typed responses were not observed');
  rows.push({domain:run.domain,pattern:run.pattern,calls:run.calls,responses:run.responses,reopens:run.reopens,replayCalls:run.replayCalls});
  console.log(JSON.stringify({tier:'scripted',rows},null,2));
}finally{globalThis.fetch=previous;await rm(directory,{recursive:true,force:true});}
