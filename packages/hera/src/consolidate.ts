/** One pure admission gate owns bounded, source-backed library changes. */
import {sameIdentity} from '@tangleai/context';
import {createStructuredOutput} from '@tangleai/models/structured';
import {renderGmplPrompt,type GmplPromptArtifact} from '@tangleai/gmpl';
import type {MasChatClient} from '@tangleai/mas';
import type {Embedder} from '@tangleai/models/embed';
import {heraContentIdOf} from './identity.ts';
import {heraSchemaOf,validateHeraShape} from './schema.ts';
import {HeraRefusal,heraIssue,heraRefuse,type HeraOutcome} from './errors.ts';
import {selectExperiences} from './select.ts';
import {heraExperienceView} from './views.ts';
import type {HeraControlReceipts} from './operations.ts';
import type {HeraConsolidationOutput,HeraExperience,HeraLearningConfig,HeraProfile,HeraSemanticAdvantage} from './contracts.gen.ts';
/** A host-admitted contradiction must cite the mixed group's source insights. */
export interface HeraConflictEvidence {targetIds:[string,string];sourceInsightIds:string[];reason:string;}
export interface HeraConsolidationContext {
  scope:string;config:HeraLearningConfig;profile:HeraProfile;advantage:HeraSemanticAdvantage;
  conflicts:readonly HeraConflictEvidence[];history?:readonly HeraExperience[];offeredTargetIds?:readonly string[];
}
type ExperienceDraft=Omit<HeraExperience,'id'|'insightEmbedding'>;
export interface HeraConsolidationPreparation {retained:HeraExperience[];archived:HeraExperience[];created:Array<{operation:number;draft:ExperienceDraft}>;churn:{add:number;merge:number;prune:number;keep:number};}
/** Synchronous so the structured-output repair gate and materializer use the same checks. */
export function validateConsolidationPlan(raw:unknown,library:readonly HeraExperience[],context:HeraConsolidationContext):HeraOutcome<HeraConsolidationPreparation>{
  const fail=(path:string,detail:string)=>heraRefuse<HeraConsolidationPreparation>('THERA1008',path,detail);
  const shaped=validateHeraShape<HeraConsolidationOutput>('heraConsolidationOutput',raw);if(!shaped.valid)return fail(shaped.issues[0].path,shaped.issues[0].detail);
  const {config,advantage,scope}=context,plan=shaped.value;
  if(![config.operationCap,config.libraryCap].every(n=>Number.isSafeInteger(n)&&n>0))return fail('/config','Consolidation caps must be positive safe integers.');
  if(advantage.scope!==scope)return fail('/advantage/scope','Source insights belong to another scope.');
  if(plan.ops.length>config.operationCap)return fail('/ops','The operation cap is exceeded.');
  const sources=new Set(advantage.insights.map(i=>i.id));if(sources.size!==advantage.insights.length)return fail('/advantage/insights','Source insight ids must be unique.');
  const active=new Map(library.map(e=>[e.id,e])),all=new Map([...(context.history??[]),...library].map(e=>[e.id,e]));
  if(active.size!==library.length)return fail('/library','Library identities must be unique.');
  for(const [index,entry] of library.entries())if(entry.scope!==scope||entry.status!=='active'||!validateHeraShape('heraExperience',entry).valid||!sameIdentity(entry.profile.embeddedBy,context.profile.embeddedBy))
    return fail('/library/'+index,'The input library requires valid active versions in one scope.');
  const prepared:HeraConsolidationPreparation={retained:[],archived:[],created:[],churn:{add:0,merge:0,prune:0,keep:0}};
  const archive=(entry:HeraExperience)=>{active.delete(entry.id);prepared.archived.push(structuredClone(entry));};
  for(const [index,op] of plan.ops.entries()){
    const path='/ops/'+index;
    for(const [j,id] of op.sourceInsightIds.entries())if(!sources.has(id))return fail(path+'/sourceInsightIds/'+j,'The source insight does not belong to this advantage.');
    const targets:HeraExperience[]=[];
    for(const [j,id] of op.targetIds.entries()){
      if(context.offeredTargetIds&&!context.offeredTargetIds.includes(id))return fail(path+'/targetIds/'+j,'A target was not offered to this bounded consolidation proposal.');
      const entry=active.get(id);if(!entry)return fail(path+'/targetIds/'+j,'A target is not an active scoped version.');targets.push(entry);
    }
    if(op.op==='KEEP'){
      if(op.text!==undefined)return fail(path+'/text','KEEP cannot replace text.');prepared.churn.keep++;continue;
    }
    if(op.sourceInsightIds.length===0)return fail(path+'/sourceInsightIds','A library-content operation requires source insight evidence.');
    if(op.op==='PRUNE'){
      if(op.text!==undefined)return fail(path+'/text','PRUNE cannot replace text.');
      if(targets.length<2)return fail(path+'/targetIds','PRUNE names its target first and at least one conflicting sibling.');
      const target=targets[0],supported=targets.slice(1).some(sibling=>target.utility<sibling.utility&&context.conflicts.some(proof=>
        proof.targetIds.includes(target.id)&&proof.targetIds.includes(sibling.id)&&new Set(proof.targetIds).size===2&&proof.reason.trim().length>0
        &&proof.sourceInsightIds.length>0&&proof.sourceInsightIds.every(id=>sources.has(id)&&op.sourceInsightIds.includes(id))));
      if(!supported)return fail(path+'/targetIds/0','PRUNE requires lower empirical utility and an admitted source-backed conflict with a surviving sibling.');
      archive(target);prepared.churn.prune++;continue;
    }
    if(op.text===undefined||!op.text.trim())return fail(path+'/text','ADD and MERGE require replacement guidance.');
    if(op.op==='ADD'&&targets.length)return fail(path+'/targetIds','ADD cannot consume existing targets.');
    if(op.op==='MERGE'&&targets.length<2)return fail(path+'/targetIds','MERGE requires at least two active targets.');
    if(op.op==='MERGE'){
      const ancestry=new Set<string>();
      for(const target of targets){
        const pending=[target.id],seen=new Set<string>();
        while(pending.length){
          const id=pending.pop()!;if(id===target.id&&seen.has(id))return fail(path+'/targetIds','Experience ancestry contains a cycle.');
          if(seen.has(id))continue;seen.add(id);
          if(ancestry.has(id))return fail(path+'/targetIds','MERGE cannot double-count shared ancestry.');
          const ancestor=all.get(id);if(!ancestor||ancestor.scope!==scope)return fail('/history/'+id,'Merge ancestry must be retained in the same scope.');
          pending.push(...ancestor.parents);
        }
        for(const id of seen)ancestry.add(id);
      }
    }
    const useCount=targets.reduce((n,e)=>n+e.useCount,0),successCount=targets.reduce((n,e)=>n+e.successCount,0),selectionCount=targets.reduce((n,e)=>n+e.selectionCount,0);
    if(![useCount,successCount,selectionCount].every(Number.isSafeInteger))return fail(path+'/targetIds','Inherited counts must remain exact integers.');
    prepared.created.push({operation:index,draft:{scope,profile:structuredClone(context.profile),insight:op.text,
      provenance:{advantageId:advantage.id,groupId:advantage.groupId},useCount,successCount,utility:useCount?successCount/useCount:0,selectionCount,status:'active',
      parents:targets.map(e=>e.id).sort(),inheritedCounts:op.op==='MERGE'?{useCount,successCount}:null}});
    for(const target of targets)archive(target);
    if(op.op==='ADD')prepared.churn.add++;else prepared.churn.merge++;
  }
  if(active.size+prepared.created.length>config.libraryCap)return fail('/ops','The resulting library exceeds its capacity.');
  prepared.retained=[...active.values()].map(e=>structuredClone(e));return {valid:true,value:prepared};
}
/** The proposer sees a nearest-profile subset; the shared gate checks the whole library. */
export async function proposeConsolidation(library:readonly HeraExperience[],context:HeraConsolidationContext,
  host:{artifact:GmplPromptArtifact;client:MasChatClient;embedder:Embedder;receipts:HeraControlReceipts}):Promise<HeraConsolidationApplication>{
  const selected=selectExperiences(library,context.profile,{...context.config,scope:context.scope,selectorWeights:{similarity:1,utility:0,novelty:0,selectionPenalty:0}});
  if(!selected.valid)throw new HeraRefusal(selected.issues);
  const admitted={...context,offeredTargetIds:selected.value.experiences.map(e=>e.id)};
  const rendered=renderGmplPrompt(host.artifact,{scope:context.scope,insights:context.advantage.insights,library:selected.value.experiences.map(heraExperienceView),config:context.config,
    conflicts:context.conflicts.filter(c=>c.targetIds.every(id=>admitted.offeredTargetIds.includes(id)))});
  if(!rendered.valid)throw new HeraRefusal(rendered.issues.map(i=>heraIssue('THERA1001',i.path,i.detail,i)));
  const generated=await createStructuredOutput({client:host.receipts.client('learn/consolidation',host.client),schema:heraSchemaOf('heraConsolidationOutput'),maxRepairs:1,
    gate(value){const checked=validateConsolidationPlan(value,library,admitted);return checked.valid?true:{valid:false,errors:checked.issues.map(i=>({code:i.code,docPath:i.path,message:i.detail}))};}})
    .generate([{role:'system',content:rendered.value.system},{role:'user',content:rendered.value.user}]);
  if(generated.errors)throw new HeraRefusal(generated.errors.map(i=>heraIssue('THERA1008',i.docPath??i.instancePath,i.message)));
  const plan=generated.value as HeraConsolidationOutput,vectors:Record<number,HeraInsightVector>={};
  for(const [index,op] of plan.ops.entries())if(op.op==='ADD'||op.op==='MERGE'){
    const text=op.text!,embedding=await host.receipts.embed('learn/insight/'+index,text,async signal=>{
      const values=await host.embedder.embed([text],{signal}),vector=Array.from(values[0]??[]);
      if(values.length!==1||vector.length!==context.profile.embeddedBy.dims||!vector.every(Number.isFinite))throw new HeraRefusal([heraIssue('THERA1009','/embedding','The insight embedder returned an invalid vector.')]);
      return vector;
    });vectors[index]={text,embedding,embeddedBy:context.profile.embeddedBy};
  }
  const applied=await applyConsolidationPlan(plan,library,admitted,vectors);if(!applied.valid)throw new HeraRefusal(applied.issues);return applied.value;
}
export interface HeraInsightVector {text:string;embedding:number[];embeddedBy:HeraProfile['embeddedBy'];}
export interface HeraConsolidationApplication extends Omit<HeraConsolidationPreparation,'created'|'retained'> {created:HeraExperience[];library:HeraExperience[];}
/** Hashing and vector binding are pure; this function never writes or calls an embedder. */
export async function applyConsolidationPlan(raw:unknown,library:readonly HeraExperience[],context:HeraConsolidationContext,
  vectors:Readonly<Record<number,HeraInsightVector>>):Promise<HeraOutcome<HeraConsolidationApplication>>{
  const planned=validateConsolidationPlan(raw,library,context);if(!planned.valid)return planned;
  const created:HeraExperience[]=[];
  for(const {operation,draft} of planned.value.created){
    const vector=vectors[operation];
    if(!vector||vector.text!==draft.insight||!sameIdentity(vector.embeddedBy,draft.profile.embeddedBy)||vector.embedding.length!==draft.profile.embeddedBy.dims||!vector.embedding.every(Number.isFinite))
      return heraRefuse('THERA1009','/vectors/'+operation,'Guidance must bind its exact text and frozen embedding identity.');
    const content={...draft,insightEmbedding:[...vector.embedding]},entry={...content,id:await heraContentIdOf(content)},checked=validateHeraShape<HeraExperience>('heraExperience',entry);
    if(!checked.valid)return checked;created.push(entry);
  }
  const next=[...planned.value.retained,...created].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(new Set(next.map(e=>e.id)).size!==next.length)return heraRefuse('THERA1008','/ops','Consolidation produced duplicate immutable versions.');
  return {valid:true,value:{library:next,created,archived:planned.value.archived,churn:planned.value.churn}};
}
