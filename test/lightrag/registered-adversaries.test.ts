/** Previously registered mutations exercise the public content boundaries. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import dangling from '../fixtures/lightrag/dangling-chunk.json' with { type: 'json' };
import unsupported from '../fixtures/lightrag/canonical-without-support.json' with { type: 'json' };
import alias from '../fixtures/lightrag/alias-pair.json' with { type: 'json' };
import collision from '../fixtures/lightrag/same-name-collision.json' with { type: 'json' };
import reversed from '../fixtures/lightrag/reversed-edge.json' with { type: 'json' };
import mismatch from '../fixtures/lightrag/mismatched-projection-version.json' with { type: 'json' };
import { validateGraphClaim, validateCanonicalEntity, validateCanonicalRelation } from '../../packages/lightrag/src/integrity.ts';
import { canonicalGraphRevisionOf, canonicalRelationIdOf, projectionIdOf } from '../../packages/lightrag/src/identity.ts';
import { planContribution } from '../../packages/lightrag/src/plan.ts';
import { planProjectionWrites } from '../../packages/lightrag/src/write-plan.ts';
import { lightragMust, type LightRagOutcome } from '../../packages/lightrag/src/errors.ts';
import type { GraphEntityClaim } from '../../packages/lightrag/src/contracts.gen.ts';
import { graphClaim, graphEntity, graphEdge, graphInput, stagedGraphProjection } from '../fixtures/lightrag-records.ts';
function refused(result: LightRagOutcome<unknown>, code: string): void {
    assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,code);
}
it('the registered dangling-chunk mutation is refused at the exact provenance boundary',async()=>{
    const claim=await graphClaim('Cedar'),input=graphInput([claim],[await graphEntity(claim)]);
    refused(await validateGraphClaim('entity',{...claim,...dangling.patch},input.chunks),dangling.expectedCode);
});
it('the registered canonical without support cannot enter the graph',async()=>{
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim);
    refused(await validateCanonicalEntity({...entity,...unsupported.patch},[claim]),unsupported.expectedCode);
});
it('the registered compatibility alias pair requires an explicit merge decision',async()=>{
    const a=await graphClaim(alias.names[0]),b=await graphClaim(alias.names[1],{ordinal:1,description:'A separately extracted equipment-register role.'});
    const x=await graphEntity(a),y=await graphEntity(b,true),input=graphInput([a,b],[x,y]);input.merges=[[x.id,y.id]];
    refused(await planContribution(input),alias.expectedCode);
});
it('the registered same-name different-type collision refuses a merged identity',async()=>{
    const a=await graphClaim(collision.name,{type:collision.types[0] as GraphEntityClaim['type']});
    const b=await graphClaim(collision.name,{ordinal:1,type:collision.types[1] as GraphEntityClaim['type']});
    const x=await graphEntity(a),y=await graphEntity(b),input=graphInput([a,b],[x,y]);input.merges=[[x.id,y.id]];
    refused(await planContribution(input),collision.expectedCode);
});
it('the registered reversed edge cannot inherit the forward edge evidence',async()=>{
    assert.equal(reversed.source,reversed.oppositeTarget);assert.equal(reversed.target,reversed.oppositeSource);
    const a=await graphClaim(reversed.source),b=await graphClaim(reversed.target,{ordinal:1}),x=await graphEntity(a),y=await graphEntity(b);
    const edge=await graphEdge(x,y),changed={...edge.row,sourceEntityId:y.id,targetEntityId:x.id,id:await canonicalRelationIdOf(y.id,x.id,edge.row.themes)};
    changed.revision=await canonicalGraphRevisionOf(changed);
    refused(await validateCanonicalRelation(changed,[edge.claim],[x,y]),reversed.expectedCode);
});
it('the registered projection version mismatch cannot activate a foreign document contribution',async()=>{
    const claim=await graphClaim('Cedar',{version:mismatch.documentVersion});
    const contribution=lightragMust(await planContribution(graphInput([claim],[await graphEntity(claim)])));
    const projection=await stagedGraphProjection(contribution,'a',mismatch.documentVersion);
    projection.versionId=mismatch.projectionVersion;projection.id=await projectionIdOf(projection.sourceId,projection.versionId,projection.contributionRevision);
    refused(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}),mismatch.expectedCode);
});
