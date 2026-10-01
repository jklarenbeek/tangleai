import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents';
import { createScriptedExtractor,createStructuredExtractor } from '../../packages/lightrag/src/extract.ts';
import { lightRagPrompt } from '../../packages/lightrag/src/catalog.ts';
import { graphFixture,graphTestChunk,extractionReply } from './fixture.ts';
const artifact=lightRagPrompt('graph-extractor'),modelIdentity={provider:'fixture',model:'scripted'};
it('fixed extraction replies produce exactly the registered claims for every retained fixture chunk',async()=>{
    const fixture=await graphFixture();try{
        const extractor=createScriptedExtractor(fixture.replies,{promptRevision:artifact.revision,modelIdentity});let entities=0,relations=0;
        for(const chunk of await fixture.store.listChunks()){
            const result=await extractor(chunk),repeat=await extractor(chunk);assert.deepEqual(result,repeat);assert.equal(result.valid,true);if(!result.valid)continue;
            const expected=fixture.replies[chunk.id];assert.deepEqual(result.value.claims.entities.map(row=>({name:row.name,type:row.type,description:row.description})),expected.entities);
            assert.deepEqual(result.value.claims.relations.map(row=>({source:row.sourceName,target:row.targetName,description:row.description,themes:row.themes,strength:row.strength})),expected.relations.map(row=>({...row,themes:[...row.themes].sort()})));
            for(const claim of [...result.value.claims.entities,...result.value.claims.relations]){assert.equal(claim.chunkId,chunk.id);assert.equal(claim.versionId,chunk.versionId);assert.equal(claim.sourceId,chunk.sourceId);assert.deepEqual(claim.modelIdentity,modelIdentity);assert.equal(claim.promptRevision,artifact.revision);}
            entities+=result.value.claims.entities.length;relations+=result.value.claims.relations.length;assert.equal(result.spend.calls,0);
        }
        assert.deepEqual({entities,relations},{entities:62,relations:38});
    }finally{await fixture.close();}
});
it('a structured invalid reply is repaired once and retains both attempts and their spend',async()=>{
    let calls=0;const budget=createBudgetAccount({turns:10,tokens:10000},()=>0);
    const extractor=createStructuredExtractor({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:'{"entities":[]}'},usage:{total_tokens:2}};}}});
    const result=await extractor(graphTestChunk(),{gleaning:0});assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1004');assert.equal(result.attempts,2);assert.deepEqual(result.spend,{calls:2,tokens:4,ms:0});}
    assert.equal(calls,2);assert.equal(budget.spent().turns,2);
});
it('gleaning adds missed observations while exact repeats keep their original immutable claims',async()=>{
    let calls=0;const extra={...extractionReply,entities:[...extractionReply.entities,{name:'Register',type:'CONCEPT',description:'The equipment register.'}],relations:[{source:'Cedar',target:'Register',description:'Cedar funds the register.',themes:['funding'],strength:1}]};
    const extractor=createStructuredExtractor({artifact,budget:createBudgetAccount({turns:4},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async request=>{
        const input=JSON.parse(request.messages.at(-1).content.split('\n\nINPUT:\n')[1]);assert.equal(input.pass,calls);assert.equal(input.previous.entities.length,calls===0?0:1);
        return {message:{content:JSON.stringify(calls++===0?extractionReply:extra)},usage:{total_tokens:2}};
    }}});
    const result=await extractor(graphTestChunk());assert.equal(result.valid,true);
    if(result.valid){assert.equal(result.value.claims.entities.length,2);assert.equal(result.value.claims.relations.length,1);assert.deepEqual(result.value.claims.entities.map(row=>row.ordinal),[0,1]);assert.deepEqual(result.spend,{calls:2,tokens:4,ms:0});}
});
it('a missing relation endpoint passes through the shared repair gate and stays a content refusal',async()=>{
    let calls=0;const reply={...extractionReply,relations:[{source:'Cedar',target:'Unknown',description:'Unresolved endpoint.',themes:['funding'],strength:1}]};
    const extractor=createStructuredExtractor({artifact,budget:createBudgetAccount({turns:4},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:JSON.stringify(reply)}};}}});
    const result=await extractor(graphTestChunk(),{gleaning:0});assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'TLRAG1004');assert.equal(calls,2);
});
it('a budget stop between extraction and gleaning returns the incurred spend without another call',async()=>{
    let calls=0;const budget=createBudgetAccount({turns:1},()=>0);
    const extractor=createStructuredExtractor({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:JSON.stringify(extractionReply)},usage:{total_tokens:3}};}}});
    const result=await extractor(graphTestChunk());assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1005');assert.equal(result.stopReason,'budget-turns');assert.deepEqual(result.spend,{calls:1,tokens:3,ms:0});assert.equal(result.attempts,1);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);}
    assert.equal(calls,1);
});
it('concurrent extractors reserve the shared account before either provider resolves',async()=>{
    let calls=0;const budget=createBudgetAccount({turns:1},()=>0);
    const extractor=createStructuredExtractor({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;await Promise.resolve();return {message:{content:JSON.stringify(extractionReply)}};}}});
    const result=await Promise.all([extractor(graphTestChunk(),{gleaning:0}),extractor(graphTestChunk(),{gleaning:0})]);
    assert.equal(calls,1);assert.equal(result.filter(row=>row.valid).length,1);assert.equal(result.filter(row=>!row.valid&&row.issues[0].code==='TLRAG1005').length,1);
});
it('missing scripted chunks and explicitly malformed scripted replies remain named failures',async()=>{
    for(const [replies,expected]of [[{},'TLRAG1003'],[{chunk:null},'TLRAG1004']] as const){
        const extractor=createScriptedExtractor(replies,{promptRevision:artifact.revision,modelIdentity}),result=await extractor(graphTestChunk());
        assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,expected);
    }
});

it('malformed provider usage refuses after charging a finite fallback instead of poisoning the shared account',async()=>{
    for(const usage of [{total_tokens:NaN},{total_tokens:Infinity},{prompt_tokens:-1},{completion_tokens:0.5},{prompt_tokens:'3'},{prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:1},'invalid']){
        let calls=0;const budget=createBudgetAccount({turns:3,tokens:100000},()=>0);
        const extractor=createStructuredExtractor({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:JSON.stringify(extractionReply)},usage};}}});
        const result=await extractor(graphTestChunk(),{gleaning:0});assert.equal(result.valid,false);
        if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1010');assert.equal(result.spend.calls,1);assert.ok(Number.isSafeInteger(result.spend.tokens)&&result.spend.tokens>0);assert.equal(result.spend.tokens,budget.spent().tokens);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);}
        assert.equal(calls,1);assert.equal(budget.stop(),null);
    }
});
