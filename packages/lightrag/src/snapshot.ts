/** Query only matching names, affected adjacency and the immutable evidence they name. */
import { equalsJson } from '@jarenjs/core/object';
import type { GraphContributionSnapshot,GraphEntity,GraphEntityClaim,GraphRelationClaim } from './contracts.gen.ts';
import { lightRagStored,type LightRagReadView,type LightRagStored } from './persistence.ts';
import { lightragMust,lightragReject } from './errors.ts';
import { validateLightRagShape } from './schema.ts';
import { immutableLightRagJson } from './identity.ts';
export interface GraphSnapshotRequest { normalizedNames:readonly string[];retiredClaimIds?:readonly string[]; }
const ids=(values:readonly string[])=>[...new Set(values)].sort();
const ordered=<T extends{id:string}>(rows:Iterable<T>)=>[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
function distinctClaims<T extends GraphEntityClaim|GraphRelationClaim>(rows:LightRagStored<'entity_claims'|'relation_claims'>[],table:'entity_claims'|'relation_claims'):T[]{
    const claims=new Map<string,T>();
    for(const row of rows){
        if(!row.projectionId||!equalsJson(row,lightRagStored(table,row.payload,row.projectionId)))lightragReject('TLRAG1002','/claims','Stored claim metadata differs from immutable membership.');
        const prior=claims.get(row.payload.id);
        if(prior&&!equalsJson(prior,row.payload))lightragReject('TLRAG1002','/claims','One retained claim address has different content.');
        claims.set(row.payload.id,row.payload as T);
    }
    return ordered(claims.values());
}
export async function readGraphSnapshotWithin(view:LightRagReadView,request:GraphSnapshotRequest):Promise<GraphContributionSnapshot>{
    const retired=ids(request.retiredClaimIds??[]);
    const retiredEntities=distinctClaims<GraphEntityClaim>(await view.query('entity_claims',{claimIds:retired}),'entity_claims');
    const retiredRelations=distinctClaims<GraphRelationClaim>(await view.query('relation_claims',{claimIds:retired}),'relation_claims');
    if(retired.some(id=>![...retiredEntities,...retiredRelations].some(row=>row.id===id)))lightragReject('TLRAG1003','/retiredClaimIds','A withdrawn claim has no retained physical membership.');
    const names=ids([...request.normalizedNames,...retiredEntities.map(row=>row.normalizedName),...retiredRelations.flatMap(row=>[row.normalizedSource,row.normalizedTarget])]);
    const roots=await view.query('entities',{normalizedNames:names}),relations=await view.query('relations',{entityIds:roots.map(row=>row.id)}),entities=new Map<string,GraphEntity>();
    for(const row of roots){if(!equalsJson(row,lightRagStored('entities',row.payload)))lightragReject('TLRAG1002','/entities','Stored canonical metadata differs from its payload.');entities.set(row.id,row.payload);}
    for(const row of relations)if(!equalsJson(row,lightRagStored('relations',row.payload)))lightragReject('TLRAG1002','/relations','Stored adjacency metadata differs from its payload.');
    const endpoints=ids(relations.flatMap(row=>[row.payload.sourceEntityId,row.payload.targetEntityId]));
    for(const id of endpoints)if(!entities.has(id)){
        const row=await view.get('entities',id);if(!row)lightragReject('TLRAG1003','/relations','Stored relation endpoints must remain addressable.');
        if(!equalsJson(row,lightRagStored('entities',row.payload)))lightragReject('TLRAG1002','/entities','Stored endpoint metadata differs from its payload.');entities.set(id,row.payload);
    }
    const entityIds=ids([...retiredEntities.map(row=>row.id),...[...entities.values()].flatMap(row=>row.supportClaimIds)]),relationIds=ids([...retiredRelations.map(row=>row.id),...relations.flatMap(row=>row.payload.supportClaimIds)]);
    const entityClaims=distinctClaims<GraphEntityClaim>(await view.query('entity_claims',{claimIds:entityIds}),'entity_claims'),relationClaims=distinctClaims<GraphRelationClaim>(await view.query('relation_claims',{claimIds:relationIds}),'relation_claims');
    if(entityIds.length!==entityClaims.length||relationIds.length!==relationClaims.length)lightragReject('TLRAG1003','/supportClaimIds','Affected canonical support must resolve to retained claims.');
    return immutableLightRagJson(lightragMust(validateLightRagShape('graphContributionSnapshot',{claims:{entities:entityClaims,relations:relationClaims},canonicals:{entities:ordered(entities.values()),relations:ordered(relations.map(row=>row.payload))}})));
}
