/** Independent forecasting oracle; no runtime adapter or evolving state. */
import {mean} from '@jarenjs/core/stats';
import type {Adapter,Snapshot} from './forecast.types.ts';

export function scoreForecast(adapter:Adapter,prediction:string|number,outcome:string|number){
  if(adapter.id==='choice/v1'){
    const unknownLabel=typeof prediction!=='string'||!adapter.options.includes(prediction);
    const success=!unknownLabel&&prediction===outcome;
    return {category:success?'success' as const:'failure' as const,utility:success?1 as const:0 as const,diagnostics:{unknownLabel}};
  }
  if(typeof prediction!=='number'||typeof outcome!=='number'||!Number.isFinite(prediction)||!Number.isFinite(outcome))throw Error('Forecast numeric scoring requires finite numbers.');
  const distance=Math.abs(prediction-outcome),utility=distance<=adapter.tolerance?1:distance<=3*adapter.tolerance ? .5 : 0;
  return {category:utility===1?'success' as const:utility===.5?'partial' as const:'failure' as const,utility:utility as 0|.5|1,diagnostics:{distance}};
}
export function parseBoxed(text:string):string{
  const matches=[...text.matchAll(/\\boxed\{([^{}]*)\}/g)],answer=matches.at(-1)?.[1].trim();
  if(!answer)throw Error('Forecast answer lacks a nonempty boxed value.');return answer;
}
export function cutoffAdmits(item:Pick<Snapshot,'availableAt'>,cutoffAt:string):{admitted:true;reason:null}|{admitted:false;reason:'post-cutoff'|'undated'}{
  if(item.availableAt===null)return {admitted:false,reason:'undated'};
  const available=Date.parse(item.availableAt),cutoff=Date.parse(cutoffAt);
  if(!Number.isFinite(available)||!Number.isFinite(cutoff))throw Error('Cutoff admission requires finite timestamps.');
  return available<=cutoff?{admitted:true,reason:null}:{admitted:false,reason:'post-cutoff'};
}
/** Convolve the exact probabilities of 0, half and full utility. */
export function analyticBand(cases:readonly {adapter:Adapter;outcome:string|number}[]){
  if(!cases.length)throw Error('An analytic forecast band requires resolved cases.');
  let distribution=[1];
  for(const {adapter,outcome} of cases){
    let success:number,partial=0;
    if(adapter.id==='choice/v1'){
      if(typeof outcome!=='string'||!adapter.options.includes(outcome))throw Error('Choice outcome is outside its registered options.');
      success=1/adapter.options.length;
    }else{
      if(typeof outcome!=='number'||!Number.isFinite(outcome))throw Error('Numeric outcome is not finite.');
      const [low,high]=adapter.range,width=high-low;if(width<=0||adapter.tolerance<=0)throw Error('Invalid uniform range or tolerance.');
      const covered=(radius:number)=>Math.max(0,Math.min(high,outcome+radius)-Math.max(low,outcome-radius))/width;
      success=covered(adapter.tolerance);partial=covered(3*adapter.tolerance)-success;
    }
    const probability=[Math.max(0,1-success-partial),partial,success],next=Array(distribution.length+2).fill(0) as number[];
    for(const [sum,p] of distribution.entries())for(const [tick,q] of probability.entries())next[sum+tick]+=p*q;
    distribution=next;
  }
  const quantile=(level:number)=>{let cumulative=0;for(const [sum,p] of distribution.entries()){cumulative+=p;if(cumulative>=level)return sum/(2*cases.length);}return 1;};
  return {level:.99 as const,low:quantile(.005),high:quantile(.995),expected:distribution.reduce((n,p,i)=>n+p*i/(2*cases.length),0),
    distribution:distribution.map((probability,tick)=>({utility:tick/(2*cases.length),probability}))};
}
export function evidenceCeiling(cases:readonly {decisiveSnapshotIds:string[];admittedIds:string[]}[]){
  return cases.length?mean(cases.map(c=>Number(c.decisiveSnapshotIds.every(id=>c.admittedIds.includes(id)))))!:null;
}
