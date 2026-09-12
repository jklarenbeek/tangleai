import {defineMasWorkflow,masMessage,type Invocation} from '@tangleai/mas';
import {stageAgent,stageArtifact,pureTask,inputSchema,resultSchema,objectSchema,arraySchema,type PatternBuildContext} from './shared.ts';
/** Fixed participant slots are topology. Changing N requires materialization. */
export async function buildParallelAnalysis(participants:number,context:PatternBuildContext){
  const nodes:Invocation[]=[],messages:ReturnType<typeof masMessage>[]=[],entry:Array<{port:string;to:{node:string;port:string}}>=[];
  const reportSchema=stageArtifact('analysis-analyst',context).outputSchema;
  const mergedSchema=stageArtifact('analysis-merge',context).outputSchema;
  for(let i=1;i<=participants;i++){
    const id=`analyst-${i}`,prepare=`prepare-${id}`,check=`check-${id}`;
    nodes.push(pureTask(prepare,'gmpl-analysis-prepare',{input:inputSchema},{variables:stageArtifact('analysis-analyst',context).variableSchema}),
      await stageAgent(id,'analysis-analyst',context),pureTask(check,'gmpl-stage-check',{input:inputSchema,out:reportSchema},{out:reportSchema}));
    entry.push({port:'input',to:{node:prepare,port:'input'}},{port:'input',to:{node:check,port:'input'}});
    messages.push(masMessage([prepare,'variables'],[id,'variables']),masMessage([id,'out'],[check,'out']),
      masMessage([check,'out'],['prepare-synthesis','reports'],{aggregation:'ordered-list'}),
      masMessage([check,'out'],['finalize','reports'],{aggregation:'ordered-list'}));
  }
  nodes.push(pureTask('prepare-synthesis','gmpl-analysis-synthesis',{input:inputSchema,reports:arraySchema(reportSchema)},{variables:stageArtifact('analysis-merge',context).variableSchema}),
    await stageAgent('synthesis','analysis-merge',context),pureTask('finalize','gmpl-analysis-finalize',{input:inputSchema,out:mergedSchema,reports:arraySchema(reportSchema)},{result:resultSchema}));
  entry.push({port:'input',to:{node:'prepare-synthesis',port:'input'}},{port:'input',to:{node:'finalize',port:'input'}});
  messages.push(masMessage(['prepare-synthesis','variables'],['synthesis','variables']),masMessage(['synthesis','out'],['finalize','out']));
  return defineMasWorkflow({workflowId:'gmpl-parallel-analysis',title:'Parallel analysis',description:'Independent analysis, stable ordered synthesis and evidence retention.',
    input:objectSchema({input:inputSchema}),output:objectSchema({result:resultSchema}),entry,exit:[{port:'result',from:{node:'finalize',port:'result'}}],nodes,messages,
    limits:context.limits,registryRevision:null,configRegistryRevision:null,profile:context.profile});
}
