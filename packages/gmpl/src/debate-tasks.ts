/** Pure debate policy: attributed rounds, explicit disagreement and retained findings. */
import type {MasTaskHandlerBinding} from '@tangleai/mas';
import type {GmplRoundState,DebatePosition,DebateRebuttal,DebateJudge} from './contracts.gen.ts';
import {checkedRoundState,stageVariables,roundMax,participants,supportedContradiction} from './round-tasks.ts';
import {validateGmplEvidence,mergeGmplFindings} from './evidence.ts';
import {gmplRevisionOf} from './identity.ts';
import {gmplRefuse} from './errors.ts';
import {taskValue} from './tasks.ts';
interface Ports {state:GmplRoundState;positions:DebatePosition[];rebuttals:DebateRebuttal[];out:DebateJudge;}
function positionsView(s:GmplRoundState){return s.positions.map((output,i)=>({participant:`position-${i+1}`,output,claimIds:output.result.claims.map((_,j)=>`position-${i+1}:claim-${j+1}`)}));}
export function debateTaskHandlers():Record<string,MasTaskHandlerBinding>{return {
  'gmpl-debate-position-prepare':({value,node})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,participant:node.replace('prepare-',''),perspective:node.endsWith('-1')?'support the strongest evidenced case':'challenge the strongest evidenced case',history:s.history,findings:s.findings})};},
  'gmpl-debate-positions':({value})=>{const {state:s,positions}=value as unknown as Ports;if(positions.length!==participants(s))taskValue(gmplRefuse('TGMPL1006','/positions','missing declared position'));return {state:checkedRoundState({...s,positions,findings:taskValue(mergeGmplFindings(positions.map(p=>p.result.findings)))})};},
  'gmpl-debate-rebuttal-prepare':({value,node})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,participant:node.replace('prepare-',''),positions:positionsView(s),findings:s.findings})};},
  'gmpl-debate-rebuttals':({value})=>{
    const {state:s,rebuttals}=value as unknown as Ports;if(rebuttals.length!==participants(s))taskValue(gmplRefuse('TGMPL1006','/rebuttals','missing declared rebuttal'));
    const available=new Set([...positionsView(s).flatMap(p=>p.claimIds),...s.findings.map(f=>f.id)]);
    for(const r of rebuttals)if(r.addresses.some(id=>!available.has(id))||new Set(r.addresses).size!==r.addresses.length)taskValue(gmplRefuse('TGMPL1005','/addresses','rebuttal must address a delivered claim or finding once'));
    return {state:checkedRoundState({...s,rebuttals,findings:taskValue(mergeGmplFindings(rebuttals.map(r=>r.result.findings)))})};
  },
  'gmpl-debate-judge-prepare':({value})=>{const s=checkedRoundState((value as unknown as Ports).state);return {variables:stageVariables(s,{round:s.round,positions:positionsView(s),rebuttals:s.rebuttals,history:s.history,findings:s.findings})};},
  'gmpl-debate-gate':async({value})=>{
    const {state:s,out}=value as unknown as Ports,draft=taskValue(validateGmplEvidence(out.result,s.input.evidence,s.findings));
    const accepted=out.action==='accept'&&!supportedContradiction(draft),rejected=out.action==='reject'||out.action==='escalate',done=accepted||rejected||s.round>=roundMax(s);
    return {state:checkedRoundState({...s,draft,draftRevision:await gmplRevisionOf(draft),findings:draft.findings,done,disposition:done?(accepted?'completed':rejected?'rejected':'no-consensus'):null,round:done?s.round:s.round+1,
      history:[...s.history,{round:s.round,draftRevision:s.draftRevision,action:accepted?'accept':rejected?out.action:'continue',findings:draft.findings,positions:s.positions,rebuttals:s.rebuttals,judgment:out}]})};
  },
};}
