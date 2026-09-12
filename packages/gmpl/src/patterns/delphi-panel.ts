/** Independent current-round polling and one deterministic aggregate; repetition is MAS. */
import {defineMasWorkflow,masMessage,type Invocation} from '@tangleai/mas';
import {roundStateSchema as state} from './peer-review.ts';
import {stageAgent,stageArtifact,pureTask,objectSchema,arraySchema,type PatternBuildContext} from './shared.ts';
export async function buildDelphiRound(participants:number,context:PatternBuildContext){
  const poll=stageArtifact('delphi-panel-poll',context),nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry:Array<{port:string;to:{node:string;port:string}}>=[{port:'state',to:{node:'aggregate',port:'state'}}];
  for(let i=1;i<=participants;i++){
    const id=`panelist-${i}`,prepare=`prepare-${id}`,check=`check-${id}`;
    nodes.push(pureTask(prepare,'gmpl-poll-prepare',{state},{variables:poll.variableSchema}),await stageAgent(id,'delphi-panel-poll',context),pureTask(check,'gmpl-poll-check',{state,out:poll.outputSchema},{out:poll.outputSchema}));
    entry.push({port:'state',to:{node:prepare,port:'state'}},{port:'state',to:{node:check,port:'state'}});
    messages.push(masMessage([prepare,'variables'],[id,'variables']),masMessage([id,'out'],[check,'out']),masMessage([check,'out'],['aggregate','polls'],{aggregation:'ordered-list'}));
  }
  nodes.push(pureTask('aggregate','gmpl-panel-aggregate',{state,polls:arraySchema(poll.outputSchema)},{state}));
  return defineMasWorkflow({workflowId:'gmpl-delphi-panel-round',title:'Anonymous panel round',description:'Private attributed polls become a closed peer-feedback projection and sample statistics.',input:objectSchema({state}),output:objectSchema({state}),entry,exit:[{port:'state',from:{node:'aggregate',port:'state'}}],nodes,messages,limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
