/** Preparation uses injected seams and returns an evidenced plan without an active-store write. */
import { equalsJson } from '@jarenjs/core/object';
import type { DocumentChunk } from '@tangleai/documents/contracts';
import type { Embedder } from '@tangleai/models/embed';
import type { GraphContribution,GraphPreparationFailure,GraphClaimSet,GraphChunkProfile,GraphChunkFailure,GraphEntity,GraphRelation,GraphContributionInput,LightRagIdentities,LightRagSpend } from './contracts.gen.ts';
import type { Extractor,GraphExtractionOptions } from './extract.ts';
import type { Profiler } from './profile.ts';
import type { CandidateResolver,GraphResolution } from './resolve.ts';
import { embedGraphText } from './embed.ts';
import { validateGraphClaim } from './integrity.ts';
import { emptyGraphSpend,addGraphSpend,graphStageFailure,type LightRagBudget,type LightRagClock,type LightRagStageOutcome } from './meter.ts';
import { canonicalGraphRevisionOf,canonicalRelationIdOf,contributionRevisionOf,immutableLightRagJson } from './identity.ts';
import { planContribution,prepareGraphProfileBasis } from './plan.ts';
import { validateLightRagShape } from './schema.ts';
import { lightragMust,lightragReject,lightragFailure,type LightRagOutcome } from './errors.ts';
export type GraphContributionOutcome={valid:true;value:GraphContribution}|({valid:false}&GraphPreparationFailure);
export interface BuildContributionOptions {
    chunks:readonly DocumentChunk[];sourceId?:string;versionId?:string;
    extractor:Extractor;profiler:Profiler;resolver:CandidateResolver;embedder:Embedder;
    budget:LightRagBudget;clock:LightRagClock;identities:LightRagIdentities;
    extraction?:GraphExtractionOptions;batchSize?:number;retiredClaimIds?:readonly string[];
}
const sorted=(values:readonly string[])=>[...new Set(values)].sort();
async function stamp<T extends object>(row:T){return {...row,revision:await canonicalGraphRevisionOf(row)};}
function rawProfile(claims:readonly{description:string}[]):string{return [...new Set(claims.map(row=>row.description))].join('\n');}
function failed(result:Extract<LightRagStageOutcome<unknown>,{valid:false}>,spend:LightRagSpend,completedChunkIds:string[]):GraphContributionOutcome{
    return {valid:false,...lightragMust(validateLightRagShape('graphPreparationFailure',{issues:result.issues,spend,completedChunkIds,stopReason:result.stopReason}))};
}
function incomingEntities(claims:GraphClaimSet,resolution:GraphResolution){
    return resolution.groups.filter(group=>group.incomingClaimIds.length).map(group=>({group,claims:group.incomingClaimIds.map(id=>claims.entities.find(row=>row.id===id)!)}));
}
export async function buildContribution(options:BuildContributionOptions):Promise<GraphContributionOutcome>{
    let spend=emptyGraphSpend();const completedChunkIds:string[]=[],failures:GraphChunkFailure[]=[],warnings:string[]=[];
    try{
        const identities=lightragMust(validateLightRagShape('lightRagIdentities',options.identities));
        const sourceId=options.sourceId??options.chunks[0]?.sourceId,versionId=options.versionId??options.chunks[0]?.versionId;
        if(!sourceId||!versionId||options.chunks.some(chunk=>chunk.sourceId!==sourceId||chunk.versionId!==versionId)||new Set(options.chunks.map(chunk=>chunk.id)).size!==options.chunks.length)
            lightragReject('TLRAG1003','/chunks','A prepared contribution needs distinct chunks from one named document source and version.');
        for(const [role,seam]of [['extraction',options.extractor],['profiling',options.profiler],['deduplication',options.resolver]]as const)
            if(!equalsJson(seam.modelIdentity,identities.model)||identities.prompts[role]!==seam.promptRevision||seam.budget!==null&&seam.budget!==options.budget)
                lightragReject('TLRAG1002','/identities','An injected graph stage differs from its registered model, prompt identity or shared budget.');
        if(options.embedder.model!==identities.embedder.model||options.embedder.dims!==undefined&&options.embedder.dims!==identities.embedder.dims)
            lightragReject('TLRAG1002','/identities/embedder','The injected graph embedder differs from its registered identity.');
        const claims:GraphClaimSet={entities:[],relations:[]},profiles:GraphChunkProfile[]=[];
        for(const chunk of [...options.chunks].sort((a,b)=>a.order-b.order||(a.id<b.id?-1:1))){
            const result=await options.extractor(chunk,options.extraction);spend=addGraphSpend(spend,result.spend);
            if(!result.valid){
                if(result.issues.some(issue=>issue.code==='TLRAG1005'))return failed(result,spend,completedChunkIds);
                failures.push({chunkId:chunk.id,issues:result.issues,attempts:result.attempts,spend:result.spend});continue;
            }
            for(const claim of result.value.claims.entities)lightragMust(await validateGraphClaim('entity',claim,[chunk]));
            for(const claim of result.value.claims.relations)lightragMust(await validateGraphClaim('relation',claim,[chunk]));
            if(result.value.profile.chunkId!==chunk.id||result.value.profile.versionId!==versionId)lightragReject('TLRAG1003','/profile','The extracted profile belongs to another chunk.');
            lightragMust(validateLightRagShape('graphChunkProfile',result.value.profile));
            completedChunkIds.push(chunk.id);claims.entities.push(...result.value.claims.entities);claims.relations.push(...result.value.claims.relations);profiles.push(result.value.profile);warnings.push(...result.value.warnings);
        }
        const retiredClaimIds=sorted(options.retiredClaimIds??[]).filter(id=>![...claims.entities,...claims.relations].some(claim=>claim.id===id));
        const resolved=await options.resolver({claims:claims.entities,retiredClaimIds});spend=addGraphSpend(spend,resolved.spend);if(!resolved.valid)return failed(resolved,spend,completedChunkIds);
        const resolution=resolved.value,entityGroups=incomingEntities(claims,resolution),entityText=entityGroups.map(row=>row.group.normalizedName);
        const entityVectors=await embedGraphText({embedder:options.embedder,texts:entityText,batchSize:options.batchSize,budget:options.budget,clock:options.clock,expectedEmbeddedBy:identities.embedder});
        spend=addGraphSpend(spend,entityVectors.spend);if(!entityVectors.valid)return failed(entityVectors,spend,completedChunkIds);
        const entities:GraphEntity[]=[];
        for(const [index,{group,claims:support}]of entityGroups.entries())entities.push(await stamp({id:group.id,...(group.identityClaimId?{identityClaimId:group.identityClaimId}:{}),name:group.name,normalizedName:group.normalizedName,
            aliases:sorted(support.map(row=>row.name).filter(name=>name!==group.name)),types:[group.type],profile:rawProfile(support),supportClaimIds:sorted(support.map(row=>row.id)),supportChunkIds:sorted(support.map(row=>row.chunkId)),
            embedding:entityVectors.value.vectors[index],embeddedBy:identities.embedder,status:'active' as const}));
        const owner=new Map(resolution.groups.flatMap(group=>group.claimIds.map(id=>[id,group.id]as const)));
        const relationGroups=new Map<string,{sourceEntityId:string;targetEntityId:string;themes:string[];claims:GraphClaimSet['relations']}>();
        for(const claim of claims.relations){
            const endpoint=(name:string)=>sorted(claims.entities.filter(row=>row.chunkId===claim.chunkId&&row.normalizedName===name).flatMap(row=>owner.has(row.id)?[owner.get(row.id)!]:[]));
            const source=endpoint(claim.normalizedSource),target=endpoint(claim.normalizedTarget);
            if(source.length!==1||target.length!==1)lightragReject('TLRAG1003','/relations','A relation endpoint must resolve unambiguously through its own chunk claims.');
            const id=await canonicalRelationIdOf(source[0],target[0],claim.themes),group=relationGroups.get(id)??{sourceEntityId:source[0],targetEntityId:target[0],themes:claim.themes,claims:[]};group.claims.push(claim);relationGroups.set(id,group);
        }
        const orderedRelations=[...relationGroups].sort(([a],[b])=>a<b?-1:1),relationVectors=await embedGraphText({embedder:options.embedder,texts:orderedRelations.map(([,row])=>row.themes.join(' | ')),batchSize:options.batchSize,budget:options.budget,clock:options.clock,expectedEmbeddedBy:identities.embedder});
        spend=addGraphSpend(spend,relationVectors.spend);if(!relationVectors.valid)return failed(relationVectors,spend,completedChunkIds);
        const relations:GraphRelation[]=[];
        for(const [index,[id,group]]of orderedRelations.entries())relations.push(await stamp({id,sourceEntityId:group.sourceEntityId,targetEntityId:group.targetEntityId,themes:group.themes,strength:Math.max(...group.claims.map(row=>row.strength)),profile:rawProfile(group.claims),
            supportClaimIds:sorted(group.claims.map(row=>row.id)),supportChunkIds:sorted(group.claims.map(row=>row.chunkId)),embedding:relationVectors.value.vectors[index],embeddedBy:identities.embedder,status:'active' as const}));
        const chunks=[...new Map([...options.chunks,...resolution.existing.claims.entities,...resolution.existing.claims.relations].map(row=>{const id='chunkId'in row?row.chunkId:row.id;return [id,{id,sourceId:row.sourceId,versionId:row.versionId}]as const;})).values()];
        const input:GraphContributionInput={claims,profiles,chunks,existing:resolution.existing,candidates:{entities,relations},retiredClaimIds,merges:resolution.merges,reviews:resolution.reviews,profileUpdates:[],embeddedBy:identities.embedder};
        const basis=lightragMust(await prepareGraphProfileBasis(input));
        for(const request of basis){
            const result=await options.profiler(request);spend=addGraphSpend(spend,result.spend);if(!result.valid)return failed(result,spend,completedChunkIds);
            if(!equalsJson(result.value.basisClaimIds,request.claimIds))lightragReject('TLRAG1003','/profile','The profiler did not bind the exact current supporting claims.');
            input.profileUpdates.push({kind:request.kind,id:request.id,claimIds:request.claimIds,profile:result.value.profile});
            if(result.value.omittedClaimIds.length)warnings.push(`Profile ${request.id} used ${result.value.usedClaimIds.length} contexts and omitted ${result.value.omittedClaimIds.length} under its registered bound.`);
        }
        const plan=lightragMust(await planContribution(input)),contributionRevision=await contributionRevisionOf({sourceId,versionId,claims,profiles,identities});
        const checked=await validateGraphContribution({sourceId,versionId,plan,identities,contributionRevision,spend,warnings,failures,partial:failures.length>0,completedChunkIds,
            stats:{completedChunks:completedChunkIds.length,failedChunks:failures.length,entityClaims:claims.entities.length,relationClaims:claims.relations.length,entities:entities.length,relations:relations.length,merges:resolution.merges.length,decisions:resolution.decisions,embeddingCalls:entityVectors.spend.calls+relationVectors.spend.calls}});
        if(!checked.valid)return failed({...checked,spend,attempts:spend.calls,stopReason:checked.issues[0].code},spend,completedChunkIds);
        return checked;
    }catch(cause){const result=graphStageFailure(cause,spend,spend.calls);if(result.valid)throw new TypeError('Failure conversion returned success.');return failed(result,spend,completedChunkIds);}
}
export async function validateGraphContribution(value:unknown):Promise<LightRagOutcome<GraphContribution>>{
    try{
        const contribution=lightragMust(validateLightRagShape('graphContribution',value)),{plan,sourceId,versionId,identities,stats}=contribution;
        const reproduced=lightragMust(await planContribution(plan.input));
        if(!equalsJson(plan,reproduced)||contribution.contributionRevision!==await contributionRevisionOf({sourceId,versionId,claims:plan.input.claims,profiles:plan.input.profiles,identities}))
            lightragReject('TLRAG1002','/contributionRevision','The prepared contribution differs from its reproduced plan or source identity.');
        if([...plan.input.claims.entities,...plan.input.claims.relations].some(row=>row.sourceId!==sourceId||row.versionId!==versionId||!equalsJson(row.modelIdentity,identities.model)||row.promptRevision!==identities.prompts.extraction)
            ||plan.input.profiles.some(row=>row.versionId!==versionId||row.promptRevision!==identities.prompts.extraction)||!equalsJson(plan.input.embeddedBy,identities.embedder))
            lightragReject('TLRAG1002','/identities','Prepared claims, profiles or vectors differ from the registered source identity.');
        if(contribution.partial!==(contribution.failures.length>0)||stats.completedChunks!==contribution.completedChunkIds.length||stats.failedChunks!==contribution.failures.length
            ||stats.entityClaims!==plan.input.claims.entities.length||stats.relationClaims!==plan.input.claims.relations.length||stats.entities!==plan.input.candidates.entities.length||stats.relations!==plan.input.candidates.relations.length
            ||stats.merges!==plan.input.merges.length||!equalsJson(sorted(contribution.completedChunkIds),sorted(plan.input.profiles.map(row=>row.chunkId))))
            lightragReject('TLRAG1001','/stats','Prepared contribution counts or completion membership differ from their observed records.');
        return {valid:true,value:immutableLightRagJson(contribution)};
    }catch(cause){return lightragFailure(cause);}
}
