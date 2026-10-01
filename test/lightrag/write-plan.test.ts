import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import { planContribution } from '../../packages/lightrag/src/plan.ts';
import { planProjectionWrites, planRetraction } from '../../packages/lightrag/src/write-plan.ts';
import { validateGraphProjection } from '../../packages/lightrag/src/projection.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { validateLightRagShape } from '../../packages/lightrag/src/schema.ts';
import { validateGraphContribution } from '../../packages/lightrag/src/contribution.ts';
import { createMemoryLightRagStore } from '../../packages/lightrag/src/store.ts';
import { openTangleDb, createLightRagStore } from '@tangleai/store';
import { lightragRevisionOf } from '../../packages/lightrag/src/identity.ts';
import { graphClaim, graphEntity, graphInput, stagedGraphProjection } from '../fixtures/lightrag-records.ts';
import type { GraphProjection, ProjectionWritePlan } from '../../packages/lightrag/src/contracts.gen.ts';
const projected = (plan: ProjectionWritePlan): GraphProjection => {
    const row=plan.writes.at(-1)!;assert.equal(row.table,'projections');if(row.table!=='projections')throw Error('Projection must commit last.');return row.row;
};
it('a write plan bounds retained preparation duplication and persists its exact bytes on both adapters', async () => {
    const claim=await graphClaim('Cedar',{description:'Cedar retains independently evidenced equipment. '.repeat(400)}),entity=await graphEntity(claim);
    const contribution=lightragMust(await planContribution(graphInput([claim],[entity]))),projection=await stagedGraphProjection(contribution);
    projection.prepared=lightragMust(await validateGraphContribution({sourceId:projection.sourceId,versionId:projection.versionId,plan:contribution,
        identities:projection.identities,contributionRevision:projection.contributionRevision,spend:projection.spend,warnings:[],failures:[],partial:false,
        completedChunkIds:projection.chunkIds,stats:{completedChunks:1,failedChunks:0,entityClaims:1,relationClaims:0,entities:1,relations:0,merges:0,decisions:0,embeddingCalls:0}}));
    const plan=lightragMust(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    assert.ok(JSON.stringify(plan).length < 3*JSON.stringify(projection.prepared).length,'Retained preparation must not multiply into both projection writes.');
    const db=await openTangleDb();
    try { for (const store of [createMemoryLightRagStore(),createLightRagStore(db)]) {
        lightragMust(await store.apply(plan));
        const active=await store.activeProjectionFor(projection.sourceId);assert.deepEqual(active?.prepared,projection.prepared);
        const replay=lightragMust(await store.apply(plan));assert.equal(replay.replayed,true);assert.equal(replay.writes,0);
        const forged=structuredClone(plan),last=forged.writes.at(-1)!;
        if(last.table!=='projections')throw Error('Projection must commit last.');
        last.row.prepared={...projection.prepared,warnings:['unbound retained bytes']};
        const {revision:_,...body}=forged;forged.revision=await lightragRevisionOf(body);
        const refused=await store.apply(forged);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1002');
        assert.deepEqual(await store.activeProjectionFor(projection.sourceId),active);
    }} finally { await db.close(); }
});
it('activation stages members before canonical writes and commits the native fence last', async () => {
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim),contribution=lightragMust(await planContribution(graphInput([claim],[entity]))),projection=await stagedGraphProjection(contribution);
    const plan=lightragMust(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    assert.equal(validateLightRagShape('projectionWritePlan',plan).valid,true);
    assert.deepEqual(plan.writes.map(row=>row.table),['projections','entity_claims','chunk_profiles','entities','projections']);
    assert.equal(projected(plan).status,'active');assert.equal(plan.nextHead.revision,1);assert.equal(plan.reactivation,false);
    const bad=await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:{versionId:null,revision:1},at:null});
    assert.equal(bad.valid,false);if(!bad.valid){assert.equal(bad.issues[0].code,'TLRAG1006');assert.equal(bad.issues[0].cause?.code,'OUTC1013');}
});
it('retirement retains the latest fence and identical reactivation writes no new claims or profiles', async () => {
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim),first=lightragMust(await planContribution(graphInput([claim],[entity]))),draft=await stagedGraphProjection(first);
    const activate=lightragMust(await planProjectionWrites({projection:draft,contribution:first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null})),active=projected(activate);
    const withdrawing=graphInput([],[],[],first);withdrawing.retiredClaimIds=[claim.id];const contribution=lightragMust(await planContribution(withdrawing));
    const retirement=lightragMust(await planRetraction({projection:active,contribution,projections:[active],actualHead:active.head,expectedHead:active.head,at:null})),retired=projected(retirement);
    assert.equal(retired.status,'superseded');assert.equal(retired.head.revision,2);assert.equal(retirement.writes.filter(row=>row.table==='entities')[0].row.status,'retracted');
    const returning=lightragMust(await planContribution(graphInput([claim],[entity],[],contribution)));
    const revived=lightragMust(await planProjectionWrites({projection:draft,contribution:returning,projections:[retired],actualHead:retired.head,expectedHead:retired.head,at:null}));
    assert.equal(revived.reactivation,true);assert.equal(revived.nextHead.revision,3);assert.equal(projected(revived).id,active.id);
    assert.deepEqual(revived.writes.map(row=>row.table),['projections','entities','projections']);
});
it('prepared plans refuse membership forgery and never-activated rows cannot manufacture head revisions', async () => {
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim),contribution=lightragMust(await planContribution(graphInput([claim],[entity]))),projection=await stagedGraphProjection(contribution);
    const changed=structuredClone(projection);changed.chunkIds=['foreign'];
    const refused=await planProjectionWrites({projection:changed,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null});
    assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1006');
    const forged=await validateGraphProjection({...projection,head:{versionId:projection.id,revision:999}});assert.equal(forged.valid,false);if(!forged.valid)assert.equal(forged.issues[0].code,'TLRAG1006');
});
