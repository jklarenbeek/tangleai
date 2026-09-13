/** Keyless LoCoMo planning and exact wire replay. Dataset truth stays inside scoring. */
import {gmplPromptFiles} from '../../scripts/gmpl-sources.ts';
import {fileURLToPath} from 'node:url';
import {revisionOf} from '@tangleai/config';
import {createOfflineEmbedder} from '@tangleai/pipeline';
import {recallByEmbedding,DEFAULT_MEMORY_POLICY} from '@tangleai/memory';
import {gmplArtifacts,gmplTextDigest,GMPL_LIMITS,validateGmplEvidence,validateGmplShape,type GmplInput,type GmplPatternResult,type GmplPatternParameters} from '@tangleai/gmpl';
import {createChatClient,type ChatRequest} from '@tangleai/models/client';
import {resolveEndpoint} from '@tangleai/models/providers';
import {replayKey,verifyChatEntry} from '@tangleai/models/replay';
import type {MasChatCompletion} from '@tangleai/mas';
import {loadLocomo,type LoadOutcome} from './locomo.ts';
import {conversationCorpus,transcriptUnits} from './locomo-corpus.ts';
import {questionsOf,sampleQuestions,type QaQuestion} from './locomo-qa.ts';
import {officialScore} from './locomo-parity.ts';
import {sourceManifest} from './source-manifest.ts';
import {createReportValidator} from './validate.ts';
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {prepareSingleAgent,driveGmplWorkflow,type PreparedDrive,type ScriptedDriveOptions} from './gmpl-runner.ts';
import manifest from '../fixtures/gmpl/manifest.json' with {type:'json'};
import schema from '../schemas/gmpl-locomo.schema.json' with {type:'json'};
import type {Binding,Plan,Requests,Bundle,RunReceipt,Purchase,Cost,CaseResult,Replay,GmplLocomo} from './gmpl-locomo.types.ts';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const categories=[1,2,3,4] as const;
const maxRoles=[3,9,10,16,12,16];
const requests=(roles:number,judges=0):Requests=>({completion:roles,normalization:roles,repair:roles,tools:0,embedding:0,judgeSubset:judges*3,physical:roles*3});
const seal=async <T extends object,K extends string>(value:T,key:K)=>({...value,[key]:await revisionOf(value)}) as T&Record<K,string>;
const validator=(name:keyof typeof schema.$defs)=>createReportValidator({...schema.$defs[name],$defs:schema.$defs});
export const validateLocomoReport=createReportValidator(schema);
export interface LocomoWork {plan:Plan;inputs:Map<string,GmplInput>;truth:Map<string,QaQuestion>;}
export async function createGmplLocomoPlan(options:{dataset?:LoadOutcome;datasetRoot?:string;binding?:Binding|null;sourceId?:string}={}):Promise<LocomoWork>{
  const dataset=options.dataset??await loadLocomo(options.datasetRoot??ROOT),binding=options.binding??null;
  if(binding){if(!validator('binding')(binding).valid)throw Error('Invalid explicit model binding');const endpoint=resolveEndpoint(binding);if(endpoint.base!==binding.baseUrl)throw Error('Use the canonical credential-free base URL');const url=new URL(binding.baseUrl);if(url.username||url.password)throw Error('Credentials do not belong in a replay binding');}
  const embedder=createOfflineEmbedder();
  const retrieval={id:'near-raw-offline-frozen-v1',model:embedder.model,dims:embedder.dims,k:10,minScore:0,policyId:await revisionOf(DEFAULT_MEMORY_POLICY)};
  const inputs=new Map<string,GmplInput>(),truth=new Map<string,QaQuestion>();
  const all:QaQuestion[]=[];
  const corpora=new Map<string,ReturnType<typeof conversationCorpus>>();
  if(dataset.available&&dataset.valid)for(const sample of dataset.samples){const corpus=conversationCorpus(sample);corpora.set(sample.sample_id,corpus);all.push(...questionsOf(sample,corpus));}
  const sampled=sampleQuestions(all,{seed:17753,perCategory:16,adversarial:0});
  for(const [sampleId,corpus] of corpora){
    const selected=sampled.filter(q=>q.sampleId===sampleId);if(!selected.length)continue;
    const units=transcriptUnits(corpus),vectors=units.length?await embedder.embed(units.map(u=>u.text)):[];
    const embedded=units.map((unit,i)=>({...unit,embedding:Array.from(vectors[i]),embeddedBy:{model:embedder.model,dims:embedder.dims}}));
    const queryVectors=await embedder.embed(selected.map(q=>q.text));
    for(const [i,q] of selected.entries()){
      const recalled=recallByEmbedding(embedded,queryVectors[i],{k:retrieval.k,minScore:retrieval.minScore,identity:{model:embedder.model,dims:embedder.dims}});
      const evidence=await Promise.all(recalled.ranked.map(async ({unit})=>({id:unit.evidence,digest:await gmplTextDigest(unit.text),text:unit.text})));
      inputs.set(q.id,{caseId:q.id,query:q.text,evidence});truth.set(q.id,q);
    }
  }
  const questions:Plan['questions']=await Promise.all(sampled.map(async q=>{const input=inputs.get(q.id)!;return {id:q.id,category:q.category as 1|2|3|4,inputId:await revisionOf(input),evidenceId:await revisionOf(input.evidence),evidence:input.evidence.map(({id,digest})=>({id,digest}))};}));
  const missingByCategory=categories.map(category=>({category,missing:16-sampled.filter(q=>q.category===category).length}));
  const reason=missingByCategory.some(c=>c.missing)?'incomplete registered sample':binding===null?'model binding unassigned':null;
  const rows=manifest.patterns.flatMap((pattern,i)=>[{id:pattern,pattern,kind:'pattern' as const,eligible:reason===null,reason,maxRoles:maxRoles[i],requests:requests(maxRoles[i],i===2||i===3?3:0)},{id:`${pattern}-single-agent`,pattern,kind:'single-agent' as const,eligible:reason===null,reason,maxRoles:1,requests:requests(1)}]);
  const campaignRequests=Object.fromEntries(Object.keys(requests(0)).map(key=>[key,rows.reduce((sum,row)=>sum+row.requests[key as keyof Requests]*64,0)])) as unknown as Requests;
  let sourceId=options.sourceId;
  if(!sourceId){const packs=await gmplPromptFiles(ROOT);const source=await sourceManifest(ROOT,['scripts/gmpl-sources.ts','scripts/runtime-fixture.ts','package.json','package-lock.json','.nvmrc','release.config.json','benchmark/gmpl-locomo.ts','benchmark/schemas/gmpl-locomo.schema.json','test/benchmark/gmpl-locomo.test.ts',...packs],['benchmark/lib','benchmark/fixtures/gmpl','examples','packages/gmpl/src','packages/gmpl/artifacts','packages/gmpl/schemas','packages/mas/src','packages/mas/schemas','packages/models/src','packages/config/src','packages/config/schemas','packages/context/src','packages/core/src','packages/memory/src','packages/memory/schemas','packages/pipeline/src','packages/store/src','packages/agents/src']);sourceId=source.sha256;}
  const plan=await seal({sourceId,dataset:{status:dataset.available?(dataset.valid?'available':'invalid'):'dataset-unavailable',sha256:dataset.available?dataset.sha256:null,reason:dataset.available?(dataset.valid?null:dataset.errors.join('; ')):'LoCoMo submodule unavailable; git submodule update --init benchmark/locomo'},sample:{seed:17753,perCategory:16,adversarial:0,planned:64,selected:questions.length,missingByCategory},questions,sampleId:await revisionOf(questions.map(q=>q.id)),evidenceId:await revisionOf(questions.map(q=>({id:q.id,evidenceId:q.evidenceId}))),binding,configId:await revisionOf({profile:'gmpl-locomo',binding,caps:GMPL_LIMITS,retrieval}),promptId:gmplArtifacts.revision,retrieval,rows,caps:{...GMPL_LIMITS},campaign:{plannedRuns:768,requests:campaignRequests,physicalCap:campaignRequests.physical,concurrency:4,httpAttempts:1,deadlineMs:120000,money:null,moneyReason:'No price data or live model binding has been purchased.'}},'planId') as Plan;
  if(!validator('plan')(plan).valid)throw Error('Invalid LoCoMo plan');
  validatePlanBudget(plan);
  return {plan,inputs,truth};
}
export function validatePlanBudget(plan:Plan):void{
  for(const row of plan.rows){const r=row.requests;if(r.physical!==r.completion+r.normalization+r.repair+r.tools+r.embedding||r.physical>plan.caps.calls||r.judgeSubset>r.physical)throw Error('Invalid per-run request arithmetic');}
  for(const key of Object.keys(plan.campaign.requests) as Array<keyof Requests>)if(plan.campaign.requests[key]!==plan.rows.reduce((n,r)=>n+r.requests[key]*64,0))throw Error('Invalid campaign request arithmetic');
  if(plan.campaign.physicalCap!==plan.campaign.requests.physical||plan.campaign.physicalCap>plan.campaign.plannedRuns*plan.caps.calls)throw Error('Invalid campaign cap');
}
export const emptyOriginalCost=():Cost=>({physical:0,completion:0,normalization:0,repair:0,promptTokens:0,completionTokens:0,unknownTokenRequests:0,ms:0,unknownMsRequests:0,money:0});
export function originalCost(purchases:Purchase[]):Cost{
  const cost=emptyOriginalCost();for(const p of purchases){cost.physical++;cost[p.phase]++;const usage=p.entry?.value.usage as {prompt_tokens?:number;completion_tokens?:number}|undefined;
    if(typeof usage?.prompt_tokens==='number'&&Number.isFinite(usage.prompt_tokens)&&usage.prompt_tokens>=0&&typeof usage.completion_tokens==='number'&&Number.isFinite(usage.completion_tokens)&&usage.completion_tokens>=0){cost.promptTokens+=usage.prompt_tokens;cost.completionTokens+=usage.completion_tokens;}else cost.unknownTokenRequests++;
    if(p.entry)cost.ms+=p.entry.ms;else cost.unknownMsRequests++;
    cost.money=cost.money===null||p.money===null?null:cost.money+p.money;
  }return cost;
}
async function checkSealed(value:Record<string,unknown>,key:string){const {[key]:id,...payload}=value;if(id!==await revisionOf(payload))throw Error(`Stale ${key}`);}
export async function validateReplayBundle(value:unknown,plan:Plan):Promise<Bundle>{
  if(!validator('bundle')(value).valid)throw Error('Invalid replay bundle schema');const b=value as Bundle;
  await checkSealed(b as unknown as Record<string,unknown>,'bundleId');
  if(b.planId!==plan.planId||await revisionOf(b.binding)!==await revisionOf(plan.binding))throw Error('Replay plan/model binding mismatch');
  const seen=new Set<string>(),requestIds=new Set<string>();
  for(const r of b.runs){await checkSealed(r as unknown as Record<string,unknown>,'receiptId');const key=`${r.rowId}/${r.caseId}`;if(seen.has(key))throw Error('Duplicate replay run');seen.add(key);
    if(!plan.rows.some(row=>row.id===r.rowId)||!plan.questions.some(q=>q.id===r.caseId))throw Error('Unregistered replay row/question');
    if(r.purchases.length>plan.caps.calls)throw Error('Original receipt exceeds per-run request cap');
    for(const p of r.purchases){
      if(requestIds.has(p.requestId))throw Error('Duplicate original request id');requestIds.add(p.requestId);
      const key=replayKey('chat',{provider:b.binding.provider,base:b.binding.baseUrl},p.request);
      if(p.requestKey!==key||p.requestIdHash!==await gmplTextDigest(key))throw Error('Replay request identity mismatch');
      if(p.request.model!==b.binding.model||Object.hasOwn(p.request,'stream'))throw Error('Replay effective model/request mismatch');
      if((p.entry===null)===(p.failure===null))throw Error('Original request must contain exactly one response or failure');
      if(p.entry){verifyChatEntry(p.entry);if(!Number.isFinite(p.entry.ms)||p.entry.ms<0)throw Error('Invalid original latency');}
      if(p.responseId!==await revisionOf({entry:p.entry,failure:p.failure}))throw Error('Replay response identity mismatch');
    }
  }
  if(b.runs.reduce((n,r)=>n+r.purchases.length,0)>plan.campaign.physicalCap)throw Error('Original receipts exceed campaign cap');
  return b;
}
// Keys are strings already canonicalized by the shared wire seam; hash their actual UTF-8 bytes.
export async function replayGmplLocomo(work:LocomoWork,raw:unknown):Promise<Replay>{
  const {plan}=work;if(!validator('plan')(plan).valid)throw Error('Invalid replay plan');await checkSealed(plan as unknown as Record<string,unknown>,'planId');validatePlanBudget(plan);
  for(const q of plan.questions){const input=work.inputs.get(q.id);if(!input||await revisionOf(input)!==q.inputId||await revisionOf(input.evidence)!==q.evidenceId)throw Error('Reconstructed evidence/input identity mismatch');}const bundle=await validateReplayBundle(raw,plan),rows:Replay['rows']=[];
  const bindingId=await revisionOf(bundle.binding);
  for(const row of plan.rows){
    const prepared:PreparedDrive&{bindings?:ScriptedDriveOptions['bindings']}=row.kind==='single-agent'?await prepareSingleAgent(128,'gmpl-locomo'):await prepareGmplPattern({pattern:row.pattern as GmplPatternParameters['pattern']},'pattern',{profile:'gmpl-locomo'});
    const cases:CaseResult[]=[];
    for(const q of plan.questions){
      const receipt=bundle.runs.find(r=>r.rowId===row.id&&r.caseId===q.id),cost=originalCost(receipt?.purchases??[]);
      const base={caseId:q.id,category:q.category,receiptId:receipt?.receiptId??null,requestIds:receipt?.purchases.map(p=>p.requestId)??[],originalCost:cost,replayRequests:0,f1:0,citationValidity:0};
      if(!receipt){cases.push({...base,status:'missing',reason:'original receipt missing'});continue;}
      if(receipt.planId!==plan.planId||receipt.inputId!==q.inputId||receipt.evidenceId!==q.evidenceId||receipt.configId!==plan.configId||receipt.bindingId!==bindingId){cases.push({...base,status:'ineligible',reason:'original input/evidence/config/model identity mismatch'});continue;}
      let cursor=0,miss:string|null=null;
      const client=createChatClient({...bundle.binding,retry:{attempts:1},fetch:async()=>{throw Error('Replay transport forbidden');},cache:{
        get:async key=>{const purchase=receipt.purchases[cursor];if(!purchase||purchase.requestKey!==key){miss='missing or mismatched exact wire request';throw Error(miss);}cursor++;if(purchase.failure!==null)throw Error(purchase.failure);return structuredClone(purchase.entry);},
        set:()=>{throw Error('Replay cannot buy or write a response');},
      }});
      const input=work.inputs.get(q.id)!;
      const drive=await driveGmplWorkflow(prepared,{provider:bundle.binding.provider,input:{input},bindings:prepared.bindings,response:()=>{throw Error('Replay cannot use scripted fallback');},complete:async (_node,_invocation,phase,request)=>{
        const p=receipt.purchases[cursor];if(p&&p.phase!==phase){miss='original request phase mismatch';throw Error(miss);}return await client.complete({...request as ChatRequest,signal:AbortSignal.timeout(plan.campaign.deadlineMs)}) as MasChatCompletion;
      }});
      base.replayRequests=cursor;
      const matched=!miss&&cursor===receipt.purchases.length&&drive.status===receipt.original.status&&await revisionOf(drive.output??null)===receipt.original.outputId;
      if(!matched){cases.push({...base,status:'ineligible',reason:miss??'original result/status or request census mismatch'});continue;}
      const result=drive.status==='completed'?(drive.output as {result:unknown}).result:null;
      const valid=validateGmplShape<GmplPatternResult>('gmplPatternResult',result);
      const evidence=valid.valid?validateGmplEvidence(valid.value,input.evidence):null;
      const truth=work.truth.get(q.id)!;
      const score=valid.valid&&evidence?.valid&&truth.answer!==undefined?officialScore({category:q.category,prediction:valid.value.answer,answer:truth.answer}):null;
      cases.push({...base,status:drive.status as CaseResult['status'],reason:drive.status==='completed'?(valid.valid&&evidence?.valid?null:'invalid output or citations'):receipt.original.status,f1:score?.scored?score.f1:0,citationValidity:evidence?.valid?1:0});
    }
    const completed=cases.filter(c=>c.status==='completed'&&c.reason===null).length,total=cases.reduce((n,c)=>n+c.f1,0);
    rows.push({id:row.id,planned:64,completed,eligible:row.eligible&&cases.length===64&&!cases.some(c=>c.status==='missing'||c.status==='ineligible'),f1:total/64,conditionalF1:completed?total/completed:null,categories:categories.map(category=>({category,planned:16,completed:cases.filter(c=>c.category===category&&c.status==='completed'&&c.reason===null).length,f1:cases.filter(c=>c.category===category).reduce((n,c)=>n+c.f1,0)/16})),cases});
  }
  return {bundleId:bundle.bundleId,tier:bundle.tier,rows,pairs:manifest.patterns.map(pattern=>{const p=rows.find(r=>r.id===pattern)!,c=rows.find(r=>r.id===pattern+'-single-agent')!,eligible=p.eligible&&c.eligible;return {pattern,eligible,delta:eligible?p.f1-c.f1:null};}),originalCost:originalCost(bundle.runs.flatMap(r=>r.purchases)),incrementalCost:{physical:0,money:0}};
}
export async function buildGmplLocomoReport(work:LocomoWork,bundle?:unknown):Promise<GmplLocomo>{
  const report=await seal({instrument:'gmpl-locomo' as const,plan:work.plan,replay:bundle===undefined?null:await replayGmplLocomo(work,bundle),limitations:[
    'Live pattern-versus-single-agent LoCoMo quality is not measured. No live transport mode is provided.',
    'The selected evidence is frozen using the existing near-raw retrieval path with the offline lexical embedder; no gold enters retrieval or role inputs.',
    'All rows retain 64 planned questions, 16 per category 1–4. Category 5 is excluded. Missing/failed answers score zero.',
    'Clarification receives no additional human information. Waiting runs remain visible.',
    'Recorded-wire is an operator provenance assertion. Hashes verify exact bytes and replay compatibility, not that a provider was contacted. Scripted receipts remain scripted.',
    'Original purchases, including failures and unknown usage, are counted separately from zero incremental replay transport. No price data is assumed.',
    'Dataset text is read from the LoCoMo submodule and is not redistributed in the report; only evidence addresses and digests are emitted.'
  ]},'reportId');
  if(!validateLocomoReport(report).valid)throw Error('Invalid LoCoMo report');return report;
}
export function renderGmplLocomo(report:GmplLocomo):string{
  const p=report.plan;
  return `# GMPL LoCoMo plan and replay\n\nGenerated by \`npm run benchmark:gmpl:locomo\`. Report \`${report.reportId}\`.\n\nDataset: ${p.dataset.status}; selected ${p.sample.selected}/64 questions with seed 17753, 16 per category 1–4. Model: ${p.binding?.model??'unassigned'}.\n\nPlan \`${p.planId}\`; source \`${p.sourceId}\`; evidence \`${p.evidenceId}\`; prompts \`${p.promptId}\`; configuration \`${p.configId}\`.\n\n${p.campaign.plannedRuns} planned runs. Worst-case physical requests: ${p.campaign.requests.physical} (${p.campaign.requests.completion} completion, ${p.campaign.requests.normalization} normalization, ${p.campaign.requests.repair} repair; ${p.campaign.requests.judgeSubset} are pattern-judge requests already included). Offline embeddings/tools/external scorers require 0 physical requests. Per-run caps: \`${JSON.stringify(p.caps)}\`. Concurrency 4, one HTTP attempt, 120-second deadline. Monetary estimate: unknown.\n\nReplay: ${report.replay?`${report.replay.tier}; ${report.replay.originalCost.physical} original requests, 0 incremental requests. See JSON for every case, category and pair.`:'not supplied; no model-quality score measured'}.\n\n${report.limitations.map(s=>'- '+s).join('\n')}\n`;
}
