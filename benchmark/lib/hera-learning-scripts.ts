/** Authored recipes bind only identifiers and observations visible in control prompts. */
import type {HeraConsolidationOutput,HeraReflectionOutput,HeraExperienceView} from '@tangleai/hera';
export interface HeraTrainingSequence {kind:string;training:Array<{taskId:string;serial:'incorrect'|'registered';parallel:'incorrect'|'registered';consolidation:string|null}>;heldOut:string[];
  incorrectAnswer:string;application:{serial:string;parallel:string};conflict:{taskId:string;targets:[string,string];reason:string};}
export interface HeraReflectionScript {kind:string;successFactor:string;failureMode:string;insight:{id:string;text:string};creditReason:string;referenceRecipe:string;}
export interface HeraConsolidationScript {kind:string;guidance:Record<string,string>;merged:string;plans:Record<string,Array<{op:'ADD'|'MERGE'|'PRUNE'|'KEEP';targets:string[];text?:string}>>;referenceRecipe:string;}
export function heraPromptField<T>(request:unknown,prefix:string):T{
  const messages=(request as {messages:Array<{role:string;content:string}>}).messages,text=messages.find(m=>m.role==='user')?.content;
  const line=text?.split('\n').find(line=>line.startsWith(prefix));if(!line)throw Error('Missing scripted prompt field '+prefix);return JSON.parse(line.slice(prefix.length));
}
export function heraScriptedReflection(request:unknown,script:HeraReflectionScript):HeraReflectionOutput{
  const views=heraPromptField<Array<{id:string;success:boolean;steps:Array<{id:string;invocationId:string;agentId:string}>}>>(request,'Ranked topologies, per-invocation inputs/actions/outputs, answers, task scores and provider-token costs: ');
  const good=views.find(v=>v.success),bad=views.find(v=>v.success===false),goodStep=good?.steps.find(s=>s.agentId==='conclude-agent'),badStep=bad?.steps.find(s=>s.agentId==='conclude-agent');
  if(!good||!bad||!goodStep||!badStep)throw Error('The registered mixed-group script requires concluding evidence.');
  return {successFactors:[{text:script.successFactor,trajectoryIds:[good.id],stepIds:[goodStep.id]}],failureModes:[{text:script.failureMode,trajectoryIds:[bad.id],stepIds:[badStep.id]}],
    insights:[{...script.insight,trajectoryIds:[good.id,bad.id],stepIds:[goodStep.id,badStep.id]}],failedInvocationCredit:[{invocationId:badStep.invocationId,trajectoryId:bad.id,reason:script.creditReason,stepIds:[badStep.id]}]};
}
export function heraScriptedConsolidation(request:unknown,script:HeraConsolidationScript,plan:string):HeraConsolidationOutput{
  const library=heraPromptField<HeraExperienceView[]>(request,'Active library: '),insights=heraPromptField<Array<{id:string}>>(request,'Source insights: ');
  const instructions=script.plans[plan];if(!instructions)throw Error('Unregistered consolidation recipe '+plan);
  return {ops:instructions.map(op=>({op:op.op,sourceInsightIds:op.op==='KEEP'?[]:insights.map(i=>i.id),targetIds:op.targets.map(key=>{
    const entry=library.find(e=>e.insight===script.guidance[key]);if(!entry)throw Error('Unregistered library target '+key);return entry.id;
  }),...(op.text?{text:op.text==='merged'?script.merged:script.guidance[op.text]}:{})}))};
}
