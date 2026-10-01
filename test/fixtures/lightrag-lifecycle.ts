/** The identical lifecycle runs through both physical transaction owners. */
import assert from 'node:assert/strict';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import type { LightRagStore } from '../../packages/lightrag/src/store.ts';
import { planContribution } from '../../packages/lightrag/src/plan.ts';
import { planProjectionWrites, planRetraction } from '../../packages/lightrag/src/write-plan.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { canonicalRelationIdOf } from '../../packages/lightrag/src/identity.ts';
import { graphClaim, graphEntity, graphEdge, graphInput, stagedGraphProjection } from './lightrag-records.ts';
export async function snapshotGraph(store: LightRagStore) {
    const projections=await store.listProjections();
    return { projections, entities:await store.listEntities({status:'all'}),relations:await store.listRelations({status:'all'}),
        claims:await Promise.all(projections.map(async row=>({id:row.id,claims:await store.listClaims(row.id,{includeSuperseded:true,includeStaged:true})}))) };
}
export async function initialGraphPlans() {
    const a=await graphClaim('Cedar'), b=await graphClaim('Willow',{ordinal:1}), x=await graphEntity(a), y=await graphEntity(b);
    const edges=[await graphEdge(x,y),await graphEdge(y,x,{ordinal:1}),await graphEdge(x,y,{ordinal:2,theme:'funding'})];
    const first=lightragMust(await planContribution(graphInput([a,b],[x,y],edges))), projection=await stagedGraphProjection(first);
    const plan=lightragMust(await planProjectionWrites({projection,contribution:first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    const c=await graphClaim('CEDAR',{source:'b'}), z=await graphEntity(c), input=graphInput([c],[z],[],first);
    input.profileUpdates=[{kind:'entity',id:x.id,claimIds:[a.id,c.id],profile:a.description}];
    const second=lightragMust(await planContribution(input)), secondProjection=await stagedGraphProjection(second,'b');
    const secondPlan=lightragMust(await planProjectionWrites({projection:secondProjection,contribution:second,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    return {a,b,c,x,y,z,edges,first,projection,plan,second,secondProjection,secondPlan};
}
export async function runConcurrentProjectionRace(store: LightRagStore) {
    const f=await initialGraphPlans();
    const competing=lightragMust(await planProjectionWrites({projection:f.projection,contribution:f.first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:'2024-01-01T00:00:00Z'}));
    const results=await Promise.all([store.apply(f.plan),store.apply(competing)]);
    assert.equal(results.filter(row=>row.valid).length,1);
    const rejected=results.find(row=>!row.valid)!;assert.equal(rejected.valid,false);
    if(!rejected.valid){assert.equal(rejected.issues[0].code,'TLRAG1006');assert.equal(rejected.issues[0].cause?.code,'OUTC1013');}
    const projections=await store.listProjections();assert.equal(projections.length,1);assert.equal(projections[0].status,'active');assert.equal(projections[0].head.revision,1);
    assert.equal((await store.listClaims(f.projection.id)).entities.length,2);assert.equal((await store.listEntities()).length,2);
}
export async function runGraphLifecycle(store: LightRagStore) {
    const f=await initialGraphPlans(),states=[];
    const firstReceipt=lightragMust(await store.apply(f.plan));assert.equal(firstReceipt.newClaims,5);states.push(await snapshotGraph(store));
    assert.equal((await store.listClaims(f.projection.id)).entities.length,2);assert.equal((await store.listChunkProfiles('a-v1')).length,1);
    const repeat=lightragMust(await store.apply(f.plan));assert.equal(repeat.writes,0);assert.equal(repeat.replayed,true);assert.deepEqual(await snapshotGraph(store),states[0]);
    const secondReceipt=lightragMust(await store.apply(f.secondPlan));assert.equal(secondReceipt.newClaims,1);states.push(await snapshotGraph(store));
    assert.deepEqual((await store.listEntities({ids:[f.x.id]}))[0].supportClaimIds,[f.a.id,f.c.id].sort());
    const replacementClaim=await graphClaim('Cedar',{version:'a-v2'}), replacementEntity=await graphEntity(replacementClaim), input=graphInput([replacementClaim],[replacementEntity],[],f.second);
    input.retiredClaimIds=[f.a.id,f.b.id,...f.edges.map(edge=>edge.claim.id)];
    input.profileUpdates=[{kind:'entity',id:f.x.id,claimIds:[replacementClaim.id,f.c.id],profile:f.a.description}];
    const replacement=lightragMust(await planContribution(input)), replacementProjection=await stagedGraphProjection(replacement,'a','a-v2'), active=(await store.activeProjectionFor('a'))!;
    const replacementPlan=lightragMust(await planProjectionWrites({projection:replacementProjection,contribution:replacement,projections:await store.listProjections({sourceId:'a'}),actualHead:active.head,expectedHead:active.head,at:null}));
    lightragMust(await store.apply(replacementPlan));states.push(await snapshotGraph(store));assert.equal((await store.listEntities()).length,1);assert.equal((await store.listRelations()).length,0);
    assert.deepEqual(await store.listClaims(f.projection.id),{entities:[],relations:[]});assert.equal((await store.listClaims(f.projection.id,{includeSuperseded:true})).relations.length,3);
    const retractInput=graphInput([],[],[],replacement);retractInput.retiredClaimIds=[replacementClaim.id];retractInput.profileUpdates=[{kind:'entity',id:f.x.id,claimIds:[f.c.id],profile:f.c.description}];
    const retraction=lightragMust(await planContribution(retractInput)), current=(await store.activeProjectionFor('a'))!;
    const retirePlan=lightragMust(await planRetraction({projection:current,contribution:retraction,projections:await store.listProjections({sourceId:'a'}),actualHead:current.head,expectedHead:current.head,at:null}));
    lightragMust(await store.apply(retirePlan));states.push(await snapshotGraph(store));assert.equal(await store.activeProjectionFor('a'),undefined);assert.deepEqual((await store.listEntities())[0].supportClaimIds,[f.c.id]);
    const returnInput=graphInput([f.a,f.b],[f.x,f.y],f.edges,retraction);returnInput.profileUpdates=[{kind:'entity',id:f.x.id,claimIds:[f.a.id,f.c.id],profile:f.a.description}];
    const returning=lightragMust(await planContribution(returnInput));
    const revive=lightragMust(await planProjectionWrites({projection:f.projection,contribution:returning,projections:await store.listProjections({sourceId:'a'}),actualHead:retirePlan.nextHead,expectedHead:retirePlan.nextHead,at:null}));
    const revived=lightragMust(await store.apply(revive));assert.equal(revived.newClaims,0);assert.equal(revived.reactivation,true);assert.equal(revived.head.revision,4);states.push(await snapshotGraph(store));
    assert.equal((await store.listEntities()).length,2);assert.equal((await store.listRelations()).length,3);assert.equal((await store.activeProjectionFor('a'))!.id,f.projection.id);
    const replay=lightragMust(await store.apply(revive));assert.equal(replay.writes,0);assert.deepEqual(await snapshotGraph(store),states.at(-1));
    const returnedProjection=(await store.getProjection(f.projection.id))!;
    assert.deepEqual(returnedProjection.audit?.map(row=>row.head.revision),[1,4]);
    assert.deepEqual(returnedProjection.audit?.map(row=>row.operation),['activate','activate']);
    assert.equal(returnedProjection.audit?.at(-1)?.contributionPlanRevision,returning.revision);
    const retiredProjection=(await store.getProjection(replacementProjection.id))!;
    assert.deepEqual(retiredProjection.audit?.map(row=>row.operation),['activate','retract']);
    assert.deepEqual(retiredProjection.audit?.map(row=>row.head.revision),[2,3]);
    return {states,counts:{snapshots:states.length,activeEntities:2,activeRelations:3,retainedProjections:3,reactivationNewClaims:revived.newClaims,headRevision:revived.head.revision}};
}

/** A real persisted merge moves both directed endpoints while preserving different types. */
export async function runReviewedMergeLifecycle(store: LightRagStore) {
    const cedar=await graphClaim('Cedar'), willow=await graphClaim('Willow',{ordinal:1});
    const location=await graphClaim('Beacon',{ordinal:2,type:'LOCATION'}), concept=await graphClaim('Beacon',{ordinal:3,type:'CONCEPT'});
    const claims=[cedar,willow,location,concept], entities=await Promise.all(claims.map(claim=>graphEntity(claim)));
    const [old,other]=entities;
    const edges=[await graphEdge(old,other),await graphEdge(other,old,{ordinal:1}),await graphEdge(old,other,{ordinal:2,theme:'funding'})];
    const first=lightragMust(await planContribution(graphInput(claims,entities,edges))), projection=await stagedGraphProjection(first);
    const initial=lightragMust(await planProjectionWrites({projection,contribution:first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    lightragMust(await store.apply(initial));const states=[await snapshotGraph(store)];
    const alias=await graphClaim('ＣＥＤＡＲ',{source:'b',description:'Cedar coordinates the equipment register.'}), candidate=await graphEntity(alias,true);
    assert.ok(candidate.id<old.id,'The registered alias must exercise both endpoint redirections.');
    const input=graphInput([alias],[candidate],[],first);
    input.merges=[[old.id,candidate.id]];
    input.reviews=[{claimIds:[cedar.id,alias.id],decision:'merge',reason:'The two register spellings identify the same organization.'}];
    input.profileUpdates=[{kind:'entity',id:candidate.id,claimIds:[cedar.id,alias.id],profile:'Cedar has a civic role and coordinates equipment.'}];
    for(const edge of edges)input.profileUpdates.push({kind:'relation',id:await canonicalRelationIdOf(edge.row.sourceEntityId===old.id?candidate.id:other.id,edge.row.targetEntityId===old.id?candidate.id:other.id,edge.row.themes),claimIds:[edge.claim.id],profile:edge.row.profile});
    const merged=lightragMust(await planContribution(input)), nextProjection=await stagedGraphProjection(merged,'b');
    const plan=lightragMust(await planProjectionWrites({projection:nextProjection,contribution:merged,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    lightragMust(await store.apply(plan));states.push(await snapshotGraph(store));
    const allEntities=await store.listEntities({status:'all'}), allRelations=await store.listRelations({status:'all'});
    assert.equal(allEntities.length,5);assert.equal(allEntities.filter(row=>row.status==='active').length,4);
    assert.equal(allEntities.find(row=>row.id===old.id)?.mergedInto,candidate.id);
    assert.deepEqual(allEntities.filter(row=>row.normalizedName==='beacon').map(row=>row.types[0]).sort(),['CONCEPT','LOCATION']);
    assert.equal(allRelations.length,6);assert.equal(allRelations.filter(row=>row.status==='active').length,3);
    for(const edge of edges){const historical=allRelations.find(row=>row.id===edge.row.id)!;assert.equal(historical.status,'merged');assert.ok(allRelations.some(row=>row.id===historical.mergedInto&&row.status==='active'));}
    const stored=(await store.getProjection(nextProjection.id))!;
    assert.deepEqual(stored.audit,[{operation:'activate',head:plan.nextHead,contributionPlanRevision:merged.revision,reviews:input.reviews,at:null}]);
    const repeated=lightragMust(await store.apply(plan));assert.equal(repeated.writes,0);assert.deepEqual(await snapshotGraph(store),states[1]);
    return {states,counts:{activeEntities:4,mergedEntities:1,activeRelations:3,mergedRelations:3,retainedReviews:stored.audit![0].reviews.length}};
}
