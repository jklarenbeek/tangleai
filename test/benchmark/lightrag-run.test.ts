import {it} from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSha256} from '@jarenjs/json/canonical';
import {createHashEmbedder} from '@tangleai/models/embed';
import type {LightRagChatClient} from '@tangleai/lightrag';
import {readAiEnv} from '../../benchmark/lib/ai-env.ts';
import {planLightRagLive,lightRagAuthorization,lightRagNotRun,executeLightRagLive,validateLightRagLive,pairLightRagRows,createLightRagFetchGuard} from '../../benchmark/lib/lightrag-run.ts';
import {planLightRagJudge,lightRagJudgeNotRun,executeLightRagJudge,validateLightRagJudge} from '../../benchmark/lib/lightrag-judge.ts';
import {planLightRagParity} from '../../benchmark/lib/lightrag-parity.ts';
const environment=(calls=200)=>readAiEnv({OPENROUTER_AI_KEY:'fixture-only-not-a-credential',TANGLE_AI_MODEL:'z-ai/glm-5.3-flash',TANGLE_AI_EMBEDDING_MODEL:'baai/bge-m3',TANGLE_AI_MAX_CALLS:String(calls)});
const env=environment(1000000); // An injected test environment, never a workspace guard change.
const embedder={...createHashEmbedder({dims:1024}),model:'baai/bge-m3'};
function fakeClient(failGeneration=false){let calls=0;const client:LightRagChatClient={endpoint:{provider:env.provider,model:env.model},complete:async request=>{
    calls++;const message=String(request.messages.at(-1).content);let reply:unknown;
    if(message.includes('\n\nINPUT:\n')){
        const input=JSON.parse(message.split('\n\nINPUT:\n')[1]);
        if(input.chunk)reply={entities:[{name:'Entity '+input.chunk.sourceId,type:'TECHNOLOGY',description:input.chunk.text.slice(0,500)}],relations:[],contentKeywords:['protocol']};
        else if(input.contexts)reply={profile:input.contexts.map((row:{description:string})=>row.description).join(' '),themes:[]};
        else if(input.query)reply={lowLevelKeywords:['relay'],highLevelKeywords:['protocol']};
        else throw Error('Unexpected graph role in fake client.');
    }else{if(failGeneration)throw Error('Fixture generation failure.');reply={disposition:'abstain',reason:'The scripted test makes no factual claim.',claims:[]};}
    return {message:{content:JSON.stringify(reply)},usage:{total_tokens:3,prompt_tokens:2,completion_tokens:1}};
}};return {client,calls:()=>calls};}
it('freezes credential-free row counts, refuses conservative bounds and authorizes a flat row separately',async()=>{
    let requests=0;const original=globalThis.fetch;globalThis.fetch=async()=>{requests++;throw Error('No planning network.');};
    try{
        const full=await planLightRagLive({env:environment()}),repeat=await planLightRagLive({env:environment()});assert.deepEqual(full.plan,repeat.plan);assert.equal(full.plan.runnable,false);assert.ok(full.plan.maxRequests>200);assert.equal(full.plan.indexing.extraction,16);assert.equal(full.plan.rowCalls[0].answers,16);assert.equal(full.plan.corpus.chunks,9);assert.equal(full.plan.corpus.activeChunks,8);
        assert.ok(!JSON.stringify(full.plan).includes('fixture-only-not-a-credential'));assert.equal(lightRagAuthorization(full.plan),'dry-run');assert.equal(lightRagAuthorization(full.plan,full.plan.planId),'refused');assert.equal((await lightRagNotRun(full)).physicalRequests,0);
        const flat=await planLightRagLive({env:environment(),rows:['flat-grounded']});assert.equal(flat.plan.runnable,true);assert.equal(flat.plan.maxRequests,57);assert.equal(lightRagAuthorization(flat.plan,'incorrect'),'refused');assert.equal(lightRagAuthorization(flat.plan,flat.plan.planId),'execute');assert.equal(requests,0);
    }finally{globalThis.fetch=original;}
});
it('refuses mismatched authorization and changed execution wires before the first logical request',async()=>{
    const context=await planLightRagLive({env,rows:['flat-grounded']}),wire=fakeClient();const common={env,client:wire.client,embedder,tier:'scripted' as const,physicalRequests:()=>0,timer:()=>0};
    await assert.rejects(()=>executeLightRagLive(context,{...common,authorize:'incorrect'}),/authorization/);assert.equal(wire.calls(),0);
    await assert.rejects(()=>executeLightRagLive(context,{...common,authorize:context.plan.planId,client:{...wire.client,endpoint:{...wire.client.endpoint,model:'changed'}}}),/wire or source changed/);assert.equal(wire.calls(),0);
});
it('executes all five graph ablations with the real engine, persists every question and recomputes paired arithmetic',async()=>{
    const context=await planLightRagLive({env}),wire=fakeClient(),report=await executeLightRagLive(context,{authorize:context.plan.planId,env,client:wire.client,embedder,tier:'scripted',physicalRequests:()=>0,timer:()=>0,now:()=> '2026-06-01T00:00:00.000Z'});
    assert.equal(report.tier,'scripted');assert.equal(report.physicalRequests,0);assert.equal(report.rows.length,5);assert.equal(report.indexing.completedSources,8);assert.equal(report.indexing.failedSources,0);assert.ok(wire.calls()>80);
    for(const row of report.rows){assert.equal(row.attempts.length,16);assert.equal(row.summary.questions.answered,16);assert.equal(row.summary.claims!.tp,0);assert.equal(row.summary.claims!.fn,24);assert.equal(row.summary.abstention!.accuracy,0.125);assert.deepEqual(row.attempts.map(attempt=>attempt.questionId),context.plan.questionIds);}
    assert.equal(report.controlDrift!.reportId,context.handoff.handoff.identities.reportId);assert.ok(report.controlDrift!.changed>0);assert.equal(report.pairing.eligible,true);assert.deepEqual(report.pairing.comparisons[0].interval,{low:0,high:0});assert.equal(report.decision.state,'keep-experimental');assert.equal(report.decision.defaultChanged,false);
    const positive=structuredClone(report.rows);for(const attempt of positive.find(row=>row.key==='lightrag-hybrid')!.attempts)if(attempt.claims!.f1!==null)attempt.claims!.f1=1;
    const pair=pairLightRagRows(positive);assert.equal(pair.comparisons[0].pairs,14);assert.equal(pair.comparisons[0].mean,1);assert.deepEqual(pair.comparisons[0].interval,{low:1,high:1});
    for(const mutate of [(value:typeof report)=>{value.rows[0].summary.claims!.tp++;},(value:typeof report)=>{value.pairing.comparisons[0].mean=1;},(value:typeof report)=>{value.rows[0].summary.latency!.p95Ms=99;},(value:typeof report)=>{value.rows[0].attempts[0].rendered='An invented retained answer.';},(value:typeof report)=>{value.controlDrift!.fields[0].actual='invented control';}]){const forged=structuredClone(report);mutate(forged);const {reportId:_,...body}=forged;forged.reportId=await canonicalSha256(body);await assert.rejects(()=>validateLightRagLive(forged));}
});
it('retains replayed and physical work separately in complete, mixed and fresh wire receipts',async()=>{
    const context=await planLightRagLive({env,rows:['flat-grounded']});
    for(const tier of ['replayed','mixed','paid'] as const){
        let physical=0,completions=0;const wire=fakeClient();
        const client:LightRagChatClient={...wire.client,complete:async request=>{
            const result=await wire.client.complete(request),replayed=tier==='replayed'||tier==='mixed'&&completions<8;completions++;
            if(replayed)return {...result,replayed:{ms:2}};
            physical++;return result;
        }};
        const countedEmbedder={...embedder,embed:async(texts:string[])=>{if(tier!=='replayed')physical++;return embedder.embed(texts);}};
        const report=await executeLightRagLive(context,{authorize:context.plan.planId,env,client,embedder:countedEmbedder,tier:'paid',physicalRequests:()=>physical,timer:()=>0});
        assert.equal(report.tier,tier);assert.equal(report.rows[0].tier,tier);assert.equal(report.logicalSpend.calls,41);
        assert.equal(report.physicalRequests,tier==='replayed'?0:tier==='mixed'?33:41);
        assert.equal(report.rows[0].summary.cost!.replayed,tier==='replayed'?16:tier==='mixed'?8:0);
        assert.equal(report.indexing.physicalRequests,tier==='replayed'?0:9);
        assert.equal(report.decision.defaultChanged,false);
        const forged=structuredClone(report);forged.rows[0].tier=tier==='paid'?'replayed':'paid';const {reportId:_,...body}=forged;forged.reportId=await canonicalSha256(body);
        await assert.rejects(()=>validateLightRagLive(forged),/aggregate|replay/);
    }
});
it('dead generation wires remain charged failures and cannot masquerade as correct abstentions',async()=>{
    const context=await planLightRagLive({env,rows:['flat-grounded']}),wire=fakeClient(true),report=await executeLightRagLive(context,{authorize:context.plan.planId,env,client:wire.client,embedder,tier:'scripted',physicalRequests:()=>0,timer:()=>0});
    const row=report.rows[0];assert.equal(row.summary.questions.answered,0);assert.equal(row.summary.questions.unanswered.wire,16);assert.equal(row.summary.claims!.fn,24);assert.equal(row.summary.abstention!.correct,0);assert.equal(row.summary.cost!.turns,16);assert.ok(row.summary.cost!.tokens>0);assert.equal(report.pairing.eligible,false);assert.equal(report.logicalSpend.calls,41);
});
it('the physical ceiling reserves before concurrent requests and counts unsuccessful transport calls',async()=>{
    let calls=0;const guard=createLightRagFetchGuard(2,async()=>{calls++;await Promise.resolve();throw Error('wire failure');});
    const outcomes=await Promise.allSettled([0,1,2].map(async()=>guard.fetch('https://provider.example')));assert.equal(calls,2);assert.equal(guard.requests(),2);assert.equal(outcomes.filter(row=>row.status==='rejected').length,3);
});
it('the judge requires its own exact plan and preserves answer order bias as counted disagreement',async()=>{
    const context=await planLightRagLive({env,rows:['flat-grounded','lightrag-hybrid']}),wire=fakeClient(),report=await executeLightRagLive(context,{authorize:context.plan.planId,env,client:wire.client,embedder,tier:'scripted',physicalRequests:()=>0,timer:()=>0});
    const plan=await planLightRagJudge({env,report,comparisons:['lightrag-hybrid']});assert.equal(plan.maxRequests,32);assert.equal(plan.runnable,true);assert.equal((await lightRagJudgeNotRun(plan)).physicalRequests,0);
    let calls=0;const client:LightRagChatClient={endpoint:{provider:plan.provider,model:plan.model},complete:async request=>{calls++;assert.ok(JSON.parse(request.messages.at(-1).content).question);return {message:{content:JSON.stringify(Object.fromEntries(plan.dimensions.map(key=>[key,{winner:'A',reason:'The deliberately position-biased fixture always chooses A.'}])))},usage:{total_tokens:4}};}};
    const options={plan,env,report,client,tier:'scripted' as const,physicalRequests:()=>0,timer:()=>0};await assert.rejects(()=>executeLightRagJudge({...options,authorize:report.plan.planId}),/authorization/);assert.equal(calls,0);
    const judged=await executeLightRagJudge({...options,authorize:plan.planId});assert.equal(calls,32);assert.equal(judged.pairs.length,16);assert.equal(judged.disagreements,64);assert.equal(judged.failedOrders,0);assert.equal(judged.spend.calls,32);assert.equal(judged.spend.tokens,128);assert.equal(judged.defaultInput,false);assert.deepEqual(judged.pairs[0].orders.map(order=>order.winners!.overall),['flat-grounded','lightrag-hybrid']);
    const forged=structuredClone(judged);forged.pairs[0].orders[1].winners!.overall='flat-grounded';const {reportId:_,...body}=forged;forged.reportId=await canonicalSha256(body);await assert.rejects(()=>validateLightRagJudge(forged),/order|winner|disagreement/);
    const missing=await planLightRagJudge({env,report:null});assert.equal(missing.runnable,false);assert.equal(missing.maxRequests,128);
});
it('the paper corpus stays explicitly unrun without a separately licensed dataset and approval',async()=>{
    const first=await planLightRagParity(),second=await planLightRagParity();assert.deepEqual(first,second);assert.equal(first.status,'not-run');assert.equal(first.physicalRequests,0);assert.equal(first.paperComparison,false);assert.equal(first.protocol.questionsPerSubset,125);assert.deepEqual(first.protocol.subsets,['Agriculture','CS','Legal','Mix']);
    await assert.rejects(()=>planLightRagParity({authorize:'incorrect'}),/authorization/);
});
