import {it} from 'node:test';
import assert from 'node:assert/strict';
import {lightragMust} from '@tangleai/lightrag';
import {DocumentError} from '@tangleai/documents';
import {corpusFixture} from '../fixtures/corpus-promotion.ts';
it('atomic corpus admission supports unchanged, incremental replacement, retraction and zero-call reactivation',async(t)=>{
    const f=await corpusFixture();try{
        const a=await f.activate('a'),original=await f.graph.listEntities(),archive=original.find(row=>row.name==='Archive')!;
        const beforeUnchanged={...f.counts},unchanged=await f.prepare('a');assert.equal(unchanged.status,'unchanged');assert.deepEqual(f.counts,beforeUnchanged);
        const beforeB=f.counts.extraction,b=await f.activate('b');assert.equal(f.counts.extraction-beforeB,1);await f.citations();
        const repeatedBefore=await f.snapshot(),repeat=lightragMust(await f.promotion.promote(b.prepared));assert.equal(repeat.documentWrites,0);assert.equal(repeat.graph.writes,0);assert.deepEqual(await f.snapshot(),repeatedBefore);
        const second=await f.activate('b',2),entities=await f.graph.listEntities({status:'all'}),relations=await f.graph.listRelations({status:'all'});
        assert.equal(entities.find(row=>row.name==='OldPolicy')?.status,'retracted');assert.equal(entities.find(row=>row.name==='NewPolicy')?.status,'active');assert.deepEqual(entities.find(row=>row.id===archive.id),archive);
        assert.equal(relations.filter(row=>row.status==='active').length,2);assert.equal(relations.filter(row=>row.status==='retracted').length,1);await f.citations();
        assert.ok((await f.documents.listChunks(b.prepared.document.version.id)).length>0);assert.equal((await f.documents.getVersion(b.prepared.document.version.id))?.status,'superseded');
        const removed=lightragMust(await f.promotion.retract(second.prepared.document.source.id));assert.equal(removed.documentWrites,2);assert.equal((await f.graph.listEntities()).length,2);assert.equal((await f.graph.listRelations()).length,0);await f.citations();
        const twice=lightragMust(await f.promotion.retract(second.prepared.document.source.id));assert.equal(twice.documentWrites,0);assert.equal(twice.graph,null);
        const beforeReturn={...f.counts},returned=await f.activate('b');assert.deepEqual(f.counts,beforeReturn);assert.equal(returned.prepared.reused,true);assert.equal(returned.receipt.graph.reactivation,true);assert.equal(returned.receipt.graph.newClaims,0);assert.equal(returned.receipt.spend.calls,0);await f.citations();
        assert.equal(returned.receipt.graph.head.revision,4);assert.equal((await f.graph.activeProjectionFor(a.prepared.document.source.id))?.id,a.receipt.graph.projectionId);
        t.diagnostic(JSON.stringify({removedEntities:2,remainingEntities:2,remainingRelations:0,replacementTouched:second.prepared.contribution.plan.touchedEntityIds.length+second.prepared.contribution.plan.touchedRelationIds.length,reactivationNewClaims:returned.receipt.graph.newClaims,reactivationCalls:returned.receipt.spend.calls,counts:f.counts}));
    }finally{await f.db.close();}
});
it('reversion after another source changes shared support uses evidenced profiles with zero new model calls',async()=>{
    const f=await corpusFixture();try{await f.activate('a');await f.activate('b');await f.activate('b',2);await f.activate('c');const counts={...f.counts},returned=await f.activate('b');assert.deepEqual(f.counts,counts);assert.ok(returned.prepared.contribution.warnings.some(text=>text.includes('deterministic description unions')));const cedar=(await f.graph.listEntities()).find(row=>row.name==='Cedar')!;assert.match(cedar.profile,/regional equipment/);assert.equal(cedar.supportChunkIds.length,3);await f.citations();}finally{await f.db.close();}
});
it('a failure at each document or graph promotion stage rolls back both active heads and every row',async()=>{
    let fail='';const f=await corpusFixture({probe:step=>{if(step===fail)throw Error('forced corpus rollback '+step);}});
    try{await f.activate('a');const before=await f.snapshot(),prepared=await f.prepare('b');assert.equal(prepared.status,'prepared');if(prepared.status!=='prepared')throw Error('Expected candidate.');
        for(const step of ['put:document_versions','put:document_chunks','graph:put:entity_claims','graph:put:entities','commit']){fail=step;const outcome=await f.promotion.promote(prepared);assert.equal(outcome.valid,false,step);assert.deepEqual(await f.snapshot(),before,step);}
        fail='';lightragMust(await f.promotion.promote(prepared));await f.citations();
    }finally{await f.db.close();}
});
it('a stale expected source fence refuses before writes and retains the native outcomes cause',async()=>{
    const steps:string[]=[],f=await corpusFixture({probe:step=>{steps.push(step);}});try{await f.activate('a');const first=await f.prepare('b'),second=await f.prepare('b',2);assert.equal(first.status,'prepared');assert.equal(second.status,'prepared');if(first.status!=='prepared'||second.status!=='prepared')throw Error('Expected candidates.');lightragMust(await f.promotion.promote(first));steps.length=0;const before=await f.snapshot(),result=await f.promotion.promote(second);assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1006');assert.equal(result.issues[0].cause?.code,'OUTC1013');}assert.deepEqual(steps,[]);assert.deepEqual(await f.snapshot(),before);}finally{await f.db.close();}
});
it('plain document activation cannot split an indexed source from its active graph',async()=>{
    const f=await corpusFixture();try{await f.activate('b');const candidate=await f.prepare('b',2);assert.equal(candidate.status,'prepared');if(candidate.status!=='prepared')throw Error('Expected candidate.');const before=await f.snapshot();await assert.rejects(()=>f.documents.activate(candidate.document),(error:unknown)=>error instanceof DocumentError&&error.code==='graph-promotion-required');assert.deepEqual(await f.snapshot(),before);}finally{await f.db.close();}
});
it('two concurrent corpus promotions admit one document and one matching graph head',async()=>{
    const f=await corpusFixture();try{const first=await f.prepare('b'),second=await f.prepare('b',2);if(first.status!=='prepared'||second.status!=='prepared')throw Error('Expected candidates.');
        const results=await Promise.all([f.promotion.promote(first),f.promotion.promote(second)]),winner=results.find(row=>row.valid)!,loser=results.find(row=>!row.valid)!;
        assert.equal(results.filter(row=>row.valid).length,1);assert.equal(results.filter(row=>!row.valid).length,1);if(!winner.valid||loser.valid)throw Error('Expected one winner.');
        assert.equal(loser.issues[0].cause?.code,'OUTC1013');assert.equal((await f.documents.getSource(winner.value.sourceId))?.activeVersionId,winner.value.versionId);assert.equal((await f.graph.activeProjectionFor(winner.value.sourceId))?.versionId,winner.value.versionId);assert.equal((await f.graph.listProjections({sourceId:winner.value.sourceId})).length,1);await f.citations();
    }finally{await f.db.close();}
});
it('a partial extraction remains refused until the caller explicitly permits partial promotion',async()=>{
    const f=await corpusFixture();try{const document=await f.ingester.prepare({url:f.source('partial'),maxTokens:80,overlapTokens:16});const candidate=lightragMust(await f.prepareDocument(document,()=>null));
        if(candidate.status!=='prepared')throw Error('Expected partial candidate.');assert.equal(candidate.contribution.partial,true);assert.equal(candidate.contribution.failures.length,1);assert.equal(candidate.contribution.completedChunkIds.length,0);
        const before=await f.snapshot(),refused=await f.promotion.promote(candidate);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1006');assert.deepEqual(await f.snapshot(),before);
        const accepted=lightragMust(await f.promotion.promote({...candidate,allowPartial:true}));assert.ok(accepted.documentWrites>0);assert.equal(accepted.graph.newClaims,0);assert.equal((await f.graph.activeProjectionFor(accepted.sourceId))?.versionId,accepted.versionId);
    }finally{await f.db.close();}
});
it('a partial document also requires explicit permission and preserves the prior corpus until admission',async()=>{
    const f=await corpusFixture();try{await f.activate('b');const candidate=await f.prepare('b',2);if(candidate.status!=='prepared')throw Error('Expected candidate.');const document={...candidate.document,version:{...candidate.document.version,metrics:{...candidate.document.version.metrics,partial:true}}};
        const before=await f.snapshot(),refused=await f.promotion.promote({...candidate,document});assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1006');assert.deepEqual(await f.snapshot(),before);lightragMust(await f.promotion.promote({...candidate,document,allowPartial:true}));await f.citations();
    }finally{await f.db.close();}
});
it('a document identity mismatch refuses before any graph call or store write',async()=>{
    const f=await corpusFixture();try{const document=await f.ingester.prepare({url:f.source('a'),maxTokens:80}),counts={...f.counts},before=await f.snapshot();
        const result=await f.prepareDocument(document,()=>({entities:[],relations:[],contentKeywords:[]}),graph=>({...graph,identities:{...graph.identities,chunker:{...graph.identities.chunker,version:'wrong-chunker'}}}));
        assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1006');assert.equal(result.spend.calls,0);}assert.deepEqual(f.counts,counts);assert.deepEqual(await f.snapshot(),before);
    }finally{await f.db.close();}
});
it('missing physical foreign evidence refuses a valid prepared graph before document activation',async()=>{
    const steps:string[]=[],f=await corpusFixture({probe:step=>{steps.push(step);}});try{const a=await f.activate('a'),b=await f.prepare('b');if(b.status!=='prepared')throw Error('Expected candidate.');
        await f.db.collection('document_chunks').delete(a.prepared.document.chunks[0].id);const before=await f.snapshot();steps.length=0;const refused=await f.promotion.promote(b);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1003');assert.deepEqual(steps,[]);assert.deepEqual(await f.snapshot(),before);
    }finally{await f.db.close();}
});
it('retraction failures roll back both heads and a stale failure record cannot resurrect a retired document',async()=>{
    let fail=false;const f=await corpusFixture({probe:step=>{if(fail&&step==='commit')throw Error('Retraction interrupted.');}});try{const active=await f.activate('b'),before=await f.snapshot();fail=true;assert.equal((await f.promotion.retract(active.receipt.sourceId)).valid,false);assert.deepEqual(await f.snapshot(),before);fail=false;lightragMust(await f.promotion.retract(active.receipt.sourceId));
        await f.documents.recordFailure({...active.prepared.document.source,status:'failed',error:'Earlier preparation failed.'});assert.equal((await f.documents.getSource(active.receipt.sourceId))?.activeVersionId,undefined);assert.equal(await f.graph.activeProjectionFor(active.receipt.sourceId),undefined);
    }finally{await f.db.close();}
});
it('a reader queued during document writes receives matching committed document and graph versions',async()=>{
    let release!:()=>void,entered!:()=>void,pause=false;const suspended=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
    const f=await corpusFixture({probe:async step=>{if(pause&&step==='document'){entered();await resume;}}});
    try{await f.activate('b');const candidate=await f.prepare('b',2);if(candidate.status!=='prepared')throw Error('Expected candidate.');pause=true;
        const writing=f.promotion.promote(candidate);await Promise.race([suspended,writing.then(()=>{throw Error('Promotion did not reach its suspended transaction.');})]);
        let settled=false;const reading=f.db.transaction(async scope=>{
            const source=await scope.collection<{activeVersionId:string}>('sources').get(candidate.document.source.id);
            const rows=await scope.collection('lightrag_projections').execute<unknown>({$for:{row:'$[*]'},$where:{$eq:['$row.status','active']},$return:'$row.payload.versionId'});return {source:source?.activeVersionId,graph:rows};
        },{mode:'deferred'}).then(value=>{settled=true;return value;});
        await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(settled,false);release();lightragMust(await writing);const read=await reading;assert.equal(read.source,candidate.document.version.id);assert.deepEqual(Array.isArray(read.graph)?read.graph:[read.graph],[candidate.document.version.id]);
    }finally{release();await f.db.close();}
});
it('reactivation preserves a retired identity separately from a later same-name homonym without new calls',async()=>{
    const f=await corpusFixture();try{const original=await f.activate('a'),id=original.prepared.contribution.plan.input.candidates.entities.find(row=>row.name==='Cedar')!.id;
        lightragMust(await f.promotion.retract(original.receipt.sourceId));await f.activate('c');const later=(await f.graph.listEntities()).find(row=>row.name==='Cedar')!;assert.notEqual(later.id,id);
        const before={...f.counts},returned=await f.activate('a');assert.deepEqual(f.counts,before);assert.equal(returned.receipt.graph.reactivation,true);const cedar=await f.graph.listEntities({normalizedNames:['cedar']});assert.equal(cedar.length,2);assert.ok(cedar.some(row=>row.id===id));assert.ok(cedar.some(row=>row.id===later.id));await f.citations();
    }finally{await f.db.close();}
});
it('cached reactivation follows a reviewed canonical merge and redirects retained relations without new calls',async()=>{
    const {createScriptedCoreferenceJudge}=await import('@tangleai/lightrag'),f=await corpusFixture();try{
        async function initial(name:string,description:string,apart:boolean){
            const document=await f.ingester.prepare({url:f.source(name),maxTokens:80,overlapTokens:16}),place=name==='a'?'Archive':'Willow';
            const result=lightragMust(await f.prepareDocument(document,()=>({entities:[{name:'Cedar',type:'ORGANIZATION',description},{name:place,type:'CONCEPT',description:place+' is the equipment register.'}],relations:[{source:'Cedar',target:place,description:'Cedar maintains '+place,themes:['equipment'],strength:1}],contentKeywords:['equipment']}),graph=>apart?{...graph,judge:createScriptedCoreferenceJudge(input=>({groups:input.subjects.map(row=>[row.id]),reasons:input.subjects.map(row=>row.description)}),{modelIdentity:graph.judge.modelIdentity,promptRevision:graph.judge.promptRevision})}:graph));
            if(result.status!=='prepared')throw Error('Expected source.');lightragMust(await f.promotion.promote(result));return result;
        }
        const a=await initial('a','Cedar operates the archive register.',false),b=await initial('b','Cedar is a separately described equipment organization.',true);
        const originalIds=[a,b].map(row=>row.contribution.plan.input.candidates.entities.find(row=>row.name==='Cedar')!.id);assert.equal(new Set(originalIds).size,2);
        await f.activate('c');const survivor=(await f.graph.listEntities({normalizedNames:['cedar']}))[0];assert.equal(survivor.id,[...originalIds].sort()[0]);
        const loser=originalIds[0]===survivor.id?b:a,name=loser===a?'a':'b',oldId=originalIds[loser===a?0:1];assert.equal((await f.graph.listEntities({ids:[oldId],status:'all'}))[0].status,'merged');
        lightragMust(await f.promotion.retract(loser.document.source.id));const counts={...f.counts},returned=await f.activate(name);assert.deepEqual(f.counts,counts);assert.equal(returned.receipt.graph.newClaims,0);assert.equal(returned.receipt.graph.reactivation,true);
        assert.equal((await f.graph.listEntities({normalizedNames:['cedar']})).length,1);assert.ok(returned.prepared.contribution.plan.input.candidates.entities.some(row=>row.id===survivor.id));
        assert.ok(returned.prepared.contribution.plan.input.candidates.relations.every(row=>row.sourceEntityId===survivor.id));assert.equal((await f.graph.listEntities({ids:[oldId],status:'all'}))[0].status,'merged');await f.citations();
    }finally{await f.db.close();}
});
