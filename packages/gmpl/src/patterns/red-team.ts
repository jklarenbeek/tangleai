import {defineMasWorkflow,masMessage,type Invocation} from '@tangleai/mas';
import {stageAgent,stageArtifact,pureTask,objectSchema,arraySchema,type PatternBuildContext} from './shared.ts';
import {roundStateSchema} from './peer-review.ts';
/** One attack → defense → resilience round; repetition belongs to a MAS loop. */
export async function buildRedTeamRound(participants:number,context:PatternBuildContext){
  const state=roundStateSchema,attack=stageArtifact('red-team-attack',context).outputSchema,defense=stageArtifact('red-team-defense',context).outputSchema,judge=stageArtifact('red-team-resilience',context).outputSchema;
  const nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry:Array<{port:string;to:{node:string;port:string}}>=[];
  for(const kind of ['attack','defense'] as const)for(let i=1;i<=participants;i++){
    const id=`${kind}-${i}`,prepare=`prepare-${id}`,check=`check-${id}`,stage=kind==='attack'?'red-team-attack':'red-team-defense',output=kind==='attack'?attack:defense;
    nodes.push(pureTask(prepare,`gmpl-red-${kind}-prepare`,{state},{variables:stageArtifact(stage,context).variableSchema}),await stageAgent(id,stage,context),pureTask(check,'gmpl-round-stage-check',{state,out:output},{out:output}));
    if(kind==='attack')entry.push({port:'state',to:{node:prepare,port:'state'}},{port:'state',to:{node:check,port:'state'}});
    else messages.push(masMessage(['attacks','state'],[prepare,'state']),masMessage(['attacks','state'],[check,'state']));
    messages.push(masMessage([prepare,'variables'],[id,'variables']),masMessage([id,'out'],[check,'out']),masMessage([check,'out'],[kind==='attack'?'attacks':'defenses',kind==='attack'?'attacks':'defenses'],{aggregation:'ordered-list'}));
  }
  nodes.push(pureTask('attacks','gmpl-red-attacks',{state,attacks:arraySchema(attack)},{state}),pureTask('defenses','gmpl-red-defenses',{state,defenses:arraySchema(defense)},{state}),
    pureTask('prepare-judge','gmpl-red-judge-prepare',{state},{variables:stageArtifact('red-team-resilience',context).variableSchema}),await stageAgent('resilience-judge','red-team-resilience',context),pureTask('resilience-gate','gmpl-red-gate',{state,out:judge},{state}));
  entry.push({port:'state',to:{node:'attacks',port:'state'}});
  messages.push(masMessage(['attacks','state'],['defenses','state']),masMessage(['defenses','state'],['prepare-judge','state']),masMessage(['defenses','state'],['resilience-gate','state']),masMessage(['prepare-judge','variables'],['resilience-judge','variables']),masMessage(['resilience-judge','out'],['resilience-gate','out']));
  return defineMasWorkflow({workflowId:'gmpl-red-team-round',title:'Red team round',description:'Current attacks feed defenses, current defenses feed judgment; critical findings bind acceptance.',input:objectSchema({state}),output:objectSchema({state}),entry,exit:[{port:'state',from:{node:'resilience-gate',port:'state'}}],nodes,messages,limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
