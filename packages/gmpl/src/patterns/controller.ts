/** Bounded canonical MAS control; pure content tasks decide normal termination. */
import {defineMasWorkflow,loopInvocation,masMessage,taskInvocation,type MasWorkflow,type Invocation} from '@tangleai/mas';
import {stageAgent,stageArtifact,pureTask,inputSchema,resultSchema,objectSchema,type PatternBuildContext} from './shared.ts';
import {roundStateSchema as state} from './peer-review.ts';
export async function buildBoundedPattern(body:MasWorkflow,context:PatternBuildContext,options:{maxRounds:number;author:boolean;synthesis?:string}){
  const nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry=[{port:'input',to:{node:'initialize',port:'input'}}];
  if(options.author){
    const a=stageArtifact('peer-review-revision',context);
    nodes.push(pureTask('prepare-author','gmpl-author-prepare',{input:inputSchema},{variables:a.variableSchema}),await stageAgent('author','peer-review-revision',context));
    entry.push({port:'input',to:{node:'prepare-author',port:'input'}});
    messages.push(masMessage(['prepare-author','variables'],['author','variables']),masMessage(['author','out'],['initialize','out']));
  }
  nodes.push(taskInvocation({id:'initialize',handler:options.author?'gmpl-round-initialize':'gmpl-round-empty',input:{input:inputSchema,...(options.author?{out:stageArtifact('peer-review-revision',context).outputSchema}:{})},output:{state},statePull:[{member:'/policy',as:'policy'}]}),
    loopInvocation({id:'rounds',body:body.workflowId,input:{state},output:{next:state},init:[{port:'state',to:'/state'}],feedback:[{from:'/state',to:'/state'}],result:[{port:'next',from:'/state'}],maxIterations:options.maxRounds,termination:{$eq:['$.output.state.done',true]}}));
  messages.push(masMessage(['initialize','state'],['rounds','state']),masMessage(['rounds','next'],['finalize','state']));
  if(options.synthesis){
    const a=stageArtifact(options.synthesis,context);
    nodes.push(pureTask('prepare-synthesis','gmpl-round-synthesis',{state},{variables:a.variableSchema}),await stageAgent('synthesis',options.synthesis,context),pureTask('finalize','gmpl-round-synthesis-finalize',{state,out:a.outputSchema},{result:resultSchema}));
    messages.push(masMessage(['rounds','next'],['prepare-synthesis','state']),masMessage(['prepare-synthesis','variables'],['synthesis','variables']),masMessage(['synthesis','out'],['finalize','out']));
  }else nodes.push(pureTask('finalize','gmpl-round-finalize',{state},{result:resultSchema}));
  return defineMasWorkflow({workflowId:body.workflowId.replace(/-round$/,''),title:'Bounded pattern',description:'Declared round carry and terminal result with evidence retention.',input:objectSchema({input:inputSchema}),output:objectSchema({result:resultSchema}),entry,exit:[{port:'result',from:{node:'finalize',port:'result'}}],nodes,messages,limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
