/** Registered diagnostic interventions, outside the primary comparison denominator. */
import registration from '../fixtures/gmpl/ablations.json' with {type:'json'};
import type {GmplPatternParameters} from '@tangleai/gmpl';
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {driveGmplWorkflow} from './gmpl-runner.ts';
import {scriptedGmplResponse} from './gmpl-scripts.ts';
import {measureReceipt} from './gmpl-receipts.ts';
import type {Case,Ablation} from './gmpl-conformance.types.ts';
export async function measureAblations(cases:Case[]):Promise<Ablation[]>{
  const results:Ablation[]=[];
  for(const registered of registration){
    const fixture=cases.find(c=>c.id===registered.caseId)!;
    const p=await prepareGmplPattern(registered.parameters as GmplPatternParameters);
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result)});
    if(d.usage.roles!==registered.expectedRoles)throw Error(`${registered.id}: expected ${registered.expectedRoles} roles, observed ${d.usage.roles}`);
    results.push({id:registered.id,kind:registered.kind as Ablation['kind'],pattern:registered.pattern as Ablation['pattern'],expectedRoles:registered.expectedRoles,receipt:await measureReceipt(p,fixture,d)});
  }
  return results;
}
