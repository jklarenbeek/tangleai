/** Bounded critique observations are derived from actual MAS calls and final outputs. */
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {driveGmplWorkflow} from './gmpl-runner.ts';
import {scriptedGmplResponse} from './gmpl-scripts.ts';
import type {Case} from './gmpl-conformance.types.ts';
export async function measureGmplCritique(cases:Case[]){
  const observations:Record<string,Record<string,unknown>>={},fixture=cases.find(c=>c.oracle.requiredFindings.length)!;
  for(const pattern of ['peer-review','red-team','structured-debate'] as const){
    const p=await prepareGmplPattern({pattern});
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result,{continueRounds:true})});
    if(d.status!=='completed')throw Error(`critique ${pattern} failed: ${JSON.stringify(d.trace.run.failure)}`);
    const result=(d.output as {result:Case['script']['result']}).result,calls=d.visibility.filter(v=>v.phase==='completion');
    const count=(node:string)=>calls.filter(v=>v.node===node).length;
    if(pattern==='peer-review')observations['review-cap-returns-no-consensus']={disposition:result.disposition,rounds:count('reviewer-1')};
    if(pattern==='red-team')observations['red-cap-returns-no-consensus']={disposition:result.disposition,rounds:count('resilience-judge')};
    if(pattern==='structured-debate'){
      const stages=calls.map(c=>c.node.replace(/-\d+$/,''));
      observations['debate-position-before-rebuttal']={stages:stages.slice(0,5).filter((s,i,a)=>s!==a[i-1])};
      observations['debate-judge-before-next-round']={stages:stages.slice(4,6)};
      observations['debate-dissent-survives']={retainedFindings:fixture.oracle.requiredFindings.filter(id=>result.findings.some(f=>f.id===id)).length};
      observations['debate-last-round-stops']={disposition:result.disposition,rounds:count('judge')};
    }
  }
  return observations;
}
