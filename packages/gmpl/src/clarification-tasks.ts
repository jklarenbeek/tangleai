/** Typed human input becomes labelled evidence only after durable acceptance. */
import type {MasTaskHandlerBinding} from '@tangleai/mas';
import type {GmplClarificationState,GmplInput,GmplPolicy,GmplHumanResponse,ClarificationQuestion,ClarificationResolve,GmplPatternResult} from './contracts.gen.ts';
import {validateGmplShape,compileGmplSchema} from './schema.ts';
import {validateGmplEvidence} from './evidence.ts';
import {gmplTextDigest} from './identity.ts';
import {gmplRefuse} from './errors.ts';
import {taskValue} from './tasks.ts';
interface Ports {state:GmplClarificationState;input:GmplInput;out:ClarificationResolve;response:GmplHumanResponse;}
const checked=(value:unknown)=>taskValue(validateGmplShape<GmplClarificationState>('gmplClarificationState',value));
const variables=(s:GmplClarificationState,context:unknown)=>({query:s.refinedQuery,evidence:s.input.evidence,context});
export function clarificationTaskHandlers():Record<string,MasTaskHandlerBinding>{return {
  'gmpl-clarification-initialize':({value,state})=>{
    const input=(value as unknown as Ports).input,policy=state.policy as GmplPolicy;
    if(!compileGmplSchema(policy.domain.payloadSchema)(input).valid)taskValue(gmplRefuse('TGMPL1001','/input','input violates domain schema'));
    return {state:checked({input,policy,turn:1,refinedQuery:input.query,resolved:false,done:false,questionCount:0,questions:[],history:[],findings:[],result:{answer:'',disposition:'needs-information',claims:[],findings:[]}})};
  },
  'gmpl-intent-prepare':({value})=>{const s=checked((value as unknown as Ports).state);return {variables:variables(s,{purpose:'inspect-intent',originalQuery:s.input.query,history:s.history,findings:s.findings})};},
  'gmpl-intent-inspect':({value})=>{const {state:s,out}=value as unknown as Ports;const result=taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings));return {state:checked({...s,result,findings:result.findings,refinedQuery:out.refinedQuery,resolved:out.resolved,done:out.resolved})};},
  'gmpl-clarification-retain':({value})=>({next:checked((value as unknown as Ports).state)}),
  'gmpl-question-prepare':({value})=>{const s=checked((value as unknown as Ports).state);return {variables:variables(s,{turn:s.turn,originalQuery:s.input.query,history:s.history})};},
  'gmpl-question-check':({value})=>{
    const {state:s,out}=value as unknown as {state:GmplClarificationState;out:ClarificationQuestion};
    const questions=taskValue(validateGmplShape<ClarificationQuestion>('clarification-question',out)).questions;
    if(questions.some((q,i)=>q.id!==`q${i+1}`))taskValue(gmplRefuse('TGMPL1006','/questions','question ids must be q1 through qN in declared order'));
    return {state:checked({...s,questions,questionCount:questions.length})};
  },
  'gmpl-human-response':({value})=>({response:(value as unknown as Ports).response}),
  'gmpl-human-prompt':({value})=>{const s=checked((value as unknown as Ports).state);return {prompt:{turn:s.turn,query:s.refinedQuery,questions:s.questions}};},
  'gmpl-human-evidence':async({value})=>{
    const {state:s,response}=value as unknown as Ports;
    const accepted=taskValue(validateGmplShape<GmplHumanResponse>(`gmplHumanResponse${s.questionCount}` as 'gmplHumanResponse1',response));
    const evidence=await Promise.all(s.questions.map(async q=>{const answer=accepted.answers[q.id]!;const text=`Host clarification for ${q.text}\n${answer}`;return {id:`human-turn-${s.turn}-${q.id}`,digest:await gmplTextDigest(text),text};}));
    if(evidence.some(e=>s.input.evidence.some(previous=>previous.id===e.id)))taskValue(gmplRefuse('TGMPL1005','/evidence','human evidence id collides with supplied evidence'));
    return {state:checked({...s,input:{...s.input,evidence:[...s.input.evidence,...evidence]},history:[...s.history,{turn:s.turn,questions:s.questions,response:accepted,evidenceIds:evidence.map(e=>e.id),provenance:'host-response'}]})};
  },
  'gmpl-resolve-prepare':({value})=>{const s=checked((value as unknown as Ports).state);return {variables:variables(s,{purpose:'resolve-intent',turn:s.turn,originalQuery:s.input.query,history:s.history,findings:s.findings,humanEvidencePolicy:'Host responses clarify intent; they do not independently verify external facts.'})};},
  'gmpl-intent-resolve':({value})=>{
    const {state:s,out}=value as unknown as Ports,p=s.policy.parameters;
    if(p.pattern!=='clarification')taskValue(gmplRefuse('TGMPL1006','/policy','clarification policy required'));
    const max='maxTurns' in p?p.maxTurns??5:5,result=taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings)),done=out.resolved||s.turn>=max;
    return {state:checked({...s,result,findings:result.findings,refinedQuery:out.refinedQuery,resolved:out.resolved,done,turn:done?s.turn:s.turn+1})};
  },
  'gmpl-clarification-answer':({value})=>{const s=checked((value as unknown as Ports).state);if(!s.done||!s.resolved)taskValue(gmplRefuse('TGMPL1006','/resolved','answer requires resolved intent'));return {variables:variables(s,{originalQuery:s.input.query,history:s.history,findings:s.findings})};},
  'gmpl-clarification-finalize':({value})=>{const {state:s,out}=value as unknown as {state:GmplClarificationState;out:{result:GmplPatternResult}};return {result:taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings))};},
  'gmpl-clarification-unresolved':({value})=>{const s=checked((value as unknown as Ports).state);if(!s.done||s.resolved)taskValue(gmplRefuse('TGMPL1006','/done','unresolved finalization requires exhausted turns'));return {result:taskValue(validateGmplEvidence({...s.result,disposition:'needs-information',outstandingQuestions:s.questions.map(q=>q.id)},s.input.evidence,s.findings))};},
};}
