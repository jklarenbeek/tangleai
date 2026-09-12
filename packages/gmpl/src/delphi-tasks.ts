/** Private panel records, a closed peer projection, and Jaren sample statistics. */
import {mean,median,stddev} from '@jarenjs/core/stats';
import {equalsJson} from '@jarenjs/core/object';
import type {MasTaskHandlerBinding} from '@tangleai/mas';
import type {GmplRoundState,DelphiPanelPoll,GmplProjectedAnswer,GmplPeerFeedback,GmplFinding} from './contracts.gen.ts';
import type {GmplAnswerProjector} from './projection.ts';
import {validateGmplShape} from './schema.ts';
import {validateGmplEvidence,mergeGmplFindings} from './evidence.ts';
import {checkedRoundState,participants,roundMax,stageVariables,supportedContradiction} from './round-tasks.ts';
import {gmplRefuse} from './errors.ts';
import {taskValue} from './tasks.ts';
interface Ports {state:GmplRoundState;out:DelphiPanelPoll;polls:DelphiPanelPoll[];}
function aliases(s:GmplRoundState){return new Map(s.findings.map((f,i)=>[`prior-finding-${i+1}`,f]));}
function accumulatedFindings(s:GmplRoundState,polls:DelphiPanelPoll[]):GmplFinding[]{
  const existing=new Set(s.findings.map(f=>f.id));
  const retained=s.findings.map(old=>{
    const proposed=polls.map(p=>p.result.findings.find(f=>f.id===old.id));
    // A shared prior finding changes disposition only on unanimous explicit
    // evidenced adjudication; divergent proposals remain visible in private polls.
    if(proposed.every(p=>p!==undefined&&equalsJson(p,proposed[0])))return proposed[0]!;
    return old;
  });
  return taskValue(mergeGmplFindings([retained,...polls.map(p=>p.result.findings.filter(f=>!existing.has(f.id)))]));
}
export function delphiTaskHandlers(projector:GmplAnswerProjector):Record<string,MasTaskHandlerBinding>{return {
  'gmpl-poll-prepare':({value,node})=>{
    const s=checkedRoundState((value as unknown as Ports).state),slot=Number(node.split('-').at(-1))-1,p=s.policy.parameters;
    const context={round:s.round,participant:`panelist-${slot+1}`,ownPrevious:s.peerFeedback?.responses[slot]??null,peerFeedback:p.pattern==='delphi-panel'&&p.peerHistory!==false?s.peerFeedback:null};
    return {variables:stageVariables(s,context)};
  },
  'gmpl-poll-check':({value})=>{
    const {state:s,out}=value as unknown as Ports,prior=aliases(s),referenced:GmplFinding[]=[];
    const findings=out.result.findings.map(f=>{const original=prior.get(f.id);if(!original)return f;referenced.push(original);return {...f,id:original.id,origin:original.origin,...(original.critical?{critical:true}:{}),...(original.contradictory?{contradictory:true}:{})};});
    return {out:{...out,result:taskValue(validateGmplEvidence({...out.result,findings},s.input.evidence,referenced))}};
  },
  'gmpl-panel-aggregate':({value})=>{
    const {state:s,polls}=value as unknown as Ports,p=s.policy.parameters,n=participants(s);
    if(p.pattern!=='delphi-panel'||polls.length!==n)taskValue(gmplRefuse('TGMPL1006','/polls','all declared panelists must return before aggregation'));
    const projected=polls.map(poll=>taskValue(validateGmplShape<GmplProjectedAnswer>('gmplProjectedAnswer',taskValue(projector.project(poll))))),domain=s.policy.domain.projection;
    if(domain.kind==='numeric'&&projected.some(v=>v.estimate===null||!Number.isFinite(v.estimate)||!domain.scale||v.estimate<domain.scale.minimum||v.estimate>domain.scale.maximum))taskValue(gmplRefuse('TGMPL1006','/estimates','numeric panel estimates must be finite and within the domain scale'));
    const values=projected.map(v=>v.estimate!),keyAgreement=projected.every(v=>v.key===projected[0].key),sampleStddev=domain.kind==='numeric'?stddev(values)!:null;
    const findings=accumulatedFindings(s,polls),threshold='threshold' in p?p.threshold??0.2:0.2;
    const converged=(domain.kind==='numeric'?sampleStddev!==null&&sampleStddev<=threshold:keyAgreement)&&!supportedContradiction({answer:'',disposition:'no-consensus',claims:[],findings});
    const statistics={kind:domain.kind,count:n,mean:domain.kind==='numeric'?mean(values)!:null,median:domain.kind==='numeric'?median(values)!:null,sampleStddev,confidenceMean:mean(polls.map(p=>p.confidence))!,keyAgreement,converged};
    const idOf=new Map(findings.map((f,i)=>[f.id,`prior-finding-${i+1}`]));
    const peerFeedback=taskValue(validateGmplShape<GmplPeerFeedback>('gmplPeerFeedback',{round:s.round,statistics,
      responses:polls.map((poll,i)=>({alias:`panel-${i+1}`,key:projected[i].key,estimate:projected[i].estimate,confidence:poll.confidence,findingIds:poll.result.findings.map(f=>idOf.get(f.id)!)})),
      findings:findings.map(f=>({id:idOf.get(f.id)!,disposition:f.disposition,critical:f.critical===true,contradictory:f.contradictory===true,citations:f.citations}))}));
    const done=converged||s.round>=roundMax(s);
    return {state:checkedRoundState({...s,polls,peerFeedback,findings,done,disposition:done?(converged?'completed':'no-consensus'):null,round:done?s.round:s.round+1,history:[...s.history,{round:s.round,draftRevision:null,action:converged?'accept':'continue',findings,polls,statistics}]})};
  },
};}
