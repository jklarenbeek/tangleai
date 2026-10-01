import { it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareGraphProfileBasis,planContribution } from '../../packages/lightrag/src/plan.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { canonicalRelationIdOf } from '../../packages/lightrag/src/identity.ts';
import { initialGraphPlans } from '../fixtures/lightrag-lifecycle.ts';
import { graphClaim,graphEntity,graphInput } from '../fixtures/lightrag-records.ts';
it('profile preparation withdraws old support and excludes unchanged entities and adjacency',async()=>{
    const f=await initialGraphPlans(),input=graphInput([],[],[],f.second);input.retiredClaimIds=[f.c.id];
    const basis=lightragMust(await prepareGraphProfileBasis(input));assert.equal(basis.length,1);
    assert.equal(basis[0].id,f.x.id);assert.deepEqual(basis[0].claimIds,[f.a.id]);assert.deepEqual(basis[0].claims,[f.a]);
    const unprepared=await planContribution(input);assert.equal(unprepared.valid,false);if(!unprepared.valid)assert.equal(unprepared.issues[0].code,'TLRAG1003');
    input.profileUpdates=basis.map(row=>({kind:row.kind,id:row.id,claimIds:row.claimIds,profile:row.claims.map(claim=>claim.description).join(' ')}));
    const planned=lightragMust(await planContribution(input));assert.deepEqual(planned.touchedEntityIds,[f.x.id]);assert.deepEqual(planned.touchedRelationIds,[]);
    assert.deepEqual(planned.canonicals.entities.find(row=>row.id===f.y.id),f.second.canonicals.entities.find(row=>row.id===f.y.id));
    const empty=graphInput([],[],[],f.second);empty.retiredClaimIds=[f.a.id,f.b.id,f.c.id,...f.edges.map(edge=>edge.claim.id)];
    assert.deepEqual(lightragMust(await prepareGraphProfileBasis(empty)),[]);assert.equal(lightragMust(await planContribution(empty)).canonicals.entities.filter(row=>row.status==='active').length,0);
});
it('profile preparation follows both redirected relation endpoints and retains exact merge evidence',async()=>{
    const f=await initialGraphPlans(),alias=await graphClaim('ＣＥＤＡＲ',{source:'b',description:'Cedar coordinates the equipment register.'}),candidate=await graphEntity(alias,true);
    assert.ok(candidate.id<f.x.id);const input=graphInput([alias],[candidate],[],f.first);
    input.merges=[[f.x.id,candidate.id]];input.reviews=[{claimIds:[f.a.id,alias.id],decision:'merge',reason:'The register spellings identify the same organization.'}];
    const basis=lightragMust(await prepareGraphProfileBasis(input));assert.equal(basis.length,4);
    const entity=basis.find(row=>row.kind==='entity')!;assert.equal(entity.id,candidate.id);assert.deepEqual(entity.claimIds,[f.a.id,alias.id].sort());
    for(const edge of f.edges){const nextId=await canonicalRelationIdOf(edge.row.sourceEntityId===f.x.id?candidate.id:f.y.id,edge.row.targetEntityId===f.x.id?candidate.id:f.y.id,edge.row.themes),row=basis.find(row=>row.id===nextId)!;assert.ok(row);assert.deepEqual(row.claimIds,[edge.claim.id]);assert.deepEqual(row.claims,[edge.claim]);}
    assert.equal((await planContribution(input)).valid,false);
    input.profileUpdates=basis.map(row=>({kind:row.kind,id:row.id,claimIds:row.claimIds,profile:row.claims.map(claim=>claim.description).join(' ')}));
    const planned=lightragMust(await planContribution(input));assert.equal(planned.canonicals.entities.find(row=>row.id===f.x.id)?.mergedInto,candidate.id);
    assert.equal(planned.canonicals.relations.filter(row=>row.status==='active').length,3);assert.equal(planned.canonicals.relations.filter(row=>row.status==='merged').length,3);
});
