import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {revisionOf} from '@tangleai/config';
import {gmplTextDigest} from '@tangleai/gmpl';
import {createChatClient,type ChatRequest} from '@tangleai/models/client';
import {replayKey} from '@tangleai/models/replay';
import {createGmplLocomoPlan,buildGmplLocomoReport,replayGmplLocomo,validatePlanBudget,validateReplayBundle} from '../../benchmark/lib/gmpl-locomo.ts';
import {prepareSingleAgent,driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import type {Binding,Bundle,Purchase,RunReceipt,WireEntry} from '../../benchmark/lib/gmpl-locomo.types.ts';
import type {LocomoSample} from '../../benchmark/lib/locomo.ts';
const binding:Binding={provider:'custom',baseUrl:'https://scripted.invalid/v1',model:'scripted-fixture-only',maxTokens:1024,temperature:0};
const seal=async <T extends object,K extends string>(v:T,k:K)=>({...v,[k]:await revisionOf(v)}) as T&Record<K,string>;
const reseal=async <T extends object>(v:T,key:keyof T)=>{const {[key]:_,...rest}=v;return {...rest,[key]:await revisionOf(rest)} as T;};
async function fixture(selectedBinding:Binding=binding){
  const samples:LocomoSample[]=[{sample_id:'synthetic',conversation:{speaker_a:'Ada',speaker_b:'Bob',session_1_date_time:'1:00 pm on 1 May, 2023',session_1:[{speaker:'Ada',dia_id:'D1:1',text:'The review recommends a pilot extension.'}]},qa:[1,2,3,4].flatMap(category=>Array.from({length:16},(_,i)=>({question:`What is the recommendation in review ${category}/${i}?`,answer:'pilot extension',category:category as 1|2|3|4,evidence:['D1:1']})))}];
  return createGmplLocomoPlan({dataset:{available:true,valid:true,samples,bytes:1,sha256:await revisionOf(samples)},binding:selectedBinding,sourceId:'1'.repeat(64)});
}
async function recorded(selectedBinding:Binding=binding){
  const binding=selectedBinding;
  const work=await fixture(binding),q=work.plan.questions[0],input=work.inputs.get(q.id)!;
  const result={answer:'pilot extension',disposition:'completed',claims:[{text:'pilot extension',citations:input.evidence.map(({id,digest})=>({id,digest}))}],findings:[]};
  const purchases:Purchase[]=[];let key='',request:Record<string,unknown>={},phase:Purchase['phase']='completion';
  const client=createChatClient({...binding,retry:{attempts:1},fetch:async (_url,init)=>{const {stream:_,...body}=JSON.parse(String(init?.body));request=body;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:JSON.stringify(result)},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3}}),{status:200});},cache:{get:k=>{key=k;return undefined;},set:async (_key,value)=>{const entry={...value,ms:2} as WireEntry;purchases.push({requestId:`scripted-${purchases.length}`,requestKey:key,requestIdHash:await gmplTextDigest(key),request,phase,entry,failure:null,responseId:await revisionOf({entry,failure:null}),physical:1,money:null});}}});
  const prepared=await prepareSingleAgent(128,'gmpl-locomo');
  const drive=await driveGmplWorkflow(prepared,{provider:binding.provider,input:{input},response:()=>{throw Error('Unexpected fallback');},complete:async (_node,_i,p,raw)=>{phase=p;return client.complete(raw as ChatRequest);}});
  assert.equal(drive.status,'completed');assert.equal(purchases.length,2);
  const receipt:RunReceipt=await seal({rowId:'parallel-analysis-single-agent',caseId:q.id,planId:work.plan.planId,inputId:q.inputId,evidenceId:q.evidenceId,configId:work.plan.configId,bindingId:await revisionOf(binding),original:{status:'completed' as const,outputId:await revisionOf(drive.output)},purchases},'receiptId');
  const bundle:Bundle=await seal({tier:'scripted' as const,binding,planId:work.plan.planId,runs:[receipt]},'bundleId');
  return {work,bundle};
}
it('LoCoMo plan selects 64 fixed questions, freezes evidence without gold, and validates request arithmetic',async()=>{
  const a=await fixture(),b=await fixture();assert.deepEqual(a.plan,b.plan);assert.equal(a.plan.sample.selected,64);assert.equal(a.plan.campaign.plannedRuns,768);assert.equal(a.plan.campaign.requests.physical,13824);
  for(const input of a.inputs.values()){assert.deepEqual(Object.keys(input),['caseId','query','evidence']);assert.ok(input.evidence.length);assert.ok(!JSON.stringify(input).includes('"gold"'));}
  const invalid=structuredClone(a.plan);invalid.campaign.physicalCap--;assert.throws(()=>validatePlanBudget(invalid),/cap/);
});
it('absent LoCoMo reports dataset-unavailable without a synthetic replacement',async()=>{
  const root=await mkdtemp(join(tmpdir(),'no-locomo-'));try{const work=await createGmplLocomoPlan({datasetRoot:root,sourceId:'1'.repeat(64)});assert.equal(work.plan.dataset.status,'dataset-unavailable');assert.equal(work.plan.sample.selected,0);assert.equal(work.plan.binding,null);assert.ok(work.plan.rows.every(r=>!r.eligible));}finally{await rm(root,{recursive:true,force:true});}
});
it('exact scripted wire replay preserves original costs and partial fixed denominators with zero network fallback',async()=>{
  const {work,bundle}=await recorded(),old=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Forbidden');};
  try{const report=await buildGmplLocomoReport(work,bundle),r=report.replay!;assert.equal(r.tier,'scripted');assert.equal(r.originalCost.physical,2);assert.equal(r.originalCost.normalization,1);assert.equal(r.originalCost.promptTokens,14);assert.equal(r.originalCost.ms,4);assert.equal(r.originalCost.money,null);assert.deepEqual(r.incrementalCost,{physical:0,money:0});const row=r.rows.find(r=>r.id==='parallel-analysis-single-agent')!;assert.equal(row.completed,1);assert.equal(row.f1,1/64);assert.equal(row.cases[0].citationValidity,1);assert.equal(row.cases[0].replayRequests,2);assert.ok(r.pairs.every(p=>!p.eligible&&p.delta===null));assert.equal(network,0);}finally{globalThis.fetch=old;}
});
it('replay refuses stale plan/model/request/response identities and marks evidence mismatch ineligible',async()=>{
  const {work,bundle}=await recorded();
  const stale=structuredClone(bundle);stale.binding.model='different';await assert.rejects(()=>validateReplayBundle(stale,work.plan),/Stale/);
  const response=structuredClone(bundle);response.runs[0].purchases[0].entry!.value.message={content:'changed'};response.runs[0]=await reseal(response.runs[0],'receiptId');
  const sealed=await reseal(response,'bundleId');await assert.rejects(()=>validateReplayBundle(sealed,work.plan),/response identity/);
  const unequal=structuredClone(bundle);unequal.runs[0].evidenceId='0'.repeat(64);unequal.runs[0]=await reseal(unequal.runs[0],'receiptId');const rows=(await replayGmplLocomo(work,await reseal(unequal,'bundleId'))).rows;assert.equal(rows[1].cases[0].status,'ineligible');assert.equal(rows[1].cases[0].replayRequests,0);
});
it('an exact request miss never buys a response or turns a partial receipt into success',async()=>{
  const {work,bundle}=await recorded(),changed=structuredClone(bundle);const p=changed.runs[0].purchases[0];p.request.temperature=0.5;p.requestKey=replayKey('chat',{provider:binding.provider,base:binding.baseUrl},p.request);p.requestIdHash=await gmplTextDigest(p.requestKey);changed.runs[0]=await reseal(changed.runs[0],'receiptId');const result=await replayGmplLocomo(work,await reseal(changed,'bundleId'));assert.equal(result.rows[1].cases[0].status,'ineligible');assert.equal(result.rows[1].cases[0].replayRequests,0);assert.equal(result.incrementalCost.physical,0);
});
it('replayed original failures retain their purchase and unknown usage without a second charge',async()=>{
  const {work,bundle}=await recorded(),changed=structuredClone(bundle),r=changed.runs[0],p=r.purchases[0];
  p.entry=null;p.failure='Original provider timeout';p.responseId=await revisionOf({entry:null,failure:p.failure});r.purchases=[p];r.original={status:'failed',outputId:await revisionOf(null)};changed.runs[0]=await reseal(r,'receiptId');
  const report=await replayGmplLocomo(work,await reseal(changed,'bundleId'));
  assert.equal(report.rows[1].cases[0].status,'failed');assert.equal(report.originalCost.physical,1);assert.equal(report.originalCost.unknownTokenRequests,1);assert.equal(report.originalCost.unknownMsRequests,1);assert.equal(report.incrementalCost.physical,0);
});

it('LoCoMo CLI defaults to a reproducible plan, checks without writing and refuses live or malformed modes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gmpl-locomo-cli-')),exec=promisify(execFile);
  const run=(...args:string[])=>exec(process.execPath,['benchmark/gmpl-locomo.ts',...args],{maxBuffer:1024*1024});
  try{await run('--out-dir',dir);const path=join(dir,'gmpl-locomo.json'),before=await stat(path),bytes=await readFile(path,'utf8');await run('--plan','--check','--out-dir',dir);assert.equal((await stat(path)).mtimeMs,before.mtimeMs);assert.equal(await readFile(path,'utf8'),bytes);for(const args of [['--live'],['--replay'],['--plan','--replay','missing'],['--out-dir','--check'],['positional']])await assert.rejects(run(...args));}finally{await rm(dir,{recursive:true,force:true});}
});

it('replay uses the explicitly bound provider normalization tier',async()=>{
  const {work,bundle}=await recorded({...binding,provider:'openrouter',baseUrl:'https://openrouter.ai/api/v1'});
  assert.ok(bundle.runs[0].purchases[1].request.response_format,'provider supports a structured wire schema');
  const replay=await replayGmplLocomo(work,bundle);assert.equal(replay.rows[1].cases[0].status,'completed');assert.equal(replay.incrementalCost.physical,0);
});
