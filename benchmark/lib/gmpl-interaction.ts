/** Durable human and anonymous panel observations, separate from equal-information quality. */
import {prepareGmplPattern} from './gmpl-patterns.ts';
import {driveGmplWorkflow} from './gmpl-runner.ts';
import {scriptedGmplResponse} from './gmpl-scripts.ts';
import type {Case} from './gmpl-conformance.types.ts';
export async function measureGmplInteraction(cases:Case[]){
  const observations:Record<string,Record<string,unknown>>={},fixture=cases[0],result=fixture.script.result;
  const clarification=await prepareGmplPattern({pattern:'clarification'});
  const clear=await driveGmplWorkflow(clarification,{input:{input:fixture.input},bindings:clarification.bindings,response:scriptedGmplResponse(fixture.input,result)});
  if(clear.status!=='completed')throw Error('clear clarification did not complete');observations['clarification-clear-skips-human']={interactions:clear.trace.interactions.length};
  const humanOptions={input:{input:fixture.input},bindings:clarification.bindings,response:(node:string,i:number)=>node==='question'?{questions:[{id:'q1',text:'Clarify intent'}]}:node==='inspect'||node==='resolve'?{result,resolved:node==='resolve'&&i===2,refinedQuery:fixture.input.query}:{result}};
  const human=await driveGmplWorkflow(clarification,{...humanOptions,humanResponses:[{answers:{q1:'First supplied intent'}},{answers:{q1:'Second supplied intent'}}]});
  if(human.status!=='completed'||new Set(human.trace.interactions.map(i=>i.id)).size!==2)throw Error('two-turn clarification did not finish with distinct waits');
  observations['clarification-two-responses']={interactions:human.trace.interactions.length,responses:human.responses};
  const invalid=await driveGmplWorkflow(clarification,{...humanOptions,humanResponses:[{answers:{q1:7}}]});
  if(invalid.responseIssues.length!==1)throw Error('invalid response was not refused');
  observations['clarification-invalid-response']={code:invalid.responseIssues[0].code,path:invalid.responseIssues[0].path,responses:invalid.responses};
  const statuses:string[]=[];
  for(const waitingResolution of ['cancelled','expired'] as const){const d=await driveGmplWorkflow(clarification,{...humanOptions,waitingResolution});statuses.push(d.trace.interactions[0].status);}
  observations['clarification-cancel-expire']={statuses};
  const panel=await prepareGmplPattern({pattern:'delphi-panel'});let panelists=0,peerMessages=0,aliases:string[]=[];
  const script=scriptedGmplResponse(fixture.input,result,{continueRounds:true});
  const d=await driveGmplWorkflow(panel,{input:{input:fixture.input},bindings:panel.bindings,response:(node,i,phase,messages)=>{
    if(node.startsWith('panelist')&&phase==='completion'){
      const c=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);
      if(i===1){panelists++;if(c.peerFeedback!==null||c.ownPrevious!==null)peerMessages++;}
      else aliases=c.peerFeedback.responses.map((r:{alias:string})=>r.alias);
    }return script(node,i,phase,messages);
  }});
  if(d.status!=='completed')throw Error('panel continuation failed');const output=d.output as {result:{disposition:string}};
  observations['delphi-round-one-independent']={panelists,peerMessages};observations['delphi-peer-aliases-only']={aliases};
  observations['delphi-confidence-is-not-consensus']={disposition:output.result.disposition};
  observations['delphi-cap-returns-no-consensus']={disposition:output.result.disposition,rounds:d.visibility.filter(v=>v.node==='panelist-1'&&v.phase==='completion').length};
  return observations;
}
