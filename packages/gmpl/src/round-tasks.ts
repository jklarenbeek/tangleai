/** Evidence-preserving round policy expressed as pure MAS task bindings. */
import type {MasTaskHandlerBinding} from '@tangleai/mas';
import type {GmplRoundState,GmplPolicy,GmplInput,GmplPatternResult,PeerReviewReview,RedTeamAttack,RedTeamDefense,RedTeamResilience} from './contracts.gen.ts';
import {validateGmplShape,compileGmplSchema} from './schema.ts';
import {validateGmplEvidence,mergeGmplFindings} from './evidence.ts';
import {gmplRevisionOf} from './identity.ts';
import {gmplRefuse} from './errors.ts';
import {taskValue} from './tasks.ts';
interface Ports {state:GmplRoundState;input:GmplInput;out:{result:GmplPatternResult};reviews:PeerReviewReview[];attacks:RedTeamAttack[];defenses:RedTeamDefense[];}
const attackStrategies=['adversarial-reframing','edge-case-injection','assumption-challenge'] as const;
export function checkedRoundState(value:unknown):GmplRoundState{return taskValue(validateGmplShape<GmplRoundState>('gmplRoundState',value));}
export function stageVariables(state:GmplRoundState,context:unknown){return {query:state.input.query,evidence:state.input.evidence,context};}
export function roundMax(s:GmplRoundState){const p=s.policy.parameters;return 'maxRounds' in p?p.maxRounds??3:1;}
function threshold(s:GmplRoundState){const p=s.policy.parameters;return 'threshold' in p?p.threshold??0.7:0.7;}
export function participants(s:GmplRoundState){const p=s.policy.parameters;return 'participants' in p?p.participants??2:1;}
export function supportedContradiction(result:GmplPatternResult){return result.findings.some(f=>f.contradictory&&f.disposition!=='rejected-with-reason');}
function supportedCritical(result:GmplPatternResult){return result.findings.some(f=>f.critical&&(f.disposition==='supported'||f.disposition==='unresolved'||f.disposition==='contested'));}
export async function initializeGmplRound(input:GmplInput,policy:GmplPolicy,draft:GmplPatternResult):Promise<GmplRoundState>{
  if(!compileGmplSchema(policy.domain.payloadSchema)(input).valid)taskValue(gmplRefuse('TGMPL1001','/input','input violates domain schema'));
  taskValue(validateGmplEvidence(draft,input.evidence));
  return checkedRoundState({input,policy,round:1,draft,draftRevision:await gmplRevisionOf(draft),reviewedRevision:null,findings:draft.findings,reviews:[],attacks:[],defenses:[],positions:[],rebuttals:[],polls:[],peerFeedback:null,history:[],done:false,disposition:null,acceptance:null});
}
export function roundTaskHandlers():Record<string,MasTaskHandlerBinding>{
  return {
    'gmpl-round-empty':async({value,state})=>({state:await initializeGmplRound((value as unknown as Ports).input,state.policy as GmplPolicy,{answer:'',disposition:'no-consensus',claims:[],findings:[]})}),
    'gmpl-round-synthesis':({value})=>{const s=checkedRoundState((value as unknown as Ports).state);if(!s.done)taskValue(gmplRefuse('TGMPL1006','/done','synthesis requires terminal carry'));return {variables:stageVariables(s,{disposition:s.disposition,draft:s.draft,history:s.history,findings:s.findings})};},
    'gmpl-round-synthesis-finalize':({value})=>{const {state:s,out}=value as unknown as Ports;if(!s.done||!s.disposition)taskValue(gmplRefuse('TGMPL1006','/disposition','synthesis requires terminal carry'));return {result:taskValue(validateGmplEvidence({...out.result,disposition:s.disposition!},s.input.evidence,s.findings))};},
    'gmpl-author-prepare':({value})=>{const {input}=value as unknown as Ports;return {variables:{query:input.query,evidence:input.evidence,context:{purpose:'initial-author'}}};},
    'gmpl-round-initialize':async({value,state})=>{const v=value as unknown as Ports;return {state:await initializeGmplRound(v.input,state.policy as GmplPolicy,v.out.result)};},
    'gmpl-review-prepare':({value,node})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,draftRevision:s.draftRevision,draft:s.draft,participant:node.replace('prepare-','')})};},
    'gmpl-round-stage-check':({value})=>{const {state,out}=value as unknown as Ports;taskValue(validateGmplEvidence(out.result,state.input.evidence,state.findings));if('strategy' in out&&out.strategy!==attackStrategies[(state.round-1)%attackStrategies.length])taskValue(gmplRefuse('TGMPL1006','/strategy','attack changed the selected round strategy'));return {out};},
    'gmpl-review-gate':({value})=>{
      const {state:s,reviews}=value as unknown as Ports,n=participants(s);
      if(reviews.length!==n)taskValue(gmplRefuse('TGMPL1006','/reviews','every declared reviewer must return valid feedback'));
      const accepted=reviews.filter(r=>r.assessment==='accept').length,ratio=accepted/n,done=ratio>=threshold(s)||s.round>=roundMax(s);
      const findings=taskValue(mergeGmplFindings([s.findings,...reviews.map(r=>r.result.findings)]));
      const action=ratio>=threshold(s)?'accept' as const:'revise' as const;
      return {state:checkedRoundState({...s,reviews,findings,reviewedRevision:s.draftRevision,acceptance:{accepted,total:n,ratio},done,disposition:done?(action==='accept'?'completed':'no-consensus'):null,history:[...s.history,{round:s.round,draftRevision:s.draftRevision,action,findings,reviews}]})};
    },
    'gmpl-review-retain':({value})=>({next:checkedRoundState((value as unknown as Ports).state)}),
    'gmpl-revision-prepare':({value})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,draftRevision:s.draftRevision,draft:s.draft,reviews:s.reviews,findings:s.findings})};},
    'gmpl-revision-finish':async({value})=>{const {state:s,out}=value as unknown as Ports;const draft=taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings));return {next:checkedRoundState({...s,draft,draftRevision:await gmplRevisionOf(draft),findings:draft.findings,round:s.round+1})};},
    'gmpl-red-attack-prepare':({value,node})=>{const s=checkedRoundState((value as unknown as Ports).state);const strategy=attackStrategies[(s.round-1)%attackStrategies.length];return {variables:stageVariables(s,{round:s.round,proposal:s.draft,strategy,participant:node.replace('prepare-',''),previousDefenses:s.defenses})};},
    'gmpl-red-attacks':({value})=>{const {state:s,attacks}=value as unknown as Ports;if(attacks.length!==participants(s))taskValue(gmplRefuse('TGMPL1006','/attacks','missing declared attacker'));return {state:checkedRoundState({...s,attacks,findings:taskValue(mergeGmplFindings([s.findings,...attacks.map(a=>a.result.findings)]))})};},
    'gmpl-red-defense-prepare':({value,node})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,proposal:s.draft,attacks:s.attacks,findings:s.findings,participant:node.replace('prepare-','')})};},
    'gmpl-red-defenses':({value})=>{const {state:s,defenses}=value as unknown as Ports;if(defenses.length!==participants(s))taskValue(gmplRefuse('TGMPL1006','/defenses','missing declared defender'));return {state:checkedRoundState({...s,defenses,findings:taskValue(mergeGmplFindings(defenses.map(d=>d.result.findings)))})};},
    'gmpl-red-judge-prepare':({value})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,proposal:s.draft,attacks:s.attacks,defenses:s.defenses,findings:s.findings,threshold:threshold(s)})};},
    'gmpl-red-gate':async({value})=>{
      const {state:s}=value as unknown as Ports,out=(value as unknown as {out:RedTeamResilience}).out;
      const draft=taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings));
      const accepted=out.action==='accept'&&out.resilience>=threshold(s)&&!supportedCritical(draft),rejected=out.action==='reject'||out.action==='escalate';
      const done=accepted||rejected||s.round>=roundMax(s);
      return {state:checkedRoundState({...s,draft,draftRevision:await gmplRevisionOf(draft),findings:draft.findings,done,disposition:done?(accepted?'completed':rejected?'rejected':'no-consensus'):null,round:done?s.round:s.round+1,
        history:[...s.history,{round:s.round,draftRevision:s.draftRevision,action:accepted?'accept':rejected?out.action:'continue',findings:draft.findings,attacks:s.attacks,defenses:s.defenses}]})};
    },
    'gmpl-round-finalize':({value})=>{const s=checkedRoundState((value as unknown as Ports).state);if(!s.done||!s.draft||!s.disposition)taskValue(gmplRefuse('TGMPL1006','/disposition','a nonterminal round cannot become a final answer'));return {result:taskValue(validateGmplEvidence({...s.draft,findings:s.findings,disposition:s.disposition},s.input.evidence,s.findings))};},
  };
}
