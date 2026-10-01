import {it} from 'node:test';
import assert from 'node:assert/strict';
import {collectDocumentGarbage} from '@tangleai/store';
import {corpusFixture} from '../fixtures/corpus-promotion.ts';
it('garbage collection names graph, chat, nested-run and host-report references and only deletes unreferenced evidence',async()=>{
    const f=await corpusFixture();try{
        const graph=await f.activate('b');await f.activate('b',2);
        async function retired(name:string){const url=f.source(name),input={url,strategy:'parent-child' as const,maxTokens:40,parentTokens:160};const first=await f.ingester.ingest(input);f.source(name,2);await f.ingester.ingest(input);return {first,chunk:(await f.documents.listChunks(first.version.id))[0]};}
        const chat=await retired('chat'),run=await retired('run'),report=await retired('report'),free=await retired('free');
        await f.db.collection('chats').put({id:'cited-chat',role:'assistant',text:'A retained claim.',at:'2026-06-01',citations:[chat.chunk.id]});
        await f.db.collection('runs').put({id:'cited-run',kind:'test',status:'ok',startedAt:'2026-06-01',summary:{nested:{evidence:[{versionId:run.first.version.id}]}}});
        const resolvers=[{name:'report',resolve:(candidate:{versionId:string})=>candidate.versionId===report.first.version.id?['frozen-report']:[]}],before=await f.snapshot();
        const dry=await collectDocumentGarbage(f.db,{resolvers,dryRun:true});assert.deepEqual(dry.deleted,[]);assert.deepEqual(dry.eligible.map(row=>row.versionId),[free.first.version.id]);assert.deepEqual(await f.snapshot(),before);
        const byVersion=new Map(dry.retained.map(row=>[row.versionId,row.referencedBy]));assert.ok(byVersion.get(graph.prepared.document.version.id)?.some(ref=>ref.startsWith('graph:')));assert.deepEqual(byVersion.get(chat.first.version.id),['chat:cited-chat']);assert.deepEqual(byVersion.get(run.first.version.id),['run:cited-run']);assert.deepEqual(byVersion.get(report.first.version.id),['report:frozen-report']);
        const done=await collectDocumentGarbage(f.db,{resolvers,dryRun:false});assert.deepEqual(done.deleted,done.eligible);assert.equal(done.deleted.length,1);
        assert.deepEqual(await f.documents.listChunks(free.first.version.id),[]);assert.deepEqual(await f.documents.listElements(free.first.version.id),[]);assert.deepEqual(await f.documents.listParents(free.first.version.id),[]);assert.equal((await f.documents.getVersion(free.first.version.id))?.status,'superseded');
        assert.ok((await f.documents.listChunks(graph.prepared.document.version.id)).length>0);assert.ok((await f.documents.listChunks(chat.first.version.id)).length>0);
        const second=await collectDocumentGarbage(f.db,{resolvers,dryRun:false});assert.deepEqual(second.deleted,[]);assert.deepEqual(second.eligible,[]);
    }finally{await f.db.close();}
});
it('an unavailable host reference resolver aborts before deleting any candidate',async()=>{
    const f=await corpusFixture();try{const url=f.source('free');await f.ingester.ingest({url,maxTokens:80});f.source('free',2);await f.ingester.ingest({url,maxTokens:80});const before=await f.snapshot();await assert.rejects(()=>collectDocumentGarbage(f.db,{dryRun:false,resolvers:[{name:'reports',resolve:()=>{throw Error('reference lookup failed');}}]}),/reference lookup failed/);assert.deepEqual(await f.snapshot(),before);}finally{await f.db.close();}
});
it('an active source pointer retains evidence even if its version status is corrupt',async()=>{
    const f=await corpusFixture();try{const url=f.source('pointer'),active=await f.ingester.ingest({url,maxTokens:80});await f.db.collection('document_versions').put({...active.version,status:'failed'});const result=await collectDocumentGarbage(f.db,{dryRun:false});assert.deepEqual(result.deleted,[]);assert.deepEqual(result.retained,[{versionId:active.version.id,referencedBy:['source:'+active.source.id]}]);}finally{await f.db.close();}
});
