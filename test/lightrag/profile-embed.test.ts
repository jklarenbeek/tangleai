import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents';
import { createHashEmbedder } from '@tangleai/models';
import { createScriptedProfiler,createStructuredProfiler } from '../../packages/lightrag/src/profile.ts';
import { embedGraphText } from '../../packages/lightrag/src/embed.ts';
import { lightRagPrompt } from '../../packages/lightrag/src/catalog.ts';
import { graphClaim } from '../fixtures/lightrag-records.ts';
const modelIdentity={provider:'fixture',model:'scripted'},artifact=lightRagPrompt('graph-profiler');
it('profiles use the oldest bounded contexts while retaining the complete evidence basis and omission count',async()=>{
    const claims=[await graphClaim('Cedar',{ordinal:3}),await graphClaim('Cedar',{ordinal:1}),await graphClaim('Cedar',{ordinal:2})];
    const profiler=createScriptedProfiler(input=>{assert.deepEqual(input.contexts.map(row=>row.ordinal),[1,2]);return {profile:'Cedar has an evidenced civic role.',themes:[' Civic  Role ']};},{modelIdentity,promptRevision:artifact.revision,maxContexts:2});
    const result=await profiler({kind:'entity',name:'Cedar',claims});assert.equal(result.valid,true);
    if(result.valid){assert.deepEqual(result.value.basisClaimIds,claims.map(row=>row.id).sort());assert.equal(result.value.usedClaimIds.length,2);assert.deepEqual(result.value.omittedClaimIds,[claims[0].id]);assert.deepEqual(result.value.themes,['civic role']);}
});
it('a blank structured profile is repaired once and preserves every spent call',async()=>{
    let calls=0;const budget=createBudgetAccount({turns:3},()=>0),profiler=createStructuredProfiler({artifact,budget,clock:()=>0,client:{endpoint:modelIdentity,complete:async()=>{calls++;return {message:{content:'{"profile":" ","themes":[]}'},usage:{total_tokens:2}};}}});
    const result=await profiler({kind:'entity',name:'Cedar',claims:[await graphClaim('Cedar')]});assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1004');assert.equal(result.spend.calls,2);assert.equal(result.spend.tokens,4);}assert.equal(calls,2);
});
it('graph embedding fixes width from actual replies and records every separate batch',async()=>{
    const requests:string[][]=[],hash=createHashEmbedder({dims:8}),budget=createBudgetAccount({turns:10},()=>0);
    const embedder={model:hash.model,dims:undefined,embed:async(texts:string[])=>{requests.push(texts);return hash.embed(texts);}};
    const first=await embedGraphText({embedder,texts:['cedar','willow'],batchSize:1,budget,clock:()=>0});
    const second=await embedGraphText({embedder,texts:['equipment sharing'],budget,clock:()=>0});
    assert.equal(first.valid,true);assert.equal(second.valid,true);if(first.valid){assert.equal(first.value.embeddedBy.dims,8);assert.equal(first.spend.calls,2);}assert.deepEqual(requests,[['cedar'],['willow'],['equipment sharing']]);assert.equal(budget.spent().turns,3);
});
it('wrong-width, missing and nonfinite graph vectors refuse with their incurred spend',async()=>{
    for(const reply of [[new Float32Array([1])],[],[new Float32Array([NaN,0])]]){
        const result=await embedGraphText({embedder:{model:'fixture',dims:2,embed:async()=>reply},texts:['cedar'],budget:createBudgetAccount({turns:1},()=>0),clock:()=>0});
        assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'TLRAG1002');assert.equal(result.spend.calls,1);}
    }
});
