import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetAccount} from '@tangleai/agents';
import {createScriptedPlanner,retrieveLightRag,LIGHTRAG_LIMITS,lightragMust} from '@tangleai/lightrag';
import {loadLightRagFixture,createLightRagFixtureCorpus} from '../../benchmark/lib/lightrag.ts';
it('the original full fixture builds identical evidenced graphs through memory and joint SQLite admission',async()=>{
    const loaded=await loadLightRagFixture(),memory=await createLightRagFixtureCorpus(loaded,{graph:'memory'}),sqlite=await createLightRagFixtureCorpus(loaded,{graph:'sqlite'});
    try{assert.deepEqual(await memory.graph!.listEntities({status:'all'}),await sqlite.graph!.listEntities({status:'all'}));assert.deepEqual(await memory.graph!.listRelations({status:'all'}),await sqlite.graph!.listRelations({status:'all'}));assert.equal(memory.contributions.length,7);assert.equal(memory.indexing.calls,14);assert.deepEqual(memory.indexing,sqlite.indexing);
        const planner=createScriptedPlanner(loaded.fixture.questions);
        for(const question of loaded.fixture.questions){const plan=lightragMust(await planner(question.text,{mode:'hybrid',limits:{...LIGHTRAG_LIMITS,chunksPerSource:1}}));
            const result=lightragMust(await retrieveLightRag({store:sqlite.graph!,documents:sqlite.store,embedder:sqlite.embedder,plan,budget:createBudgetAccount({turns:5,tokens:100000},()=>0),clock:()=>0}));
            const sources=result.citations.map(row=>row.sourceId);assert.equal(sources.length,new Set(sources).size);assert.ok(result.bundle.tokenCount<=4000);assert.equal(result.skipped.unresolvable,0);
            for(const citation of result.citations){const source=await sqlite.store.getSource(citation.sourceId);assert.ok((await sqlite.store.listChunks(source!.activeVersionId!)).some(row=>row.id===citation.chunkId));}
        }
        for(const question of loaded.fixture.questions)for(const mode of ['low','high','hybrid','hybrid-no-original']as const){
            const plan=lightragMust(await planner(question.text,{mode,limits:{...LIGHTRAG_LIMITS,contextTokens:64}}));
            const result=lightragMust(await retrieveLightRag({store:memory.graph!,documents:memory.store,embedder:memory.embedder,plan,budget:createBudgetAccount({turns:4,tokens:10000},()=>0),clock:()=>0}));
            assert.ok(result.bundle.tokenCount<=64,question.id+' '+mode);assert.equal(result.pruned,result.trace.filter(row=>row.prune!==null).length);
        }
    }finally{await memory.close();await sqlite.close();}
});
