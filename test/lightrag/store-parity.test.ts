import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryLightRagStore, createLightRagStoreAdapter } from '../../packages/lightrag/src/store.ts';
import { createMemoryLightRagPersistence } from '../../packages/lightrag/src/memory-persistence.ts';
import { lightRagStored } from '../../packages/lightrag/src/persistence.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { initialGraphPlans, runGraphLifecycle, runReviewedMergeLifecycle, runConcurrentProjectionRace, snapshotGraph } from '../fixtures/lightrag-lifecycle.ts';
it('the lifecycle fixture passes against the memory store',async()=>{
    const first=await runGraphLifecycle(createMemoryLightRagStore()),second=await runGraphLifecycle(createMemoryLightRagStore());
    assert.deepEqual(first,second);assert.deepEqual(first.counts,{snapshots:5,activeEntities:2,activeRelations:3,retainedProjections:3,reactivationNewClaims:0,headRevision:4});
});
it('persisted alias reviews retain merged rows and re-point directed relations',async()=>{
    const first=await runReviewedMergeLifecycle(createMemoryLightRagStore()),second=await runReviewedMergeLifecycle(createMemoryLightRagStore());
    assert.deepEqual(first,second);assert.deepEqual(first.counts,{activeEntities:4,mergedEntities:1,activeRelations:3,mergedRelations:3,retainedReviews:1});
});
it('two genuinely concurrent memory promotions commit exactly one native fence',async()=>{
    await runConcurrentProjectionRace(createMemoryLightRagStore());
});
it('a forced transaction failure leaves the prior active projection byte-identical',async()=>{
    let failAt=0,puts=0;const store=createMemoryLightRagStore({applyProbe:step=>{if(step.startsWith('put:')&&++puts===failAt)throw Error('forced write failure');}}),f=await initialGraphPlans();
    lightragMust(await store.apply(f.plan));const before=await snapshotGraph(store);
    for(let n=1;n<=f.secondPlan.writes.length;n++){puts=0;failAt=n;const result=await store.apply(f.secondPlan);assert.equal(result.valid,false);assert.deepEqual(await snapshotGraph(store),before);}
    failAt=0;assert.equal((await store.apply(f.secondPlan)).valid,true);
});
it('no query observes a staged claim, including while an atomic write is suspended',async()=>{
    const f=await initialGraphPlans();let pause=false,release!:()=>void,reached!:()=>void;
    const started=new Promise<void>(resolve=>reached=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const persistence=createMemoryLightRagPersistence({applyProbe:async step=>{if(pause&&step==='put:entities'){reached();await gate;}}}),store=createLightRagStoreAdapter(persistence);
    lightragMust(await store.apply(f.plan));const before=await snapshotGraph(store);pause=true;const applying=store.apply(f.secondPlan);await started;
    assert.deepEqual(await snapshotGraph(store),before);assert.deepEqual(await store.listClaims(f.secondProjection.id),{entities:[],relations:[]});release();lightragMust(await applying);
    const isolated=createMemoryLightRagPersistence(),read=createLightRagStoreAdapter(isolated);
    await isolated.transaction(async view=>{await view.put('projections',lightRagStored('projections',f.projection));await view.put('entity_claims',lightRagStored('entity_claims',f.a,f.projection.id));});
    assert.deepEqual(await read.listClaims(f.projection.id),{entities:[],relations:[]});assert.equal((await read.listClaims(f.projection.id,{includeStaged:true})).entities.length,1);
});
it('a concurrent promotion refuses a stale native head before any write',async()=>{
    const f=await initialGraphPlans(),store=createMemoryLightRagStore();lightragMust(await store.apply(f.plan));
    const changed=structuredClone(f.plan);changed.at='2024-01-01T00:00:00Z';
    // A genuine alternative is recomputed rather than merely changing its receipt hash.
    const {planProjectionWrites}=await import('../../packages/lightrag/src/write-plan.ts');
    const competing=lightragMust(await planProjectionWrites({projection:f.projection,contribution:f.first,projections:[],actualHead:f.plan.actualHead,expectedHead:f.plan.expectedHead,at:changed.at}));
    const before=await snapshotGraph(store),result=await store.apply(competing);assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1006');assert.equal(result.issues[0].cause?.code,'OUTC1013');}assert.deepEqual(await snapshotGraph(store),before);
});
it('forged write footprints are refused even when the attacker rehashes the plan',async()=>{
    const f=await initialGraphPlans(),store=createMemoryLightRagStore(),forged=structuredClone(f.plan);forged.writes=forged.writes.filter(row=>row.table!=='entity_claims');
    const {lightragRevisionOf}=await import('../../packages/lightrag/src/identity.ts');const {revision:_,...body}=forged;forged.revision=await lightragRevisionOf(body);
    const result=await store.apply(forged);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1002');assert.deepEqual(await store.listProjections(),[]);
});
it('a concurrent source cannot overwrite an unobserved matching canonical',async()=>{
    const {graphInput,graphEntity,stagedGraphProjection}=await import('../fixtures/lightrag-records.ts');
    const {planContribution}=await import('../../packages/lightrag/src/plan.ts');
    const {planProjectionWrites}=await import('../../packages/lightrag/src/write-plan.ts');
    const {EMPTY_HEAD}=await import('@tangleai/outcomes');
    const f=await initialGraphPlans(),contribution=lightragMust(await planContribution(graphInput([f.c],[await graphEntity(f.c)]))),projection=await stagedGraphProjection(contribution,'b');
    const competing=lightragMust(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}));
    const store=createMemoryLightRagStore();lightragMust(await store.apply(f.plan));const before=await snapshotGraph(store),result=await store.apply(competing);
    assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1006');assert.match(result.issues[0].detail,/matching canonical/);}assert.deepEqual(await snapshotGraph(store),before);
});
