import {it} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBudgetAccount} from '@tangleai/agents';
import {createKeywordPlanner,createScriptedPlanner,validateLightRagQueryPlan,lightRagPrompt,LIGHTRAG_LIMITS,lightragMust} from '@tangleai/lightrag';
const artifact=lightRagPrompt('graph-planner'),modelIdentity={provider:'fixture',model:'scripted'};
it('scripted keywords fold and cap deterministically while the mode and every override remain explicit',async()=>{
    const planner=createScriptedPlanner([{text:'Which depot?',lowKeywords:[' Ｃｅｄａｒ ','CEDAR','Willow'],highKeywords:[' Equipment  Sharing ','REGISTRY']}]);
    const result=await planner('Which depot?',{mode:'hybrid',limits:{keywordsPerLevel:1,contextTokens:64}});assert.equal(result.valid,true);
    if(result.valid){assert.deepEqual(result.value.lowLevelKeywords,['cedar']);assert.deepEqual(result.value.highLevelKeywords,['equipment sharing']);assert.deepEqual(result.value.limits,{...LIGHTRAG_LIMITS,keywordsPerLevel:1,contextTokens:64});assert.equal(result.value.spend.calls,0);assert.equal(result.value.promptRevision,artifact.revision);}
    const missing=await planner('An unregistered question',{mode:'low'});assert.equal(missing.valid,false);if(!missing.valid)assert.equal(missing.issues[0].code,'TLRAG1008');
});
it('the registered empty level and every required-mode variant refuse without a whole-query fallback',async()=>{
    const fixture=JSON.parse(await readFile(new URL('../fixtures/lightrag/empty-required-level.json',import.meta.url),'utf8'));
    const planner=createScriptedPlanner(()=>({lowLevelKeywords:fixture.lowLevelKeywords,highLevelKeywords:fixture.highLevelKeywords}));
    for(const mode of ['high','hybrid','hybrid-no-original']as const){const result=await planner('Question',{mode});assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,fixture.expectedCode);assert.equal(result.spend.calls,0);}}
    assert.equal((await planner('Question',{mode:'low'})).valid,true);
    const low=createScriptedPlanner(()=>({lowLevelKeywords:[' '],highLevelKeywords:['theme']}));assert.equal((await low('Question',{mode:'low'})).valid,false);
});
it('structured keyword repair spends exactly its two calls and preserves query data',async()=>{
    let calls=0;const budget=createBudgetAccount({turns:3,tokens:1000},()=>0),query='Literal {{query}} asks about Cedar.';
    const planner=createKeywordPlanner({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async request=>{calls++;assert.ok(JSON.stringify(request.messages).includes(query));return {message:{content:JSON.stringify(calls===1?{lowLevelKeywords:[],highLevelKeywords:[]}:{lowLevelKeywords:['Cedar'],highLevelKeywords:['equipment']})},usage:{total_tokens:3}};}}});
    const result=await planner(query,{mode:'hybrid'});assert.equal(result.valid,true);assert.equal(calls,2);assert.equal(budget.spent().turns,2);if(result.valid){assert.equal(result.value.spend.calls,2);assert.equal(result.value.spend.tokens,6);assert.deepEqual(result.spend,result.value.spend);}
});
it('an empty required structured level after one repair is a counted retrieval refusal',async()=>{
    let calls=0;const planner=createKeywordPlanner({artifact,budget:createBudgetAccount({turns:3,tokens:1000},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:'{"lowLevelKeywords":["Cedar"],"highLevelKeywords":[]}'},usage:{total_tokens:2}};}}});
    const result=await planner('Question',{mode:'high'});assert.equal(result.valid,false);assert.equal(calls,2);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1008');assert.equal(result.attempts,2);assert.equal(result.spend.calls,2);assert.equal(result.spend.tokens,4);}
});
it('the shared budget refuses a second planning request before reaching the provider',async()=>{
    let calls=0;const planner=createKeywordPlanner({artifact,budget:createBudgetAccount({turns:1},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:'{"lowLevelKeywords":[],"highLevelKeywords":[]}'}};}}});
    const result=await planner('Question',{mode:'low'});assert.equal(result.valid,false);assert.equal(calls,1);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1005');assert.equal(result.spend.calls,1);}
});
it('malformed keyword content has its own bounded refusal and is never silently narrowed',async()=>{
    const planner=createKeywordPlanner({artifact,budget:createBudgetAccount({turns:3},()=>0),clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>({message:{content:'{"lowLevelKeywords":["Cedar"],"highLevelKeywords":["equipment"],"invented":true}'}})}});
    const result=await planner('Question',{mode:'hybrid'});assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1004');assert.equal(result.spend.calls,2);}
});
it('query plans cannot forge their normalized keywords, required levels or recorded bounds',async()=>{
    const plan=lightragMust(await createScriptedPlanner(()=>({lowLevelKeywords:['Cedar'],highLevelKeywords:['equipment']}))('Question',{mode:'hybrid'}));
    for(const changed of [{...plan,lowLevelKeywords:['CEDAR']},{...plan,highLevelKeywords:[]},{...plan,limits:{...plan.limits,keywordsPerLevel:33}},{...plan,limits:{...plan.limits,contextTokens:-1}},{...plan,invented:true}])assert.equal(validateLightRagQueryPlan(changed).valid,false);
});
