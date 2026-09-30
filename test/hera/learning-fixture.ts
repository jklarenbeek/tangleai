import type {HeraReflectionOutput,HeraConsolidationOutput} from '@tangleai/hera';
import {HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {groupFixture,serialPlan,parallelPlan} from './group-fixture.ts';
export const learningConfig={...HERA_EXAMPLE_CONFIG,flags:{experience:true,rope:false,mutation:false}};
export function promptField(request:unknown,prefix:string):unknown{
  const text=(request as {messages:Array<{role:string;content:string}>}).messages.find(m=>m.role==='user')!.content;
  const line=text.split('\n').find(line=>line.startsWith(prefix));if(!line)throw Error('Missing prompt field '+prefix);return JSON.parse(line.slice(prefix.length));
}
export function reflectScript(request:unknown):HeraReflectionOutput{
  const views=promptField(request,'Ranked topologies, per-invocation inputs/actions/outputs, answers, task scores and provider-token costs: ') as Array<{id:string;success:boolean;steps:Array<{id:string;invocationId:string}>}>;
  const good=views.find(v=>v.success)!,bad=views.find(v=>!v.success)!,step=bad.steps.at(-1)!;
  return {successFactors:[{text:'The parallel path retained supporting evidence.',trajectoryIds:[good.id],stepIds:[good.steps[0].id]}],
    failureModes:[{text:'The serial path did not complete.',trajectoryIds:[bad.id],stepIds:[step.id]}],
    insights:[{id:'supported-path',text:'Retain a complete supporting evidence path.',trajectoryIds:[good.id,bad.id],stepIds:[good.steps[0].id,step.id]}],
    failedInvocationCredit:[{invocationId:step.invocationId,trajectoryId:bad.id,reason:'The retained failing path did not produce an answer.',stepIds:[step.id]}]};
}
export async function learningFixture(options:Parameters<typeof groupFixture>[0]&{consolidate?:(request:unknown)=>HeraConsolidationOutput|Promise<HeraConsolidationOutput>}={}){
  return groupFixture({...options,config:options.config??learningConfig,control:options.control??(async(stage,_attempt,request)=>{
    if(stage==='profile')return {text:'Identify the director and their school.',tags:['two-hop']};
    if(stage.startsWith('plan/'))return [serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])];
    if(stage==='learn/reflection')return reflectScript(request);
    if(stage==='learn/consolidation')return options.consolidate?options.consolidate(request):{ops:[{op:'ADD',sourceInsightIds:['supported-path'],targetIds:[],text:'Retain a complete supporting evidence path.'}]};
    throw Error('Unexpected stage '+stage);
  })});
}
