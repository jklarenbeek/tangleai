/** All positions precede all rebuttals, then judgment; the MAS loop owns repetition. */
import {defineMasWorkflow,masMessage,type Invocation} from '@tangleai/mas';
import {stageAgent,stageArtifact,pureTask,objectSchema,arraySchema,type PatternBuildContext} from './shared.ts';
import {roundStateSchema as state} from './peer-review.ts';
export async function buildDebateRound(participants:number,context:PatternBuildContext){
  const nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry:Array<{port:string;to:{node:string;port:string}}>=[];
  for(const kind of ['position','rebuttal'] as const){
    const a=stageArtifact(`debate-${kind}`,context),collection=kind==='position'?'positions':'rebuttals';
    for(let i=1;i<=participants;i++){
      const id=`${kind}-${i}`,prepare=`prepare-${id}`,check=`check-${id}`;
      nodes.push(pureTask(prepare,`gmpl-debate-${kind}-prepare`,{state},{variables:a.variableSchema}),await stageAgent(id,`debate-${kind}`,context),pureTask(check,'gmpl-round-stage-check',{state,out:a.outputSchema},{out:a.outputSchema}));
      if(kind==='position')entry.push({port:'state',to:{node:prepare,port:'state'}},{port:'state',to:{node:check,port:'state'}});
      else messages.push(masMessage(['positions','state'],[prepare,'state']),masMessage(['positions','state'],[check,'state']));
      messages.push(masMessage([prepare,'variables'],[id,'variables']),masMessage([id,'out'],[check,'out']),masMessage([check,'out'],[collection,collection],{aggregation:'ordered-list'}));
    }
    nodes.push(pureTask(collection,`gmpl-debate-${collection}`,{state,[collection]:arraySchema(a.outputSchema)},{state}));
  }
  const judge=stageArtifact('debate-judge',context);
  entry.push({port:'state',to:{node:'positions',port:'state'}});
  nodes.push(pureTask('prepare-judge','gmpl-debate-judge-prepare',{state},{variables:judge.variableSchema}),await stageAgent('judge','debate-judge',context),pureTask('judgment','gmpl-debate-gate',{state,out:judge.outputSchema},{state}));
  messages.push(masMessage(['positions','state'],['rebuttals','state']),masMessage(['rebuttals','state'],['prepare-judge','state']),masMessage(['rebuttals','state'],['judgment','state']),masMessage(['prepare-judge','variables'],['judge','variables']),masMessage(['judge','out'],['judgment','out']));
  return defineMasWorkflow({workflowId:'gmpl-structured-debate-round',title:'Debate round',description:'Independent positions, current rebuttals, evidence-bound judgment.',input:objectSchema({state}),output:objectSchema({state}),entry,exit:[{port:'state',from:{node:'judgment',port:'state'}}],nodes,messages,limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
