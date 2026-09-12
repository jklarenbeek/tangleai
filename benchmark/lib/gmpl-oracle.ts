/** Independent fixture scorer. No production pattern code chooses expectations. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { f1Score } from './locomo-parity.ts';
import { createReportValidator } from './validate.ts';
import { fixtureSchema } from './gmpl-runner.ts';
import type { Case, Result, Evidence, Citation } from './gmpl-conformance.types.ts';
const checkResult=createReportValidator(fixtureSchema('result'));
const checkCase=createReportValidator(fixtureSchema('case'));
export function validateCase(value:unknown):value is Case{return checkCase(value).valid;}
export function citationInScope(c:Citation,evidence:readonly Evidence[]):boolean{
  return evidence.some(e=>e.id===c.id&&e.digest===c.digest);
}
export function scoreGmplResult(fixture:Case,output:unknown){
  if(!checkResult(output).valid)return {valid:false,utility:0,citationFidelity:0,findingRetention:0,reason:'invalid-output'};
  const result=output as Result;
  const citations=[...result.claims.flatMap(c=>c.citations),...result.findings.flatMap(f=>f.citations)];
  const fidelity=citations.length?citations.filter(c=>citationInScope(c,fixture.input.evidence)).length/citations.length:1;
  const retained=fixture.oracle.requiredFindings.filter(id=>result.findings.some(f=>f.id===id && f.reason.length>0 && f.citations.length>0 && f.citations.every(c=>citationInScope(c,fixture.input.evidence))));
  const retention=fixture.oracle.requiredFindings.length?retained.length/fixture.oracle.requiredFindings.length:1;
  const abstained=result.disposition==='needs-information'||result.disposition==='no-consensus';
  const answer=fixture.oracle.abstention?(abstained?1:0):f1Score(result.answer,fixture.oracle.answer);
  return {valid:fidelity===1&&retention===1,utility:fidelity===1&&retention===1?answer:0,citationFidelity:fidelity,findingRetention:retention,reason:fidelity!==1?'foreign-evidence':retention!==1?'lost-supported-finding':null};
}
export interface OracleTrace {speakers:string[];citations:Citation[];findings:string[];}
export function checkTrace(expected:OracleTrace,observed:OracleTrace):boolean{
  return JSON.stringify(expected.speakers)===JSON.stringify(observed.speakers)
    && expected.citations.length===observed.citations.length
    && expected.citations.every((c,i)=>c.id===observed.citations[i].id&&c.digest===observed.citations[i].digest)
    && expected.findings.every(id=>observed.findings.includes(id));
}
export async function contentId(value:unknown):Promise<string>{return canonicalSha256(value);}
