/** Pure projection and validation handlers. No agent calls or private controllers. */
import type {MasTaskHandlerBinding} from '@tangleai/mas';
import {compileGmplSchema} from './schema.ts';
import {gmplRefuse} from './errors.ts';
import type {GmplPolicy} from './contracts.gen.ts';
import {validateGmplEvidence,mergeGmplFindings} from './evidence.ts';
import type {GmplInput,GmplPatternResult} from './contracts.gen.ts';
import type {GmplOutcome} from './errors.ts';
export function taskValue<T>(outcome:GmplOutcome<T>):T{
  if(!outcome.valid)throw new Error(`GMPL content refusal: ${JSON.stringify(outcome.issues)}`,{cause:outcome.issues});return outcome.value;
}
interface AnalysisPorts {input:GmplInput;out:{result:GmplPatternResult};reports:Array<{result:GmplPatternResult}>;}
export function analysisTaskHandlers():Record<string,MasTaskHandlerBinding>{
  return {
    'gmpl-domain-input':({value,state})=>{const {input}=value as unknown as AnalysisPorts,policy=state.policy as GmplPolicy;if(!compileGmplSchema(policy.domain.payloadSchema)(input).valid)taskValue(gmplRefuse('TGMPL1001','/input','input violates the bound domain schema'));return {input};},
    'gmpl-analysis-prepare':({value,node})=>{const {input}=value as unknown as AnalysisPorts;return {variables:{query:input.query,evidence:input.evidence,context:{participant:node.replace('prepare-','')}}};},
    'gmpl-stage-check':({value})=>{const {input,out}=value as unknown as AnalysisPorts;taskValue(validateGmplEvidence(out.result,input.evidence));return {out};},
    'gmpl-analysis-synthesis':({value})=>{const {input,reports}=value as unknown as AnalysisPorts;return {variables:{query:input.query,evidence:input.evidence,context:{reports}}};},
    'gmpl-analysis-finalize':({value})=>{const {input,out,reports}=value as unknown as AnalysisPorts;
      const prior=taskValue(mergeGmplFindings(reports.map(r=>r.result.findings)));
      return {result:taskValue(validateGmplEvidence(out.result,input.evidence,prior))};},
  };
}
