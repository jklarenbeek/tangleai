import { createMemoryLightRagStore, planContribution, planProjectionWrites, applyPlan, type LightRagStore, type GraphContributionInput, type GraphEntityClaim, type ProjectionPlanOptions, type ProjectionWritePlan, type LightRagChunkAddress } from '@tangleai/lightrag';
import type { LightRagIssue } from '@tangleai/lightrag/contracts';
import { createLightRagStore, type TangleDb } from '@tangleai/store';
import type { DocumentChunk } from '@tangleai/documents/contracts';
import schema from '@tangleai/lightrag/schemas/lightrag' with {type:'json'};
declare const db:TangleDb,input:GraphContributionInput,options:ProjectionPlanOptions,plan:ProjectionWritePlan,chunk:DocumentChunk;
const memory:LightRagStore=createMemoryLightRagStore(),durable:LightRagStore=createLightRagStore(db),address:LightRagChunkAddress=chunk;
const prepared=await planContribution(input),writes=await planProjectionWrites(options),applied=await applyPlan(durable,plan);
if(prepared.valid){const claim:GraphEntityClaim|undefined=prepared.value.input.claims.entities[0];void claim;}
if(applied.valid){const count:number=applied.value.writes;void count;}
// @ts-expect-error graph claims have a closed entity type vocabulary
const badType:GraphEntityClaim['type']='COMMUNITY';
// @ts-expect-error graph issues cannot carry an invented refusal code
const badIssue:LightRagIssue={code:'TLRAG9999',path:'',detail:'Unknown code.'};
// @ts-expect-error a contribution cannot drop its claim set
planContribution({existing:input.existing});
void [schema,memory,durable,address,writes,badType,badIssue];

import { buildContribution,createStructuredExtractor,createStructuredProfiler,createCandidateResolver,createStructuredCoreferenceJudge,lightRagPrompt,renderLightRagPrompt,type BuildContributionOptions,type StructuredGraphOptions,type GraphContribution,type GraphPreparationFailure } from '@tangleai/lightrag';
import artifacts from '@tangleai/lightrag/artifacts' with {type:'json'};
declare const buildOptions:BuildContributionOptions,modelOptions:StructuredGraphOptions;
const contribution=await buildContribution(buildOptions);
if(contribution.valid){const bundle:GraphContribution=contribution.value;const calls:number=bundle.spend.calls;void calls;}
else{const failure:GraphPreparationFailure=contribution;const completed:string[]=failure.completedChunkIds;void completed;}
const extractor=createStructuredExtractor(modelOptions),profiler=createStructuredProfiler(modelOptions),judge=createStructuredCoreferenceJudge(modelOptions);
const resolver=createCandidateResolver({lookup:async()=>input.existing,judge});
const rendered=await renderLightRagPrompt(lightRagPrompt('graph-extractor'),{chunk,entityTypes:['ORGANIZATION'],pass:0,previous:{entities:[],relations:[],contentKeywords:[]}});
const {budget:account,...unmetered}=buildOptions;
// @ts-expect-error graph preparation requires the caller's shared budget account
buildContribution(unmetered);
void [artifacts,extractor,profiler,resolver,rendered,account];
