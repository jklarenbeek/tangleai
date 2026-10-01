/** The shared model mechanism owns decoding, schema validation and one repair. */
import { createStructuredOutput } from '@tangleai/models/structured';
import type { createChatClient } from '@tangleai/models';
import type { LightRagPromptArtifact,LightRagModelIdentity } from './contracts.gen.ts';
import { LIGHTRAG_PROMPT_SHAPES,renderLightRagPrompt } from './prompts.ts';
import { lightRagSchemaOf,validateLightRagShape } from './schema.ts';
import { lightragMust,lightragReject } from './errors.ts';
import { createLightRagMeter,graphStageFailure,type LightRagBudget,type LightRagClock,type LightRagStageOutcome } from './meter.ts';
export interface LightRagChatClient {
    endpoint:{provider:string;model:string};
    complete:ReturnType<typeof createChatClient>['complete'];
}
export interface StructuredGraphOptions {client:LightRagChatClient;budget:LightRagBudget;artifact:LightRagPromptArtifact;clock:LightRagClock;maxRepairs?:0|1;}
export function graphClientIdentity(client:LightRagChatClient):LightRagModelIdentity {
    const value={provider:client.endpoint.provider,model:client.endpoint.model};
    if(!value.provider||!value.model)throw new TypeError('The injected graph client must name its provider and model.');
    return Object.freeze(value);
}
export async function runStructuredGraph(options:StructuredGraphOptions,input:unknown,gate?:(value:unknown)=>unknown):Promise<LightRagStageOutcome<unknown>>{
    const meter=createLightRagMeter(options.budget,options.clock);let attempts=0;
    try{
        if(options.maxRepairs!==undefined&&options.maxRepairs!==0&&options.maxRepairs!==1)throw new TypeError('Graph content allows at most one repair.');
        const rendered=lightragMust(await renderLightRagPrompt(options.artifact,input));
        const output=LIGHTRAG_PROMPT_SHAPES[options.artifact.role][1];
        const client={endpoint:options.client.endpoint,complete:async(request:Parameters<LightRagChatClient['complete']>[0])=>{
            return meter.run(()=>options.client.complete(request),JSON.stringify(request.messages),reply=>({usage:reply.usage,text:reply.message?.content??''}));
        }};
        const generator=createStructuredOutput({client,schema:lightRagSchemaOf(output),name:options.artifact.id.replaceAll('-','_'),maxRepairs:options.maxRepairs??1,
            ...(gate?{gate}:{}),onAttempt:event=>{attempts=event.attempt;}});
        const result=await generator.generate([{role:'system',content:rendered.system},{role:'user',content:rendered.user}]);
        attempts=result.attempts;
        if(result.errors)lightragReject('TLRAG1004',result.errors[0]?.instancePath??'','Model content remains invalid after bounded repair.');
        const value=lightragMust(validateLightRagShape(output,result.value));
        return {valid:true,value,spend:meter.spent(),attempts};
    }catch(cause){return graphStageFailure(cause,meter.spent(),Math.max(attempts,meter.spent().calls));}
}
