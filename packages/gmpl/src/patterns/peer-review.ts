import {defineMasWorkflow,masMessage,switchInvocation,type Invocation} from '@tangleai/mas';
import {gmplSchemaOf} from '../schema.ts';
import {stageAgent,stageArtifact,pureTask,objectSchema,arraySchema,type PatternBuildContext} from './shared.ts';
export const roundStateSchema=gmplSchemaOf('gmplRoundState');
/** One review cycle, with a declared accept/retain versus revise switch. */
export async function buildPeerReviewRound(participants:number,context:PatternBuildContext){
  const state=roundStateSchema,review=stageArtifact('peer-review-review',context).outputSchema,revision=stageArtifact('peer-review-revision',context).outputSchema;
  const nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry:Array<{port:string;to:{node:string;port:string}}>=[];
  for(let i=1;i<=participants;i++){
    const id=`reviewer-${i}`,prepare=`prepare-${id}`,check=`check-${id}`;
    nodes.push(pureTask(prepare,'gmpl-review-prepare',{state},{variables:stageArtifact('peer-review-review',context).variableSchema}),await stageAgent(id,'peer-review-review',context),pureTask(check,'gmpl-round-stage-check',{state,out:review},{out:review}));
    entry.push({port:'state',to:{node:prepare,port:'state'}},{port:'state',to:{node:check,port:'state'}});
    messages.push(masMessage([prepare,'variables'],[id,'variables']),masMessage([id,'out'],[check,'out']),masMessage([check,'out'],['acceptance','reviews'],{aggregation:'ordered-list'}));
  }
  nodes.push(pureTask('acceptance','gmpl-review-gate',{state,reviews:arraySchema(review)},{state}),
    switchInvocation({id:'route-review',input:{state},output:{next:state},mode:'one-of',default:'revise',branches:[
      {id:'retain',when:{$eq:['$.state.done',true]},nodes:['retain-reviewed'],result:{node:'retain-reviewed',port:'next'}},
      {id:'revise',when:{$eq:['$.state.done',false]},nodes:['prepare-revision','revision','finish-revision'],result:{node:'finish-revision',port:'next'}},
    ]}),pureTask('retain-reviewed','gmpl-review-retain',{state},{next:state}),
    pureTask('prepare-revision','gmpl-revision-prepare',{state},{variables:stageArtifact('peer-review-revision',context).variableSchema}),
    await stageAgent('revision','peer-review-revision',context),pureTask('finish-revision','gmpl-revision-finish',{state,out:revision},{next:state}));
  entry.push({port:'state',to:{node:'acceptance',port:'state'}});
  messages.push(masMessage(['acceptance','state'],['route-review','state']),masMessage(['route-review','state'],['retain-reviewed','state']),masMessage(['route-review','state'],['prepare-revision','state']),masMessage(['route-review','state'],['finish-revision','state']),masMessage(['prepare-revision','variables'],['revision','variables']),masMessage(['revision','out'],['finish-revision','out']));
  return defineMasWorkflow({workflowId:'gmpl-peer-review-round',title:'Peer review round',description:'Independent reviews of one immutable draft; threshold and last-round guards.',input:objectSchema({state}),output:objectSchema({state}),entry,exit:[{port:'state',from:{node:'route-review',port:'next'}}],nodes,messages,limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
