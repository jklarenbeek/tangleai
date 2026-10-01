import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetAccount} from '@tangleai/agents';
import {retrieveLightRag,lightragMust,type LightRagRetrieval} from '@tangleai/lightrag';
import {retrievalFixture} from '../fixtures/lightrag-retrieval.ts';
it('the preregistered separate-chunk control reaches exactly one hop and misses its two-hop fact',async(t)=>{
    const f=await retrievalFixture();try{const one=await f.retrieve(),none=await f.retrieve('low',{expansionRelations:0});
        assert.ok(one.bundle.suppliedChunkIds.includes(f.chunkByKey.get('bridge-fact')!));assert.ok(!one.bundle.suppliedChunkIds.includes(f.chunkByKey.get('far-fact')!));assert.ok(!none.bundle.suppliedChunkIds.includes(f.chunkByKey.get('bridge-fact')!));
        assert.ok(one.entities.some(row=>row.name==='Bridge'));assert.ok(!one.entities.some(row=>row.name==='Far'));assert.ok(one.trace.some(row=>row.reason==='one-hop'&&row.prune===null));assert.equal(one.skipped.unresolvable,0);
        t.diagnostic(JSON.stringify({oneHopFound:true,twoHopFound:false,withoutExpansionOneHopFound:false,calls:one.spend.calls,pruned:one.pruned,tokens:one.bundle.tokenCount}));
    }finally{await f.db.close();}
});
it('exact in-memory and SQLite retrieval produce identical modes, traces, context and citations',async()=>{
    const f=await retrievalFixture();try{for(const mode of ['low','high','hybrid','hybrid-no-original']as const)assert.deepEqual(await f.retrieve(mode,{},f.memory),await f.retrieve(mode,{},f.graph));}finally{await f.db.close();}
});
it('each mode removes only its named candidate source and omitting original text retains hybrid citations',async()=>{
    const f=await retrievalFixture();try{const low=await f.retrieve('low'),high=await f.retrieve('high'),hybrid=await f.retrieve('hybrid'),noOriginal=await f.retrieve('hybrid-no-original');
        assert.equal(low.trace.filter(row=>row.reason==='high').length,0);assert.equal(high.trace.filter(row=>row.reason==='low').length,0);assert.ok(hybrid.trace.some(row=>row.reason==='low'));assert.ok(hybrid.trace.some(row=>row.reason==='high'));
        assert.equal(noOriginal.chunks.length,0);assert.equal(noOriginal.bundle.sections.chunks,'');assert.deepEqual(noOriginal.bundle.suppliedChunkIds,hybrid.bundle.suppliedChunkIds);assert.deepEqual(noOriginal.citations,hybrid.citations);assert.deepEqual(noOriginal.entities,hybrid.entities);assert.deepEqual(noOriginal.relations,hybrid.relations);
    }finally{await f.db.close();}
});
it('registered context and expansion bounds hold at zero and 64 estimated tokens with reasoned pruning',async()=>{
    const f=await retrievalFixture();try{for(const contextTokens of [0,64,4000])for(const mode of ['low','high','hybrid','hybrid-no-original']as const){const result=await f.retrieve(mode,{contextTokens,expansionEntities:1,expansionRelations:1,chunksPerSource:1});
        assert.ok(result.bundle.tokenCount<=contextTokens);assert.equal(result.pruned,result.trace.filter(row=>row.prune!==null).length);assert.ok(result.trace.filter(row=>row.prune).every(row=>typeof row.prune==='string'));const counts=new Map<string,number>();for(const citation of result.citations)counts.set(citation.sourceId,(counts.get(citation.sourceId)??0)+1);assert.ok([...counts.values()].every(n=>n<=1));
        assert.ok(result.trace.filter(row=>row.kind==='relation'&&row.reason==='one-hop'&&row.prune===null).map(row=>row.id).filter((id,i,all)=>all.indexOf(id)===i).length<=2,'one admitted expansion plus an already seeded relation');
    }}finally{await f.db.close();}
});
it('equal scores have the same score-descending and id-ascending order across ten runs',async()=>{
    const f=await retrievalFixture();try{let first:LightRagRetrieval|undefined;for(let run=0;run<10;run++){const result=await f.retrieve('hybrid',{candidatesPerKeyword:10});if(first)assert.deepEqual(result,first);else first=result;assert.deepEqual(result.chunks.map(row=>row.id),[...result.chunks].sort((a,b)=>b.score-a.score||(a.id<b.id?-1:1)).map(row=>row.id));}}finally{await f.db.close();}
});
it('foreign embedding identity and corrupt widths are skipped and counted without comparison',async()=>{
    const f=await retrievalFixture();try{const store={...f.graph,listEntities:async(filter?:Parameters<typeof f.graph.listEntities>[0])=>(await f.graph.listEntities(filter)).map(row=>row.name==='Bridge'?{...row,embeddedBy:{...row.embeddedBy,model:'foreign'}}:row.name==='Far'?{...row,embedding:[1]}:row)};
        const result=await f.retrieve('low',{},store);assert.equal(result.skipped.identity,1);assert.equal(result.skipped.width,1);assert.ok(result.trace.some(row=>row.prune==='identity'));assert.ok(result.trace.some(row=>row.prune==='width'));assert.ok(result.entities.every(row=>row.name==='Start'));
    }finally{await f.db.close();}
});
it('an unavailable active source excludes the affected canonical and its citation targets',async()=>{
    const f=await retrievalFixture();try{const plan=lightragMust(await f.planner(f.control.query,{mode:'low',limits:f.control.limits})),source=f.sourceByKey.get('bridge-fact')!;
        const documents={...f.documents,getSource:async(id:string)=>id===source?undefined:f.documents.getSource(id)};
        const result=lightragMust(await retrieveLightRag({store:f.graph,documents,embedder:f.embedder,plan,budget:createBudgetAccount({turns:3},()=>0),clock:()=>0}));assert.ok(result.skipped.unresolvable>0);assert.ok(!result.bundle.suppliedChunkIds.includes(f.chunkByKey.get('bridge-fact')!));assert.ok(result.entities.every(row=>row.name!=='Bridge'));
    }finally{await f.db.close();}
});
it('native adjacency bound errors preserve their coded cause and spent query embedding',async()=>{
    const f=await retrievalFixture();try{const plan=lightragMust(await f.planner(f.control.query,{mode:'low',limits:f.control.limits}));const store={...f.graph,listRelations:async()=>{throw Object.assign(Error('Per-root maxRows exceeded.'),{code:'JD2073',path:'/relations'});}};
        const result=await retrieveLightRag({store,documents:f.documents,embedder:f.embedder,plan,budget:createBudgetAccount({turns:3},()=>0),clock:()=>0});assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1008');assert.equal(result.issues[0].cause?.code,'JD2073');assert.equal(result.spend.calls,1);}
    }finally{await f.db.close();}
});
it('a changed graph fence refuses a mixed retrieval snapshot instead of returning stale citations',async()=>{
    const f=await retrievalFixture();try{let reads=0;const store={...f.graph,listProjections:async(filter?:Parameters<typeof f.graph.listProjections>[0])=>{const rows=await f.graph.listProjections(filter);return ++reads===1?rows:rows.map((row,i)=>i===0?{...row,head:{...row.head,revision:row.head.revision+1}}:row);}};
        const plan=lightragMust(await f.planner(f.control.query,{mode:'low',limits:f.control.limits})),result=await retrieveLightRag({store,documents:f.documents,embedder:f.embedder,plan,budget:createBudgetAccount({turns:3},()=>0),clock:()=>0});assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1008');assert.equal(result.spend.calls,1);}
    }finally{await f.db.close();}
});

it('one shared query budget stops before a second keyword embedding and preserves incurred work',async()=>{
    const f=await retrievalFixture();try{let calls=0;const embedder={...f.embedder,embed:async(texts:string[])=>{calls++;return f.embedder.embed(texts);}};
        const plan=lightragMust(await f.planner(f.control.query,{mode:'hybrid',limits:f.control.limits})),result=await retrieveLightRag({store:f.graph,documents:f.documents,embedder,plan,budget:createBudgetAccount({turns:1},()=>0),clock:()=>0});
        assert.equal(result.valid,false);assert.equal(calls,1);assert.equal(result.spend.calls,1);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1005');
    }finally{await f.db.close();}
});
it('malformed keyword vectors stop retrieval after metering the attempted embedder call',async()=>{
    const f=await retrievalFixture();try{const plan=lightragMust(await f.planner(f.control.query,{mode:'low',limits:f.control.limits})),result=await retrieveLightRag({store:f.graph,documents:f.documents,embedder:{...f.embedder,embed:async()=>[new Float32Array([1])]},plan,budget:createBudgetAccount({turns:2},()=>0),clock:()=>0});
        assert.equal(result.valid,false);assert.equal(result.spend.calls,1);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1002');
    }finally{await f.db.close();}
});
it('a document head changed after evidence resolution refuses the entire mixed context',async()=>{
    const f=await retrievalFixture();try{const counts=new Map<string,number>(),documents={...f.documents,getSource:async(id:string)=>{const row=await f.documents.getSource(id),count=(counts.get(id)??0)+1;counts.set(id,count);return row&&count>1?{...row,activeVersionId:'changed'}:row;}};
        const plan=lightragMust(await f.planner(f.control.query,{mode:'low',limits:f.control.limits})),result=await retrieveLightRag({store:f.graph,documents,embedder:f.embedder,plan,budget:createBudgetAccount({turns:2},()=>0),clock:()=>0});
        assert.equal(result.valid,false);assert.equal(result.spend.calls,1);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1008');assert.equal(result.issues[0].path,'/documentVersion');}
    }finally{await f.db.close();}
});
