import type { GmplIssue } from './contracts.gen.ts';
import type { MasIssue } from '@tangleai/mas';
export type GmplOutcome<T> = {valid:true;value:T}|{valid:false;issues:Array<GmplIssue|MasIssue>};
export function gmplRefuse<T=never>(code:GmplIssue['code'],path:string,detail:string,cause?:unknown):GmplOutcome<T>{
  const issue:GmplIssue={code,path,detail};
  if(cause && typeof cause==='object'){
    const e=cause as {code?:string;docPath?:string;message?:string};
    issue.cause={code:e.code??'unknown',docPath:e.docPath??'',message:e.message??String(cause)};
  }
  return {valid:false,issues:[issue]};
}
