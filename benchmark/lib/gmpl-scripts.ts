/** Scripted role outputs use registered visible input/result data, never scorer truth. */
import type {GmplInput,GmplPatternResult} from '@tangleai/gmpl';
import type {ScriptedDriveOptions} from './gmpl-runner.ts';
export function scriptedGmplResponse(input:GmplInput,result:GmplPatternResult,options:{continueRounds?:boolean}={}):ScriptedDriveOptions['response']{
  return (node,_i,_phase,messages)=>{
    const action=options.continueRounds||result.disposition!=='completed'?'continue':'accept';
    if(node.startsWith('reviewer'))return {result,assessment:action==='accept'?'accept':'minor-revision',issues:[],strengths:[]};
    if(node.startsWith('attack')){const context=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);return {result,strategy:context.strategy};}
    if(node.startsWith('defense'))return {result,mitigations:[]};
    if(node==='resilience-judge')return {result,resilience:0.9,action};
    if(node.startsWith('position'))return {result:result.claims.length||result.findings.length?result:{...result,claims:[{text:result.answer,citations:input.evidence.slice(0,1).map(({id,digest})=>({id,digest}))}]},stance:node};
    if(node.startsWith('rebuttal'))return {result,addresses:[result.findings[0]?.id??'position-1:claim-1']};
    if(node==='judge')return {result,action};
    if(node==='inspect'||node==='resolve')return {result,resolved:result.disposition==='completed',refinedQuery:input.query};
    if(node==='question')return {questions:[{id:'q1',text:'What is the intended scope?'}]};
    if(node.startsWith('panelist'))return {result,answerKey:action==='accept'?result.answer:Number(node.split('-').at(-1))%2?'option-a':'option-b',estimate:null,confidence:0.9};
    return {result};
  };
}
