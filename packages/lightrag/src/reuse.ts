/** Retained source preparation reuses immutable evidence and vectors without another model call. */
import { equalsJson } from '@jarenjs/core/object';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import type { GraphContribution,GraphContributionInput,GraphContributionPlan,GraphContributionSnapshot,GraphEntity,GraphRelation,GraphEntityClaim,GraphRelationClaim,GraphProjection } from './contracts.gen.ts';
import { canonicalGraphRevisionOf,canonicalRelationIdOf,projectionIdOf,immutableLightRagJson } from './identity.ts';
import { validateGraphContribution } from './contribution.ts';
import { validateGraphProjection } from './projection.ts';
import { planContribution,prepareGraphProfileBasis } from './plan.ts';
import { emptyGraphSpend } from './meter.ts';
import { lightragMust,lightragReject,lightragFailure,type LightRagOutcome } from './errors.ts';
const ids=(values:readonly string[])=>[...new Set(values)].sort();
const descriptions=(claims:readonly(GraphEntityClaim|GraphRelationClaim)[])=>[...claims].sort((a,b)=>a.ordinal-b.ordinal||(a.chunkId<b.chunkId?-1:a.chunkId>b.chunkId?1:a.id<b.id?-1:1)).map(row=>row.description).filter((value,index,all)=>all.indexOf(value)===index).join('\n');
async function stamp<T extends object>(body:T){return {...body,revision:await canonicalGraphRevisionOf(body)};}
function addresses(input:Pick<GraphContributionInput,'claims'|'existing'>){return [...new Map([...input.claims.entities,...input.claims.relations,...input.existing.claims.entities,...input.existing.claims.relations].map(row=>[row.chunkId,{id:row.chunkId,sourceId:row.sourceId,versionId:row.versionId}])).values()];}
async function evidenceProfiles(input:GraphContributionInput,cached:GraphContributionInput['profileUpdates']=[]){
    const basis=lightragMust(await prepareGraphProfileBasis(input));let reused=0,composed=0;
    input.profileUpdates=basis.map(row=>{
        const retained=cached.find(profile=>profile.kind===row.kind&&profile.id===row.id&&equalsJson(ids(profile.claimIds),row.claimIds));
        if(retained)reused++;else composed++;
        return {kind:row.kind,id:row.id,claimIds:row.claimIds,profile:retained?.profile??descriptions(row.claims)};
    });
    return {reused,composed};
}
/** Cache eligibility is checked by the host against the persisted source projection.
 * Canonical lineage may redirect old ids; this is retained membership, not a new semantic judgment. */
export async function rebaseRetainedContribution(options:{retained:GraphContribution;existing:GraphContributionSnapshot;retiredClaimIds:readonly string[]}):Promise<LightRagOutcome<GraphContribution>>{
    try{
        const retained=lightragMust(await validateGraphContribution(options.retained)),claims=retained.plan.input.claims,existing=options.existing;
        const prior=new Map(existing.canonicals.entities.map(row=>[row.id,row])),redirects=new Map<string,string>(),groups=new Map<string,{row:GraphEntity;claims:GraphEntityClaim[]}>();
        for(const candidate of retained.plan.input.candidates.entities){
            let target=prior.get(candidate.id);const visited=new Set<string>();
            while(target?.status==='merged'){
                if(visited.has(target.id))lightragReject('TLRAG1006','/retained','Retained canonical redirects cannot cycle.');visited.add(target.id);
                target=prior.get(target.mergedInto!);if(!target)lightragReject('TLRAG1003','/retained','A retained canonical survivor must remain addressable.');
            }
            const row=target??candidate;
            if(row.normalizedName!==candidate.normalizedName||row.types[0]!==candidate.types[0]||!equalsJson(row.embeddedBy,retained.identities.embedder))
                lightragReject('TLRAG1006','/retained','Retained membership cannot cross an entity or embedding identity.');
            redirects.set(candidate.id,row.id);const group=groups.get(row.id)??{row,claims:[]};
            group.claims.push(...candidate.supportClaimIds.map(id=>claims.entities.find(claim=>claim.id===id)!));groups.set(row.id,group);
        }
        const entities:GraphEntity[]=[];
        for(const {row,claims:support}of groups.values())entities.push(await stamp({...row,status:'active' as const,supportClaimIds:ids(support.map(claim=>claim.id)),supportChunkIds:ids(support.map(claim=>claim.chunkId)),
            aliases:ids(support.map(claim=>claim.name).filter(name=>name!==row.name)),profile:descriptions(support)}));
        const relationGroups=new Map<string,{row:GraphRelation;claims:GraphRelationClaim[]}>();
        for(const candidate of retained.plan.input.candidates.relations){
            const sourceEntityId=redirects.get(candidate.sourceEntityId)??candidate.sourceEntityId,targetEntityId=redirects.get(candidate.targetEntityId)??candidate.targetEntityId;
            const id=await canonicalRelationIdOf(sourceEntityId,targetEntityId,candidate.themes),group=relationGroups.get(id)??{row:{...candidate,id,sourceEntityId,targetEntityId},claims:[]};
            group.claims.push(...candidate.supportClaimIds.map(id=>claims.relations.find(claim=>claim.id===id)!));relationGroups.set(id,group);
        }
        const relations:GraphRelation[]=[];
        for(const {row,claims:support}of relationGroups.values())relations.push(await stamp({...row,supportClaimIds:ids(support.map(claim=>claim.id)),supportChunkIds:ids(support.map(claim=>claim.chunkId)),profile:descriptions(support),strength:Math.max(...support.map(claim=>claim.strength))}));
        const retired=ids(options.retiredClaimIds).filter(id=>![...claims.entities,...claims.relations].some(row=>row.id===id)),withdrawn=new Set(retired),owners=new Map<string,string>();
        for(const row of existing.canonicals.entities)if(row.status==='active')for(const claim of row.supportClaimIds)if(!withdrawn.has(claim))owners.set(claim,row.id);
        for(const row of entities)for(const claim of row.supportClaimIds)owners.set(claim,row.id);
        const allClaims=[...new Map([...existing.claims.entities,...claims.entities].map(row=>[row.id,row])).values()].filter(row=>owners.has(row.id)).sort((a,b)=>a.id<b.id?-1:1),reviews:GraphContributionInput['reviews']=[];
        const incoming=new Set(claims.entities.map(row=>row.id));
        for(let a=0;a<allClaims.length;a++)for(let b=a+1;b<allClaims.length;b++){
            const left=allClaims[a],right=allClaims[b];
            if(left.normalizedName!==right.normalizedName||left.type!==right.type||!incoming.has(left.id)&&!incoming.has(right.id))continue;
            reviews.push({claimIds:[left.id,right.id],decision:owners.get(left.id)===owners.get(right.id)?'merge':'keep-apart',
                reason:`Retained contribution ${retained.contributionRevision} and its persisted canonical lineage preserve this membership; no new semantic judgment is inferred.`});
        }
        const input:GraphContributionInput={claims,profiles:retained.plan.input.profiles,chunks:[],existing,candidates:{entities,relations},retiredClaimIds:retired,merges:[],reviews,profileUpdates:[],embeddedBy:retained.identities.embedder};
        input.chunks=addresses(input);
        // A valid empty extraction can still own a chunk profile.
        for(const address of retained.plan.input.chunks)if(input.profiles.some(row=>row.chunkId===address.id)&&!input.chunks.some(row=>row.id===address.id))input.chunks.push(address);
        const profiles=await evidenceProfiles(input,retained.plan.input.profileUpdates),plan=lightragMust(await planContribution(input));
        return validateGraphContribution({...retained,plan,spend:emptyGraphSpend(),warnings:[...retained.warnings,`Retained evidence profiles: ${profiles.reused} exact cached bases, ${profiles.composed} deterministic description unions; zero model or embedding calls.`],
            stats:{...retained.stats,entities:entities.length,relations:relations.length,merges:0,decisions:0,embeddingCalls:0}});
    }catch(cause){return lightragFailure(cause);}
}
export async function prepareGraphRetraction(options:{existing:GraphContributionSnapshot;retiredClaimIds:readonly string[];embeddedBy:GraphContributionInput['embeddedBy']}):Promise<LightRagOutcome<GraphContributionPlan>>{
    try{
        const input:GraphContributionInput={claims:{entities:[],relations:[]},profiles:[],chunks:[],existing:options.existing,candidates:{entities:[],relations:[]},retiredClaimIds:ids(options.retiredClaimIds),merges:[],reviews:[],profileUpdates:[],embeddedBy:options.embeddedBy};
        input.chunks=addresses(input);await evidenceProfiles(input);return planContribution(input);
    }catch(cause){return lightragFailure(cause);}
}
export async function projectionForContribution(value:GraphContribution,retained?:GraphProjection):Promise<LightRagOutcome<GraphProjection>>{
    try{
        const contribution=lightragMust(await validateGraphContribution(value)),{sourceId,versionId,contributionRevision,identities,plan,spend}=contribution,id=await projectionIdOf(sourceId,versionId,contributionRevision);
        if(retained){
            const checked=lightragMust(await validateGraphProjection(retained));
            if(checked.id!==id||!equalsJson(checked.identities,identities))lightragReject('TLRAG1006','/retained','A retained projection cannot substitute source contribution identity.');
            const {activatedAt:_activated,supersededAt:_superseded,audit:_audit,error:_error,...body}=checked;
            return validateGraphProjection({...body,status:'staged',head:{...EMPTY_HEAD}});
        }
        return validateGraphProjection({id,sourceId,versionId,contributionRevision,identities,status:'staged',head:{...EMPTY_HEAD},spend,prepared:contribution,
            counts:{claims:plan.input.claims.entities.length+plan.input.claims.relations.length,entities:plan.input.candidates.entities.length,relations:plan.input.candidates.relations.length,
                canonicalsTouched:plan.touchedEntityIds.length+plan.touchedRelationIds.length,chunks:plan.input.profiles.length},
            entityClaimIds:ids(plan.input.claims.entities.map(row=>row.id)),relationClaimIds:ids(plan.input.claims.relations.map(row=>row.id)),chunkIds:ids(plan.input.profiles.map(row=>row.chunkId))});
    }catch(cause){return lightragFailure(cause);}
}
