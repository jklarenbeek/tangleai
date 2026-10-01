import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createBudgetAccount} from '@tangleai/agents';
import {createLightRagEngine,createLightRagRetriever,createKeywordPlanner,lightRagPrompt,lightragMust,validateLightRagAnswerRecord,lightragRevisionOf,renderLightRagAnswer,type LightRagChatClient,type LightRagAnswerRecord,type LightRagRetriever} from '@tangleai/lightrag';
import {retrievalFixture} from '../fixtures/lightrag-retrieval.ts';
import {loadLightRagFixture,createLightRagFixtureCorpus} from '../../benchmark/lib/lightrag.ts';
import {createScriptedPlanner} from '@tangleai/lightrag';
const now=()=> '2026-06-01T00:00:00.000Z';
const client=(reply:()=>unknown,usage=3):LightRagChatClient=>({endpoint:{provider:'fixture',model:'answer'},complete:async()=>({message:{content:JSON.stringify(reply())},usage:{total_tokens:usage}})});
async function testEngine(f:Awaited<ReturnType<typeof retrievalFixture>>,wire:LightRagChatClient|null,turns=8,recordSink?:(record:LightRagAnswerRecord)=>void){
    const budget=createBudgetAccount({turns,tokens:100000},()=>0),retrieve=createLightRagRetriever({store:f.graph,documents:f.documents,planner:f.planner});
    return createLightRagEngine({retrieve,client:wire,budget,embedder:f.embedder,identities:{prompts:{},embedder:{model:f.embedder.model,dims:f.embedder.dims!},runIdentityId:null},clock:()=>0,now,recordSink});
}
it('specific low, abstract high and one-hop fixture answers keep only declared supplied citations', {timeout:60000}, async()=>{
    const loaded=await loadLightRagFixture(),corpus=await createLightRagFixtureCorpus(loaded,{graph:'memory'});
    try{for(const [kind,mode]of [['specific','low'],['abstract','high'],['one-hop','hybrid']]as const){
        const question=loaded.fixture.questions.find(row=>row.kind===kind)!,budget=createBudgetAccount({turns:8,tokens:10000},()=>0),planner=createScriptedPlanner(loaded.fixture.questions),native=createLightRagRetriever({store:corpus.graph!,documents:corpus.store,planner});let supplied:string[]=[];
        const retrieve:LightRagRetriever=async(q,request)=>{const result=await native(q,request);if(result.valid)supplied=result.value.bundle.suppliedChunkIds;return result;};
        const answerId=corpus.idByKey.get(question.goldChunks[0])!,wire=client(()=>({disposition:'answer',claims:[{id:'fact',text:'The fixture evidence answers the query.',citations:[answerId]}]}));
        const engine=createLightRagEngine({retrieve,client:wire,budget,embedder:corpus.embedder,identities:{prompts:{},embedder:loaded.fixture.chunker.embeddedBy,runIdentityId:null},clock:()=>0,now});
        const record=lightragMust(await engine.answer(question.text,{mode}));assert.equal(record.answer.disposition,'answer');assert.ok(supplied.includes(answerId));assert.deepEqual(record.citations.map(row=>row.chunkId),[answerId]);assert.equal(record.stopReason,'completed');assert.equal((await validateLightRagAnswerRecord(record)).valid,true);
        for(const citation of record.citations){const source=await corpus.store.getSource(citation.sourceId);assert.ok((await corpus.store.listChunks(source!.activeVersionId!)).some(row=>row.id===citation.chunkId));}
    }}finally{await corpus.close();}
});
it('generation cannot cite entity or relation ids after one repair and degrades to the exact retrieved sections',async()=>{
    const f=await retrievalFixture();try{const entity=(await f.graph.listEntities())[0],relation=(await f.graph.listRelations())[0];let calls=0;
        const engine=await testEngine(f,client(()=>({disposition:'answer',claims:[{id:'fact',text:'Forged graph address.',citations:[++calls===1?entity.id:relation.id]}]})));
        const record=lightragMust(await engine.answer(f.control.query,{mode:'low',limits:f.control.limits})),retrieval=await f.retrieve('low');
        assert.equal(calls,2);assert.equal(record.answer.disposition,'invalid');assert.equal(record.stopReason,'TLRAG1009');assert.equal(record.issues[0].code,'TLRAG1009');assert.equal(renderLightRagAnswer(record),retrieval.bundle.text);assert.deepEqual(record.citations.map(row=>row.chunkId).sort(),retrieval.bundle.suppliedChunkIds);assert.equal(record.spend.calls,3);assert.equal(record.spend.tokens,9);
    }finally{await f.db.close();}
});
it('a repaired answer retains the exact supplied chunk it named without replacing it with a nearer chunk',async()=>{
    const f=await retrievalFixture();try{let calls=0;const id=f.chunkByKey.get('bridge-fact')!;
        const engine=await testEngine(f,client(()=>({disposition:'answer',claims:[{id:'fact',text:'Bridge stores the blue marker.',citations:[++calls===1?'invented':id]}]})));
        const record=lightragMust(await engine.answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(calls,2);assert.equal(record.answer.disposition,'answer');assert.deepEqual(record.citations.map(row=>row.chunkId),[id]);assert.equal(record.citations[0].sourceId,f.sourceByKey.get('bridge-fact'));assert.equal(record.spend.calls,3);
    }finally{await f.db.close();}
});
it('no model, an empty model name and empty replies remain named grounded values with counted costs',async()=>{
    const f=await retrievalFixture();try{
        let blankCalls=0;const blank={endpoint:{provider:'fixture',model:''},complete:async()=>{blankCalls++;throw Error('No model must not call the wire.');}},empty={endpoint:{provider:'fixture',model:'empty'},complete:async()=>({message:{content:''},usage:{total_tokens:2}})};
        for(const [wire,disposition,calls]of [[null,'no-model',1],[blank,'empty-model',1],[empty,'empty-model',3]]as const){const engine=await testEngine(f,wire),record=lightragMust(await engine.answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(record.answer.disposition,disposition);assert.equal(record.stopReason,disposition);assert.equal(record.spend.calls,calls);assert.ok(record.citations.length>0);assert.equal(record.identities.model?.model,wire?.endpoint.model||undefined);}
        assert.equal(blankCalls,0);
    }finally{await f.db.close();}
});
it('dead wires and a generation budget stop retain the supplied evidence and account every attempted call',async()=>{
    const f=await retrievalFixture();try{let calls=0;const dead={endpoint:{provider:'fixture',model:'dead'},complete:async()=>{calls++;throw Error('Disconnected provider.');}};
        const broken=lightragMust(await (await testEngine(f,dead)).answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(calls,1);assert.equal(broken.answer.disposition,'wire');assert.equal(broken.stopReason,'wire-error');assert.equal(broken.spend.calls,2);assert.ok(broken.citations.length>0);
        calls=0;const stopped=lightragMust(await (await testEngine(f,dead,1)).answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(calls,0);assert.equal(stopped.answer.disposition,'budget-stop');assert.equal(stopped.stopReason,'budget-turns');assert.equal(stopped.issues[0].code,'TLRAG1005');assert.equal(stopped.spend.calls,1);assert.deepEqual(stopped.citations,broken.citations);
    }finally{await f.db.close();}
});
it('a budget exhausted after an invalid answer prevents the repair wire and retains its first usage',async()=>{
    const f=await retrievalFixture();try{let calls=0;const engine=await testEngine(f,client(()=>{calls++;return {disposition:'answer',claims:[{id:'fact',text:'Unresolved.',citations:['invented']}]};},5),2);
        const record=lightragMust(await engine.answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(record.answer.disposition,'budget-stop');assert.equal(calls,1);assert.equal(record.spend.calls,2);assert.equal(record.spend.tokens,8);
    }finally{await f.db.close();}
});
it('an abstention has no citations and an injected record sink receives one immutable validated record',async()=>{
    const f=await retrievalFixture();try{const records:LightRagAnswerRecord[]=[],engine=await testEngine(f,client(()=>({disposition:'abstain',reason:'The evidence cannot establish that.',claims:[]})),8,record=>{records.push(record);assert.ok(Object.isFrozen(record));});
        const record=lightragMust(await engine.answer(f.control.query,{mode:'low',limits:f.control.limits}));assert.equal(record.stopReason,'abstain');assert.deepEqual(record.citations,[]);assert.deepEqual(records,[record]);assert.equal(renderLightRagAnswer(record),'The evidence cannot establish that.');
        const changed=structuredClone(record);changed.query='other';assert.equal((await validateLightRagAnswerRecord(changed)).valid,false);
        const {id:_,...body}=changed;changed.id=await lightragRevisionOf(body);assert.equal((await validateLightRagAnswerRecord(changed)).valid,false);
    }finally{await f.db.close();}
});
it('planning refuses a different account before work and cancellation retains completed planner spend',async()=>{
    const f=await retrievalFixture();try{let calls=0;const controller=new AbortController(),budget=createBudgetAccount({turns:4},()=>0),planner=createKeywordPlanner({artifact:lightRagPrompt('graph-planner'),budget,clock:()=>0,client:client(()=>{calls++;controller.abort(Error('Cancelled after planning.'));return {lowLevelKeywords:['Start'],highLevelKeywords:[]};})}),retrieve=createLightRagRetriever({store:f.graph,documents:f.documents,planner});
        const wrong=await retrieve(f.control.query,{mode:'low',budget:createBudgetAccount({turns:4},()=>0),embedder:f.embedder,clock:()=>0});assert.equal(wrong.valid,false);assert.equal(calls,0);if(!wrong.valid)assert.equal(wrong.issues[0].code,'TLRAG1002');
        const cancelled=await retrieve(f.control.query,{mode:'low',budget,embedder:f.embedder,clock:()=>0,signal:controller.signal});assert.equal(cancelled.valid,false);assert.equal(calls,1);assert.equal(cancelled.spend.calls,1);assert.equal(cancelled.spend.tokens,3);
    }finally{await f.db.close();}
});
it('a forged retrieval mode or spend is refused before the generation wire is called',async()=>{
    const f=await retrievalFixture();try{const original=await f.retrieve('low');let calls=0;
        for(const field of ['mode','spend']){
            const retrieval=structuredClone(original);
            if(field==='mode'){retrieval.plan.mode='hybrid';retrieval.plan.highLevelKeywords=['marker'];}
            else retrieval.spend.calls++;
            const engine=createLightRagEngine({retrieve:async()=>({valid:true,value:retrieval,spend:original.spend,attempts:1}),
                client:client(()=>{calls++;return {disposition:'abstain',reason:'No answer.',claims:[]};}),budget:createBudgetAccount({turns:8},()=>0),embedder:f.embedder,
                identities:{prompts:{},embedder:{model:f.embedder.model,dims:f.embedder.dims!},runIdentityId:null},clock:()=>0,now});
            const refused=await engine.answer(f.control.query,{mode:'low',limits:f.control.limits});assert.equal(refused.valid,false);assert.equal(calls,0,field);
            if(!refused.valid)assert.equal(refused.issues[0].code,'TLRAG1002');assert.deepEqual(refused.spend,original.spend);
        }
    }finally{await f.db.close();}
});
