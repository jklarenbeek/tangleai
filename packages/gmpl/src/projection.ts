/** Pure answer projection bindings are versioned host capabilities, never serialized code. */
import type {GmplDomainBinding,DelphiPanelPoll,GmplProjectedAnswer} from './contracts.gen.ts';
import {gmplRefuse,type GmplOutcome} from './errors.ts';
export interface GmplAnswerProjector {id:string;version:string;project:(poll:DelphiPanelPoll)=>GmplOutcome<GmplProjectedAnswer>;}
export function bindGmplAnswerProjector(domain:GmplDomainBinding,provided?:GmplAnswerProjector):GmplOutcome<GmplAnswerProjector>{
  const expected=domain.projection;
  const builtin=expected.version==='1'&&(expected.id==='text-answer'&&expected.kind==='text'||expected.id==='estimate-answer'&&expected.kind==='numeric');
  const binding=provided??(builtin?{id:expected.id,version:expected.version,project:(poll:DelphiPanelPoll):GmplOutcome<GmplProjectedAnswer>=>({valid:true,value:{key:poll.answerKey.normalize('NFKC').trim().toLowerCase(),estimate:expected.kind==='numeric'?poll.estimate:null}})}:undefined);
  if(!binding||binding.id!==expected.id||binding.version!==expected.version||typeof binding.project!=='function')return gmplRefuse('TGMPL1007','/answerProjector','host answer projector does not match the domain identity');
  return {valid:true,value:Object.freeze({id:binding.id,version:binding.version,project:binding.project})};
}
