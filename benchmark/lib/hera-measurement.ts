/** Measured case joins, phase costs and the schema-owned orchestration claim. */
import {canonicalSha256} from '@jarenjs/json/canonical';
import {compileJsonQuery} from '@jarenjs/json/query';
import {equalsJson} from '@jarenjs/core/object';
import {HERA_DEFAULT_LIMITS,type HeraStore,type HeraTrajectory,type HeraUsage,type HeraLearningSnapshot} from '@tangleai/hera';
import {bootstrapInterval} from './locomo-policy.ts';
import type {HeraFixtureQuestion} from './hera-qa.ts';
import type {Row,HeraQa,CaseMeasurement,PhaseCost,MeasuredSpend,Pair} from './hera-qa.types.ts';
import schema from '../schemas/hera-qa.schema.json' with {type:'json'};

export const HERA_GROUP_BUDGET={calls:24,tokens:65536,ms:120000,turns:6,nodes:15,depth:15,fanOut:12,concurrency:4};
export const HERA_BASELINE_BUDGET={calls:HERA_DEFAULT_LIMITS.calls,tokens:HERA_DEFAULT_LIMITS.tokens,ms:HERA_DEFAULT_LIMITS.ms,turns:HERA_DEFAULT_LIMITS.toolRounds,nodes:6,depth:6,fanOut:4,concurrency:4};
/** One registered allocation policy; generated groups and fixed runs retain their distinct structural caps. */
export const heraBudgetPolicyId=()=>canonicalSha256({version:'hera-budget/v1',baseline:HERA_BASELINE_BUDGET,group:HERA_GROUP_BUDGET,refinement:HERA_GROUP_BUDGET,maxAgents:5});
export const emptyHeraPhaseCost=():PhaseCost=>({calls:0,promptTokens:0,completionTokens:0,estimatedTokens:0,unknownTokenRequests:0,ms:0,unknownMsRequests:0});
export function sumHeraPhaseCosts(costs:readonly PhaseCost[]):PhaseCost{
  const total=emptyHeraPhaseCost();for(const cost of costs)for(const key of Object.keys(total) as Array<keyof PhaseCost>)total[key]+=cost[key];return total;
}
export function heraPhaseCosts(cases:readonly CaseMeasurement[]){
  return {training:sumHeraPhaseCosts(cases.filter(c=>c.split==='training').map(c=>c.usage)),heldOut:sumHeraPhaseCosts(cases.filter(c=>c.split==='held-out').map(c=>c.usage))};
}
export function heraCosts(cases:readonly CaseMeasurement[]):NonNullable<Row['cost']>{
  const phases=heraPhaseCosts(cases);return {...sumHeraPhaseCosts(Object.values(phases)),...phases,trainingCalls:phases.training.calls,heldOutCalls:phases.heldOut.calls,money:null};
}
export async function heraPromptSizes(store:HeraStore,snapshot:HeraLearningSnapshot):Promise<Row['promptSizes']>{
  return Promise.all(Object.entries(snapshot.activePromptVersionIds).sort(([a],[b])=>a.localeCompare(b)).map(async([agentId,versionId])=>{
    const version=await store.getPromptVersion(versionId);if(!version)throw Error('A measured prompt version is missing.');
    return {agentId,versionId,bytes:new TextEncoder().encode(version.effectivePrompt).length};
  }));
}
export async function measureHeraCase(input:{question:HeraFixtureQuestion;score:{f1:number;success:number;citationRecall:number;answered:boolean};
  store:HeraStore;trajectories:readonly HeraTrajectory[];snapshotId:string;spent:MeasuredSpend;allowance:MeasuredSpend;controls?:readonly HeraUsage[];learningWrites?:number;}):Promise<CaseMeasurement>{
  const {question,score,store,trajectories,spent}=input;
  const usage:PhaseCost={calls:spent.calls,promptTokens:trajectories.reduce((n,t)=>n+t.tokens.prompt,0),completionTokens:trajectories.reduce((n,t)=>n+t.tokens.completion,0),
    estimatedTokens:trajectories.reduce((n,t)=>n+t.tokens.estimated,0),unknownTokenRequests:trajectories.reduce((n,t)=>n+t.tokens.unknownRequests,0),ms:spent.ms,
    unknownMsRequests:trajectories.reduce((n,t)=>n+t.calls,0)};
  for(const control of input.controls??[])for(const key of ['promptTokens','completionTokens','estimatedTokens','unknownTokenRequests','unknownMsRequests'] as const)usage[key]+=control[key];
  const agents=await store.query('agent',{scope:store.scope,limit:10000}),steps=await Promise.all(trajectories.flatMap(t=>t.stepIds).map(id=>store.getTrajectoryStep(id)));
  if(steps.some(s=>!s))throw Error('A measured trajectory step is missing.');
  return {taskId:question.id,split:question.split,category:question.category,profiles:[question.type],f1:score.f1,success:score.success?1:0,citationRecall:score.citationRecall,answered:score.answered,
    snapshotId:input.snapshotId,trajectoryIds:trajectories.map(t=>t.id),spent,allowance:input.allowance,usage,
    violations:{split:question.split==='held-out'?(input.learningWrites??0):0,scope:trajectories.filter(t=>t.scope!==store.scope).length+steps.filter(s=>s!.scope!==store.scope).length,
      tool:steps.reduce((n,s)=>n+s!.toolSteps.filter(t=>!agents.find(a=>a.id===s!.agentId)?.tools.includes(t.name)).length,0)}};
}
export function heraPairedInterval(deltas:readonly number[]){const options={resamples:2000,seed:17753,level:0.95};return {...bootstrapInterval(deltas,options),...options};}
export function heraMeasuredPairs(rows:readonly Row[]):Pair[]{
  const ids=rows.filter(r=>r.kind==='ablation').map(r=>r.id),specs:Array<[Row['id'],Row['id']]> = [
    ...ids.filter(id=>id!=='fixed-topology').map(id=>[id,'fixed-topology'] as [Row['id'],Row['id']]),
    ...ids.filter(id=>id!=='fixed-topology'&&id!=='hera-full').map(id=>['hera-full',id] as [Row['id'],Row['id']]),
  ];
  return specs.map(([treatment,control])=>{
    const a=rows.find(r=>r.id===treatment)!,b=rows.find(r=>r.id===control)!,own=a.measurements.filter(c=>c.split==='held-out'),base=b.measurements.filter(c=>c.split==='held-out');
    const questionIds=own.map(c=>c.taskId),matched=questionIds.length>0&&equalsJson(questionIds,base.map(c=>c.taskId));
    const identityMatch=!!a.identity&&!!b.identity&&['model','decoder','corpusRevision','evaluatorId','toolIds'].every(key=>equalsJson((a.identity as unknown as Record<string,unknown>)[key],(b.identity as unknown as Record<string,unknown>)[key]));
    const budgetPolicyMatch=!!a.identity?.budgetPolicyId&&a.identity.budgetPolicyId===b.identity?.budgetPolicyId;
    const tier:Pair['tier']=a.tier===b.tier&&a.tier!=='analytic'?a.tier:'unmeasured',eligible=matched&&identityMatch&&budgetPolicyMatch&&(tier==='live'||tier==='wire-replay');
    const deltas=matched?own.map((c,i)=>c.f1-base[i].f1):[];
    return {treatment,control,tier,eligible,identityMatch,budgetPolicyMatch,questionIds:matched?questionIds:[],deltas,
      delta:deltas.length?deltas.reduce((n,v)=>n+v,0)/deltas.length:null,interval:deltas.length?heraPairedInterval(deltas):null,
      reason:tier==='scripted'?'scripted fixture diagnostic; model quality is ineligible':eligible?'matched held-out measured comparison':'missing or incompatible comparison evidence'};
  });
}
export function heraNegativeTransfer(row:Row,fixed:Row){
  const own=row.measurements.filter(c=>c.split==='held-out'),control=new Map(fixed.measurements.filter(c=>c.split==='held-out').map(c=>[c.taskId,c]));
  return [...new Set(own.flatMap(c=>c.profiles))].sort().map(profile=>{
    const selected=own.filter(c=>c.profiles.includes(profile));if(selected.some(c=>!control.has(c.taskId)))throw Error('Profile comparison has missing control questions.');
    return {profile,delta:selected.reduce((n,c)=>n+c.f1-control.get(c.taskId)!.f1,0)/selected.length};
  });
}
export function heraSafetyCensus(rows:readonly Row[]){
  const violations={split:0,scope:0,tool:0},overruns:HeraQa['budgets']['overruns']=[];
  for(const row of rows)for(const c of row.measurements){
    for(const key of ['split','scope','tool'] as const)violations[key]+=c.violations[key];
    if((['calls','tokens','ms'] as const).some(key=>c.spent[key]>c.allowance[key]))overruns.push({rowId:row.id,taskId:c.taskId,split:c.split,spent:c.spent,allowance:c.allowance});
  }
  return {violations,budgets:{within:overruns.length===0,overruns}};
}
const claimQuery=compileJsonQuery(schema['x-claim-query']);
export function heraClaim(input:Pick<HeraQa,'rows'|'pairs'|'violations'|'budgets'>):HeraQa['claim']{
  const decision=claimQuery(input) as HeraQa['claim']['decision'];
  return {decision,reason:decision==='not-measured-live'?'Only scripted fixture execution is measured; live and wire-replay quality remain unmeasured.'
    :decision==='improves'?'The eligible paired interval excludes zero within registered budgets and with zero split, scope or tool violations.'
    :'The measured comparison does not meet the positive paired interval, budget and violation requirements.'};
}
