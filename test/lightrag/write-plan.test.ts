import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HEAD } from '@tangleai/outcomes';
import { planContribution } from '../../packages/lightrag/src/plan.ts';
import { planProjectionWrites, planRetraction } from '../../packages/lightrag/src/write-plan.ts';
import { validateGraphProjection } from '../../packages/lightrag/src/projection.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { validateLightRagShape } from '../../packages/lightrag/src/schema.ts';
import { validateGraphContribution } from '../../packages/lightrag/src/contribution.ts';
import { createMemoryLightRagStore, createLightRagStoreAdapter } from '../../packages/lightrag/src/store.ts';
import { createMemoryLightRagPersistence } from '../../packages/lightrag/src/memory-persistence.ts';
import { createLightRagDbPersistence } from '../../packages/store/src/lightrag-store.ts';
import { openTangleDb, createLightRagStore } from '@tangleai/store';
import { lightragRevisionOf } from '../../packages/lightrag/src/identity.ts';
import { graphClaim, graphEntity, graphInput, stagedGraphProjection } from '../fixtures/lightrag-records.ts';
import type { GraphContributionPlan, GraphProjection, ProjectionWritePlan } from '../../packages/lightrag/src/contracts.gen.ts';
const projected = (plan: ProjectionWritePlan): GraphProjection => {
    const row=plan.writes.at(-1)!;assert.equal(row.table,'projections');if(row.table!=='projections')throw Error('Projection must commit last.');return row.row;
};
async function preparedProjection(contribution: GraphContributionPlan): Promise<GraphProjection> {
    const projection=await stagedGraphProjection(contribution);
    projection.prepared=lightragMust(await validateGraphContribution({sourceId:projection.sourceId,versionId:projection.versionId,plan:contribution,
        identities:projection.identities,contributionRevision:projection.contributionRevision,spend:projection.spend,warnings:[],failures:[],partial:false,
        completedChunkIds:projection.chunkIds,stats:{completedChunks:1,failedChunks:0,entityClaims:1,relationClaims:0,entities:1,relations:0,merges:0,decisions:0,embeddingCalls:0}}));
    return projection;
}
async function rehashed(plan: ProjectionWritePlan): Promise<ProjectionWritePlan> {
    const {revision:_,...body}=plan;
    return {...body,revision:await lightragRevisionOf(body)};
}
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
it('compact plans serialize incoming preparation once and preserve exact applied and replayed bytes on both adapters', async () => {
    const claim=await graphClaim('Cedar',{description:'Cedar retains independently evidenced equipment. '.repeat(400)}),entity=await graphEntity(claim);
    const contribution=lightragMust(await planContribution(graphInput([claim],[entity]))),projection=await preparedProjection(contribution);
    const options={projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null};
    const legacy=lightragMust(await planProjectionWrites(options));
    const compact=lightragMust(await planProjectionWrites({...options,compactPreparations:true}));
    assert.equal(legacy.preparations,undefined);assert.deepEqual(legacy.request.prepared,projection.prepared);
    assert.equal(compact.request.prepared,undefined);assert.deepEqual(compact.preparations?.prior,[]);
    const {plan:_plan,...metadata}=projection.prepared!;assert.deepEqual(compact.preparations?.request,metadata);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(legacy).length-JSON.stringify(contribution).length+100);
    const restored:ProjectionWritePlan=JSON.parse(JSON.stringify(compact)),db=await openTangleDb();
    try { for(const store of [createMemoryLightRagStore(),createLightRagStore(db)]) {
        lightragMust(await store.apply(restored));const active=await store.activeProjectionFor(projection.sourceId);
        assert.deepEqual(active?.prepared,projection.prepared);
        const replay=lightragMust(await store.apply(restored));assert.equal(replay.replayed,true);assert.equal(replay.writes,0);
        const forged=structuredClone(restored),last=forged.writes.at(-1)!;
        if(last.table!=='projections')throw Error('Projection must commit last.');
        last.row.prepared={...projection.prepared!,warnings:['unbound retained bytes']};
        const refusal=await store.apply(await rehashed(forged));assert.equal(refusal.valid,false);
        if(!refusal.valid)assert.equal(refusal.issues[0].code,'TLRAG1002');
        assert.deepEqual(await store.activeProjectionFor(projection.sourceId),active);
    }} finally {await db.close();}
});
it('compact retirement and reactivation bind prior preparations without dropping retained evidence', async () => {
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim),first=lightragMust(await planContribution(graphInput([claim],[entity])));
    const draft=await preparedProjection(first),db=await openTangleDb();
    try { for(const store of [createMemoryLightRagStore(),createLightRagStore(db)]) {
        lightragMust(await store.apply(lightragMust(await planProjectionWrites({projection:draft,contribution:first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null,compactPreparations:true}))));
        const active=(await store.activeProjectionFor(draft.sourceId))!,withdraw=graphInput([],[],[],first);withdraw.retiredClaimIds=[claim.id];
        const removal=lightragMust(await planContribution(withdraw));
        const retirement=lightragMust(await planRetraction({projection:active,contribution:removal,projections:[active],actualHead:active.head,expectedHead:active.head,at:null,compactPreparations:true}));
        assert.equal(retirement.priorProjections[0].prepared,undefined);
        assert.deepEqual(retirement.preparations?.prior,[{id:active.id,revision:await lightragRevisionOf(active.prepared!)}]);
        assert.deepEqual(retirement.request.prepared,draft.prepared);
        lightragMust(await store.apply(JSON.parse(JSON.stringify(retirement))));
        assert.equal(lightragMust(await store.apply(retirement)).writes,0);
        const retired=(await store.getProjection(draft.id))!;assert.deepEqual(retired.prepared,draft.prepared);
        const returning=lightragMust(await planContribution(graphInput([claim],[entity],[],removal)));
        const revived=lightragMust(await planProjectionWrites({projection:draft,contribution:returning,projections:[retired],actualHead:retired.head,expectedHead:retired.head,at:null,compactPreparations:true}));
        const receipt=lightragMust(await store.apply(JSON.parse(JSON.stringify(revived))));assert.equal(receipt.reactivation,true);assert.equal(receipt.newClaims,0);
        assert.equal(receipt.head.revision,3);assert.deepEqual((await store.activeProjectionFor(draft.sourceId))?.prepared,draft.prepared);
        assert.equal(lightragMust(await store.apply(revived)).writes,0);
        assert.deepEqual(await store.listClaims(draft.id),first.input.claims);
    }} finally {await db.close();}
});
it('compact prior preparation bindings reject changed, missing, repeated and foreign cache identities before writes', async () => {
    const claim=await graphClaim('Cedar'),entity=await graphEntity(claim),first=lightragMust(await planContribution(graphInput([claim],[entity])));
    const draft=await preparedProjection(first),db=await openTangleDb();let writes=0;
    const applyProbe=(step:string)=>{if(step.startsWith('put:'))writes++;};
    try { for(const persistence of [createMemoryLightRagPersistence({applyProbe}),createLightRagDbPersistence(db,{applyProbe})]) {
        const store=createLightRagStoreAdapter(persistence);
        lightragMust(await store.apply(lightragMust(await planProjectionWrites({projection:draft,contribution:first,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null,compactPreparations:true}))));
        const active=(await store.activeProjectionFor(draft.sourceId))!,withdraw=graphInput([],[],[],first);withdraw.retiredClaimIds=[claim.id];
        const contribution=lightragMust(await planContribution(withdraw));
        const retirement=lightragMust(await planRetraction({projection:active,contribution,projections:[active],actualHead:active.head,expectedHead:active.head,at:null,compactPreparations:true}));
        const stored=await persistence.read(view=>view.get('projections',active.id));assert.ok(stored);
        const changed=structuredClone(stored);changed.payload.prepared!.warnings=['cache changed after preparation'];
        await persistence.transaction(view=>view.put('projections',changed));let before=writes;
        const stale=await store.apply(retirement);assert.equal(stale.valid,false);if(!stale.valid)assert.equal(stale.issues[0].code,'TLRAG1006');
        assert.equal(writes,before);assert.deepEqual(await store.getProjection(active.id),changed.payload);
        await persistence.transaction(view=>view.put('projections',stored));
        for(const mutate of [
            (value:ProjectionWritePlan)=>{value.preparations!.prior=[];},
            (value:ProjectionWritePlan)=>{value.preparations!.prior.push({...value.preparations!.prior[0]});},
            (value:ProjectionWritePlan)=>{value.preparations!.prior[0].id='f'.repeat(64);},
            (value:ProjectionWritePlan)=>{value.preparations!.prior[0].revision='f'.repeat(64);},
        ]) {
            const forged=structuredClone(retirement);mutate(forged);before=writes;
            const refusal=await store.apply(await rehashed(forged));assert.equal(refusal.valid,false);assert.equal(writes,before);
            assert.deepEqual(await store.getProjection(active.id),active);
        }
        lightragMust(await store.apply(retirement));assert.equal(lightragMust(await store.apply(retirement)).writes,0);
        const unboundReplay=structuredClone(retirement);unboundReplay.preparations!.prior=[];before=writes;
        assert.equal((await store.apply(await rehashed(unboundReplay))).valid,false);assert.equal(writes,before);
    }} finally {await db.close();}
});
