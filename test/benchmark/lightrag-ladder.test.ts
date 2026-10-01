import {it} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {getHeapStatistics} from 'node:v8';
import {measureLightRagLadder,validateLightRagLadder,lightRagBackendDecision} from '../../benchmark/lib/lightrag-ladder.ts';

it('the tiny SQLite ladder retains real query work and cannot declare the registered backend target passed',async()=>{
    const original=globalThis.fetch;let requests=0,tick=0;
    globalThis.fetch=async()=>{requests++;throw Error('The scale fixture has no external wire.');};
    try{
        const result=await measureLightRagLadder({sizes:[2,4],timer:()=>tick++,now:()=> '2026-06-01T00:00:00.000Z'});
        assert.equal(result.status,'probe');assert.equal(result.backendDecision,null);assert.equal(result.physicalRequests,0);assert.equal(requests,0);
        assert.equal(result.identity.runtime,process.versions.bun?'bun '+process.versions.bun:`node ${process.versions.node}; V8 heap limit ${getHeapStatistics().heap_size_limit} bytes`);
        assert.deepEqual(result.sizes,[2,4]);assert.equal(result.registration.maxP95Ms,250);assert.equal(result.registration.targetChunks,10000);
        for(const row of result.rows){
            assert.equal(row.extractedChunks,row.chunks);assert.equal(row.entities,row.chunks*2);assert.equal(row.relations,row.chunks);assert.equal(row.claims,row.chunks*3);
            assert.equal(row.retrieval.samples.length,18);assert.ok(row.rowsRead.graph>0);assert.ok(row.rowsRead.documents>=row.chunks*18);assert.equal(row.citationResolution.ratio,1);
            assert.equal(row.skipped.unresolvable,0);assert.ok(row.embeddingCalls>0);assert.ok(row.peakRssBytes>0);
        }
        const tampered=structuredClone(result);tampered.rows[0].retrieval.p95Ms++;
        const {receiptId:_,...body}=tampered;tampered.receiptId=await canonicalSha256(body);
        await assert.rejects(validateLightRagLadder(tampered),/Invalid graph scale receipt/);
        const decision=structuredClone(result);decision.backendDecision='sqlite-sufficient';const {receiptId:__,...changed}=decision;decision.receiptId=await canonicalSha256(changed);
        await assert.rejects(validateLightRagLadder(decision),/Invalid graph scale receipt/);
        const rows=[100,1000,10000].map(chunks=>({...result.rows[0],chunks,retrieval:{...result.rows[0].retrieval,p95Ms:250}}));
        assert.equal(lightRagBackendDecision(rows),'sqlite-sufficient');rows[2].retrieval.p95Ms=250.001;assert.equal(lightRagBackendDecision(rows),'scale-row-registered');
        assert.equal(lightRagBackendDecision(rows.slice(0,2)),null);
    }finally{globalThis.fetch=original;}
});
