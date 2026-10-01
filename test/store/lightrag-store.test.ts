import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '@jarenjs/db';
import { TANGLE_DB_MODEL, pickDriver } from '@tangleai/store';
import { LIGHTRAG_COLLECTIONS } from '../../packages/store/src/lightrag-model.ts';
import { createLightRagStore } from '../../packages/store/src/lightrag-store.ts';
import { createMemoryLightRagStore } from '../../packages/lightrag/src/store.ts';
import { lightragMust } from '../../packages/lightrag/src/errors.ts';
import { runGraphLifecycle, runReviewedMergeLifecycle, runConcurrentProjectionRace, initialGraphPlans, snapshotGraph } from '../fixtures/lightrag-lifecycle.ts';
const model={...TANGLE_DB_MODEL,collections:{...TANGLE_DB_MODEL.collections,...LIGHTRAG_COLLECTIONS}};
it('the lifecycle fixture passes against SQLite with the exact memory-store canonical sets and statuses',async()=>{
    const db=await openStore(model,{driver:pickDriver()});try{assert.deepEqual(await runGraphLifecycle(createLightRagStore(db)),await runGraphLifecycle(createMemoryLightRagStore()));assert.equal((await db.integrityCheck()).ok,true);}finally{await db.close();}
});
it('SQLite preserves the same alias decisions, historical rows and directed successors as memory',async()=>{
    const db=await openStore(model,{driver:pickDriver()});
    try{assert.deepEqual(await runReviewedMergeLifecycle(createLightRagStore(db)),await runReviewedMergeLifecycle(createMemoryLightRagStore()));assert.equal((await db.integrityCheck()).ok,true);}finally{await db.close();}
});
it('two genuinely concurrent SQLite promotions commit exactly one native fence',async()=>{
    const db=await openStore(model,{driver:pickDriver()});try{await runConcurrentProjectionRace(createLightRagStore(db));assert.equal((await db.integrityCheck()).ok,true);}finally{await db.close();}
});
it('a forced SQL transaction failure leaves the prior active projection byte-identical at every write',async()=>{
    const db=await openStore(model,{driver:pickDriver()});let failAt=0,puts=0;const store=createLightRagStore(db,{applyProbe:step=>{if(step.startsWith('put:')&&++puts===failAt)throw Error('forced SQL rollback');}});
    try{const f=await initialGraphPlans();lightragMust(await store.apply(f.plan));const before=await snapshotGraph(store);
        for(let n=1;n<=f.secondPlan.writes.length;n++){puts=0;failAt=n;const result=await store.apply(f.secondPlan);assert.equal(result.valid,false);assert.deepEqual(await snapshotGraph(store),before);}
        failAt=0;lightragMust(await store.apply(f.secondPlan));assert.equal((await db.integrityCheck()).ok,true);
    }finally{await db.close();}
});
