import {defineMasWorkflow,graphInvocation,masMessage,taskInvocation,type MasWorkflow} from '@tangleai/mas';
import {stageAgent,stageArtifact,pureTask,inputSchema,objectSchema,type PatternBuildContext} from './shared.ts';
import {roundStateSchema} from './peer-review.ts';
/** A reusable round consumer: author once, initialize policy, execute one child graph. */
export async function buildRoundConsumer(body:MasWorkflow,context:PatternBuildContext){
  const author=stageArtifact('peer-review-revision',context);
  return defineMasWorkflow({workflowId:`${body.workflowId}-consumer`,title:'Critique round consumer',description:'One authored draft and one inspected critique round.',
    input:objectSchema({input:inputSchema}),output:objectSchema({state:roundStateSchema}),entry:[{port:'input',to:{node:'prepare-author',port:'input'}},{port:'input',to:{node:'initialize',port:'input'}}],exit:[{port:'state',from:{node:'round',port:'state'}}],
    nodes:[pureTask('prepare-author','gmpl-author-prepare',{input:inputSchema},{variables:author.variableSchema}),await stageAgent('author','peer-review-revision',context),
      taskInvocation({id:'initialize',handler:'gmpl-round-initialize',input:{input:inputSchema,out:author.outputSchema},output:{state:roundStateSchema},statePull:[{member:'/policy',as:'policy'}]}),
      graphInvocation({id:'round',subgraph:body.workflowId,input:{state:roundStateSchema},output:{state:roundStateSchema}})],
    messages:[masMessage(['prepare-author','variables'],['author','variables']),masMessage(['author','out'],['initialize','out']),masMessage(['initialize','state'],['round','state'])],limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
