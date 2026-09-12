/** Construction helpers emit only canonical MAS invocation and message data. */
import {agentInvocation,taskInvocation,masRevisionOf,type Invocation,type WorkflowLimits} from '@tangleai/mas';
import {gmplSchemaOf,type JsonSchema} from '../schema.ts';
import type {GmplCatalog} from '../catalog.ts';
import type {GmplDomainBinding} from '../contracts.gen.ts';
export const objectSchema=(properties:Record<string,JsonSchema>)=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const arraySchema=(items:JsonSchema)=>({type:'array',items});
export const inputSchema=gmplSchemaOf('gmplInput');
export const resultSchema=gmplSchemaOf('gmplPatternResult');
export interface PatternBuildContext {catalog:GmplCatalog;domain:GmplDomainBinding;profile:string;limits:WorkflowLimits;}
export function stageArtifact(stage:string,context:PatternBuildContext){
  const artifact=context.catalog.prompt(context.domain.rolePrompts[stage]??stage);
  if(!artifact)throw Error(`unknown stage artifact ${stage}`);return artifact;
}
export async function stageAgent(id:string,stage:string,context:PatternBuildContext):Promise<Invocation>{
  const a=stageArtifact(stage,context);
  return agentInvocation({id,role:a.role.id,instructionsRevision:await masRevisionOf(a.role.instructions),profile:context.profile,
    messageAdapter:`gmpl-${a.id}`,input:{variables:a.variableSchema},output:{out:a.outputSchema}});
}
export function pureTask(id:string,handler:string,input:Record<string,JsonSchema>,output:Record<string,JsonSchema>):Invocation{
  return taskInvocation({id,handler,input,output,effect:'pure'});
}
