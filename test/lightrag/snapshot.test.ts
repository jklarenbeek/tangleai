import {it} from 'node:test';
import assert from 'node:assert/strict';
import {EMPTY_HEAD} from '@tangleai/outcomes';
import {createMemoryLightRagStore,lightragMust,planContribution,planProjectionWrites,readGraphSnapshotWithin} from '@tangleai/lightrag';
import {createLightRagStore,openTangleDb} from '@tangleai/store';
import {initialGraphPlans} from '../fixtures/lightrag-lifecycle.ts';
import {graphClaim,graphEntity,graphInput,stagedGraphProjection} from '../fixtures/lightrag-records.ts';
it('affected-name snapshots include adjacency and withdrawn support while excluding unrelated canonicals on both stores',async()=>{
    const db=await openTangleDb();try{
        for(const store of [createMemoryLightRagStore(),createLightRagStore(db)]){
            const f=await initialGraphPlans();lightragMust(await store.apply(f.plan));lightragMust(await store.apply(f.secondPlan));
            const claim=await graphClaim('Unrelated',{source:'z'}),entity=await graphEntity(claim),contribution=lightragMust(await planContribution(graphInput([claim],[entity]))),projection=await stagedGraphProjection(contribution,'z');
            lightragMust(await store.apply(lightragMust(await planProjectionWrites({projection,contribution,projections:[],actualHead:EMPTY_HEAD,expectedHead:EMPTY_HEAD,at:null}))));
            const snapshot=await store.readContributionSnapshot({normalizedNames:[],retiredClaimIds:[f.c.id]});
            assert.deepEqual(snapshot.canonicals.entities.map(row=>row.id).sort(),[f.x.id,f.y.id].sort());assert.equal(snapshot.canonicals.relations.length,3);
            assert.deepEqual(snapshot.claims.entities.map(row=>row.id).sort(),[f.a.id,f.b.id,f.c.id].sort());assert.equal(snapshot.claims.relations.length,3);
            assert.deepEqual(await store.readContributionSnapshot({normalizedNames:['absent']}),{claims:{entities:[],relations:[]},canonicals:{entities:[],relations:[]}});
        }
    }finally{await db.close();}
});
it('incremental snapshot queries never request an unfiltered canonical or claim sweep',async()=>{
    const calls:unknown[]=[];
    await readGraphSnapshotWithin({get:async()=>undefined,query:async(table,query)=>{calls.push({table,query});assert.ok(Object.values(query).some(value=>Array.isArray(value)));return [];}},{normalizedNames:['cedar']});
    assert.ok(calls.length>0);
});
