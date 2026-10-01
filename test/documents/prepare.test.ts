import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createHashEmbedder} from '@tangleai/models/embed';
import {createDocumentStore,openTangleDb} from '@tangleai/store';
import {SafeStaticFetcher,createDocumentIngester,recallDocumentChunks,preparedIdentityOf,DocumentError} from '@tangleai/documents';
const url='https://docs.example/prepared',now=()=> '2026-06-01T00:00:00.000Z';
const page=(n:number)=>`<html><body><main><h1>Guide</h1><p>${Array.from({length:50},(_,i)=>`Fact ${n}-${i} describes a distinct equipment rule.`).join(' ')}</p></main></body></html>`;
async function fixture(){
    const db=await openTangleDb(),store=createDocumentStore(db),hash=createHashEmbedder({dims:16});let body=page(1),calls=0;
    const embedder={...hash,embed:async(texts:string[])=>{calls++;return hash.embed(texts);}};
    const fetcher=new SafeStaticFetcher({fetch:async()=>new Response(body,{headers:{'content-type':'text/html'}}),now,lookup:async()=>[{address:'93.184.216.34',family:4}],limits:{respectRobots:false,perHostDelayMs:0}});
    const ingester=createDocumentIngester({store,embedder,fetcher,now});
    return {db,store,embedder,fetcher,ingester,calls:()=>calls,body:(n:number)=>{body=page(n);}};
}
it('document preparation is available without activating corpus rows',async()=>{
    const f=await fixture();try{assert.equal(typeof f.ingester.prepare,'function');const result=await f.ingester.prepare({url,maxTokens:40});assert.equal(result.status,'prepared');assert.deepEqual(await f.store.listSources(),[]);assert.deepEqual(await f.store.listVersions(),[]);assert.deepEqual(await f.store.listChunks(),[]);}finally{await f.db.close();}
});
it('retained versions list deterministically by source, version and order',async()=>{
    const f=await fixture();try{await f.ingester.ingest({url,maxTokens:40});f.body(2);await f.ingester.ingest({url,maxTokens:40});const chunks=await f.store.listChunks();assert.ok(chunks.length>4);assert.deepEqual(chunks.map(row=>row.id),[...chunks].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.versionId.localeCompare(b.versionId)||a.order-b.order||a.id.localeCompare(b.id)).map(row=>row.id));}finally{await f.db.close();}
});
it('recall requests only active-version chunks and parents instead of sweeping retained history',async()=>{
    const f=await fixture();try{await f.ingester.ingest({url,maxTokens:40});f.body(2);const active=await f.ingester.ingest({url,maxTokens:40});const chunks:string[]=[],parents:string[]=[];
        const observed={...f.store,listChunks:async(id?:string)=>{assert.equal(id,active.version.id);chunks.push(id!);return f.store.listChunks(id);},listParents:async(id?:string)=>{assert.equal(id,active.version.id);parents.push(id!);return f.store.listParents(id);}};
        const [query]=await f.embedder.embed(['equipment']);const result=await recallDocumentChunks(observed,query,{model:f.embedder.model,dims:16});assert.ok(result.ranked.length>0);assert.deepEqual(chunks,[active.version.id]);assert.deepEqual(parents,[active.version.id]);
    }finally{await f.db.close();}
});

it('preparation failures have no durable side effect while composed ingest preserves recorded failures',async()=>{
    const f=await fixture();try{
        const failing=createDocumentIngester({store:f.store,fetcher:f.fetcher,embedder:{...f.embedder,embed:async()=>{throw Error('counted fixture embedding failure');}},now});
        const prepared=await failing.prepare({url,maxTokens:40});assert.equal(prepared.status,'failed');if(prepared.status==='failed'){assert.equal(prepared.error.code,'ingest-failed');assert.match(prepared.error.message,/counted fixture/);assert.deepEqual(JSON.parse(JSON.stringify(prepared.error)),prepared.error);}
        assert.deepEqual(await f.store.listSources(),[]);assert.deepEqual(await f.store.listVersions(),[]);assert.deepEqual(await f.store.listChunks(),[]);
        await assert.rejects(()=>failing.ingest({url,maxTokens:40}),(error:unknown)=>error instanceof DocumentError&&error.code==='ingest-failed');
        const [source]=await f.store.listSources();assert.equal(source.status,'failed');assert.equal(source.activeVersionId,undefined);
    }finally{await f.db.close();}
});
it('an unchanged source uses the complete preparation identity and spends zero embedding calls',async()=>{
    const f=await fixture();try{const first=await f.ingester.ingest({url,maxTokens:40}),calls=f.calls();const second=await f.ingester.prepare({url,maxTokens:40});assert.equal(second.status,'unchanged');assert.equal(f.calls(),calls);
        await f.db.collection('document_versions').put({...first.version,extractionVersion:'tangle-extract/0'});
        const changed=await f.ingester.prepare({url,maxTokens:40});assert.equal(changed.status,'prepared');assert.ok(f.calls()>calls);
        if(changed.status==='prepared'){assert.deepEqual(changed.identity,preparedIdentityOf(changed.bundle.version));assert.equal(changed.identity.extractionVersion,'tangle-extract/1');}
        assert.equal((await f.store.getVersion(first.version.id))?.extractionVersion,'tangle-extract/0','prepare does not replace the active row');
    }finally{await f.db.close();}
});
it('a reverted source prepares retained child and parent evidence with zero new embeddings',async()=>{
    const f=await fixture();try{
        const input={url,strategy:'parent-child' as const,maxTokens:40,parentTokens:160},first=await f.ingester.ingest(input),chunks=await f.store.listChunks(first.version.id),parents=await f.store.listParents(first.version.id),elements=await f.store.listElements(first.version.id);
        f.body(2);const second=await f.ingester.ingest(input),calls=f.calls();f.body(1);const prepared=await f.ingester.prepare(input);assert.equal(prepared.status,'prepared');assert.equal(f.calls(),calls);
        if(prepared.status!=='prepared')throw Error('Expected retained preparation.');assert.equal(prepared.reused,true);assert.equal(prepared.metrics.embeddingCalls,0);assert.equal(prepared.bundle.version.id,first.version.id);
        assert.deepEqual(prepared.bundle.chunks,chunks);assert.deepEqual(prepared.bundle.elements,elements);assert.deepEqual(prepared.bundle.parents,parents);assert.equal((await f.store.getSource(first.source.id))?.activeVersionId,second.version.id);
        const returned=await f.ingester.ingest(input);assert.equal(returned.version.id,first.version.id);assert.equal(f.calls(),calls);assert.equal((await f.store.getVersion(second.version.id))?.status,'superseded');assert.equal((await f.store.getVersion(first.version.id))?.status,'active');
        const allParents=await f.store.listParents();assert.deepEqual(allParents.map(row=>row.id),[...allParents].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.versionId.localeCompare(b.versionId)||a.order-b.order||a.id.localeCompare(b.id)).map(row=>row.id));
    }finally{await f.db.close();}
});
it('an initially unknown embedding width produces the same final evidence addresses as a declared width',async()=>{
    const f=await fixture();try{
        const unknown=createDocumentIngester({store:f.store,fetcher:f.fetcher,embedder:{model:f.embedder.model,dims:undefined,embed:f.embedder.embed},now});
        const input={url,strategy:'parent-child' as const,maxTokens:40,parentTokens:160},a=await unknown.prepare(input),b=await f.ingester.prepare(input);
        assert.equal(a.status,'prepared');assert.equal(b.status,'prepared');if(a.status!=='prepared'||b.status!=='prepared')throw Error('Expected independent preparation.');
        assert.deepEqual(a.identity,b.identity);assert.equal(a.bundle.version.id,b.bundle.version.id);assert.deepEqual(a.bundle.elements,b.bundle.elements);assert.deepEqual(a.bundle.chunks,b.bundle.chunks);assert.deepEqual(a.bundle.parents,b.bundle.parents);assert.equal(a.identity.embeddedBy.dims,16);
    }finally{await f.db.close();}
});
it('composed activation failure retains the prior active source and reports the store failure',async()=>{
    const f=await fixture();try{
        const first=await f.ingester.ingest({url,maxTokens:40});f.body(2);const events:string[]=[];
        const ingester=createDocumentIngester({store:{...f.store,activate:async()=>{throw Error('activation stopped');}},fetcher:f.fetcher,embedder:f.embedder,now});
        await assert.rejects(()=>ingester.ingest({url,maxTokens:40,onProgress:event=>events.push(event.stage+':'+event.status)}),/activation stopped/);
        assert.equal((await f.store.getSource(first.source.id))?.activeVersionId,first.version.id);assert.equal((await f.store.getVersion(first.version.id))?.status,'active');assert.ok(events.includes('store:start'));assert.ok(events.includes('store:error'));
    }finally{await f.db.close();}
});

it('a stale unchanged metadata refresh cannot restore a prior active version',async()=>{
    const f=await fixture();try{const first=await f.ingester.ingest({url,maxTokens:40});f.body(2);const second=await f.ingester.ingest({url,maxTokens:40});await assert.rejects(()=>f.store.putSource(first.source),(error:unknown)=>error instanceof DocumentError&&error.code==='stale-source');assert.equal((await f.store.getSource(first.source.id))?.activeVersionId,second.version.id);}finally{await f.db.close();}
});
