import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {lightragMust,type GraphExtractionReply} from '@tangleai/lightrag';
import {corpusFixture} from '../fixtures/corpus-promotion.ts';
it('the retained relay history replaces the shipping engine without deleting its old evidence',async(t)=>{
    const f=await corpusFixture();try{
        const root=new URL('../../benchmark/fixtures/grounding/',import.meta.url),manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')) as {sources:Array<{key:string;url:string;mimeType:string;versions:Array<{key:string;file:string}>}>};
        const source=manifest.sources.find(row=>row.key==='relay-history')!;assert.deepEqual(source.versions.map(row=>row.key),['relay-history@1','relay-history@2']);
        const activations=[];
        for(const [index,version]of source.versions.entries()){
            const body=await readFile(new URL(version.file,root),'utf8');f.setBody(source.url,body,source.mimeType);
            const document=await f.ingester.prepare({url:source.url,strategy:'recursive',maxTokens:450,overlapTokens:48});assert.equal(document.status,'prepared');
            const engine=index===0?'cedar':'rowan';assert.ok(body.includes(`frames through the ${engine} engine`));
            const reply:GraphExtractionReply={entities:[{name:'Harbor Relay',type:'TECHNOLOGY',description:'Harbor Relay queues outbound frames.'},{name:engine,type:'TECHNOLOGY',description:`The ${engine} engine provides the current outbound queue.`}],
                relations:[{source:'Harbor Relay',target:engine,description:`Harbor Relay queues outbound frames through ${engine}.`,themes:['shipping queue engine'],strength:1}],contentKeywords:['shipping queue engine']};
            const prepared=lightragMust(await f.prepareDocument(document,()=>reply));if(prepared.status!=='prepared')throw Error('Expected graph preparation.');const receipt=lightragMust(await f.promotion.promote(prepared));activations.push({prepared,receipt});await f.citations();
        }
        const entities=await f.graph.listEntities({status:'all'}),relations=await f.graph.listRelations({status:'all'}),oldEngine=entities.find(row=>row.name==='cedar')!,newEngine=entities.find(row=>row.name==='rowan')!;
        assert.equal(oldEngine.status,'retracted');assert.equal(newEngine.status,'active');assert.equal(relations.filter(row=>row.status==='active').length,1);assert.equal(relations.filter(row=>row.status==='retracted').length,1);assert.equal(relations.find(row=>row.status==='active')?.targetEntityId,newEngine.id);
        const oldVersion=activations[0].prepared.document.version.id;assert.equal((await f.documents.getVersion(oldVersion))?.status,'superseded');assert.ok((await f.documents.listChunks(oldVersion)).length>0);assert.ok((await f.documents.listElements(oldVersion)).length>0);
        t.diagnostic(JSON.stringify({versions:2,removedShippingFacts:1,keptRelayEntities:1,activeShippingFacts:1,secondTouched:activations[1].prepared.contribution.plan.touchedEntityIds.length+activations[1].prepared.contribution.plan.touchedRelationIds.length,providerCalls:0,extractedChunks:f.counts.extraction,embeddingCalls:f.counts.graphEmbedding}));
    }finally{await f.db.close();}
});
