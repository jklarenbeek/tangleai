/** Observed analysis topology and reusable critique-round contracts. */
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {driveGmplWorkflow} from './gmpl-runner.ts';
import type {Case} from './gmpl-conformance.types.ts';
import type {GmplRoundState} from '@tangleai/gmpl';
const contextOf=(messages:Array<{role:string;content:string}>)=>JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);
export async function measureGmplAnalysis(cases:Case[]){
  const observations:Record<string,Record<string,unknown>>={};const fixture=cases[0];
  const p=await prepareGmplPattern(),waiting=new Map<string,()=>void>();let speakers:string[]=[];
  const measured=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,
    beforeCall:async(node,_i,phase)=>{if(!node.startsWith('analyst')||phase!=='completion')return;await new Promise<void>(resolve=>{waiting.set(node,resolve);if(waiting.size===2)queueMicrotask(()=>{waiting.get('analyst-2')!();waiting.get('analyst-1')!();});});},
    response:(node,_i,phase,messages)=>{if(node==='synthesis'&&phase==='completion')speakers=contextOf(messages).reports.map((r:{result:{answer:string}})=>r.result.answer);return {result:{...fixture.script.result,answer:node.startsWith('analyst')?node:fixture.script.result.answer}};}});
  if(measured.status!=='completed')throw Error('analysis overlap run failed');
  let active=0,maximum=0;for(const event of measured.events){if(!/^analyst-\d+:/.test(event))continue;if(event.endsWith(':enter'))maximum=Math.max(maximum,++active);else active--;}
  observations['analysis-overlap']={concurrency:maximum};observations['analysis-reverse-settle-order']={speakers};
  const failed=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>{if(node==='analyst-2')throw Error('registered missing analyst');return {result:fixture.script.result};}});
  observations['failed-member-counted']={status:failed.status,failedMembers:failed.trace.attempts.filter(a=>a.kind==='agent'&&a.status==='failed').length};
  const clean=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:()=>({result:fixture.script.result})});
  const resumed=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,crashBefore:'prepare-synthesis',response:()=>({result:fixture.script.result})});
  if(resumed.status!=='completed')throw Error('analysis replay failed');observations['committed-step-zero-spend-resume']={additionalPhysical:resumed.usage.physical-clean.usage.physical};
  const review=await prepareGmplPattern({pattern:'peer-review'},'round');let reviewers=0,peerMessages=0;
  const reviewed=await driveGmplWorkflow(review,{input:{input:fixture.input},bindings:review.bindings,response:(node,_i,phase,messages)=>{
    if(node.startsWith('reviewer')){if(phase==='completion'){reviewers++;if(Object.hasOwn(contextOf(messages),'reviews'))peerMessages++;}return {result:fixture.script.result,assessment:'accept',issues:[],strengths:[]};}return {result:fixture.script.result};}});
  if(reviewed.status!=='completed')throw Error('review round failed');
  observations['reviewer-current-cycle-isolation']={reviewers,peerMessages};observations['review-accept-skips-revision']={revisions:reviewed.visibility.filter(v=>v.node==='revision'&&v.phase==='completion').length};
  const red=await prepareGmplPattern({pattern:'red-team',maxRounds:1},'round');
  const minority=cases.find(c=>c.oracle.requiredFindings.length)!,result={...minority.script.result,findings:minority.script.result.findings.map(f=>({...f,critical:true}))};
  let attacks=0,defenses=0;
  const challenged=await driveGmplWorkflow(red,{input:{input:minority.input},bindings:red.bindings,response:(node,_i,phase,messages)=>{
    if(phase==='completion'&&node.startsWith('defense-'))attacks=contextOf(messages).attacks.length;
    if(phase==='completion'&&node==='resilience-judge')defenses=contextOf(messages).defenses.length;
    return node.startsWith('attack-')?{result,strategy:'adversarial-reframing'}:node.startsWith('defense-')?{result,mitigations:[]}:node==='resilience-judge'?{result,resilience:0.95,action:'accept'}:{result};
  }});
  if(challenged.status!=='completed')throw Error('red round failed');const state=(challenged.output as {state:GmplRoundState}).state;
  observations['red-defense-sees-current-attacks']={attacks,defenses};observations['red-critical-finding-blocks-accept']={disposition:state.disposition,criticalFindings:state.findings.filter(f=>f.critical&&f.disposition==='supported').length};
  return observations;
}
