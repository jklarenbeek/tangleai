import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createOutcomeService, type Evaluation } from '@tangleai/outcomes';
import { forecastMust,forecastQuery,forecastGet,forecastPromoteOrRetain,forecastOutcomeValue,visibleHarness } from '@tangleai/forecast';
import { outcomeFixture } from './outcome-fixture.ts';

it('success, refine and reject fixtures preserve the checked head, empty scope and archived question chains',async()=>{
  const f=await outcomeFixture({questionCount:6});
  try{
    const retros=forecastMust(await forecastQuery(f.store,'retrospectives'));
    assert.deepEqual(f.questions.slice(0,5).map(q=>retros.find(r=>r.questionId===q.question.id)!.outcome),['retained','promoted','ineligible','rejected','ineligible']);
    const civic=await f.questions[2].outcome.checked(),other=await f.questions[5].outcome.checked();assert.ok(civic);assert.equal(civic.head.revision,1);assert.equal(other,null);
    assert.equal(f.questions[2].question.startedFromCheckedVersionId,civic.versionId);assert.equal(f.questions[5].question.startedFromCheckedVersionId,null);
    const related=forecastMust(await forecastQuery(f.store,'checkpoints',{questionId:f.questions[2].question.id})).find(c=>c.ordinal===1)!;assert.equal(related.inputHarnessDigest,f.fixture.candidates[0].digest);
    const checked=forecastMust(await forecastGet(f.store,'harnesses',related.inputHarnessVersionId!))!;const foreign=visibleHarness(f.questions[5].question,checked);assert.ok(!foreign.ok);assert.equal(foreign.issues[0].code,'TFCT1003');
    const versions=forecastMust(await forecastQuery(f.store,'harnesses'));assert.equal(versions.filter(v=>v.status==='checked-ref').length,1);assert.equal(versions.filter(v=>v.status==='archived').length,9);assert.equal(versions.filter(v=>v.status==='provisional').length,2);
    for(const q of f.questions.slice(0,5))assert.equal(forecastMust(await forecastGet(f.store,'questions',q.question.id))!.latestProvisionalVersionId,null);
    for(const i of [2,4]){const r=retros.find(r=>r.questionId===f.questions[i].question.id)!;assert.equal(r.evaluation!.eligible,false);assert.match(JSON.stringify(r.issues),/Paired held-out utility did not strictly improve\./);const before=await f.questions[i].outcome.history();const replay=await forecastPromoteOrRetain(f.questions[i].outcome,r.id);assert.ok(replay.ok);assert.equal(replay.writes,0);assert.deepEqual(await f.questions[i].outcome.history(),before);}
    const held=f.questions[2].outcome;const registrations=(await held.history()).filter(r=>r.kind==='evaluationRegistration');assert.equal(registrations.length,2);const ids=registrations.flatMap(r=>r.cases.map(c=>c.id));assert.equal(new Set(ids).size,6);
    for(const registration of registrations){const retro=retros.find(r=>r.reflect?.versionId===registration.versionId)!;for(const c of registration.cases){const cp=forecastMust(await forecastGet(f.store,'checkpoints',c.id))!;assert.notEqual(cp.questionId,retro.questionId);assert.ok(cp.cutoffAt<c.source.observedAt);}}
  }finally{await f.db.close();}
});
it('a conflicting concurrent promotion loses with its exact outcome cause and cannot overwrite the winner',async()=>{
  const f=await outcomeFixture({questionCount:2,beforeResolution:true});
  try{
    // Materialize a checked candidate through the normal fixture on an isolated scope first.
    const q=f.questions[0],r=await f.begin(0);await f.score(r.id,0);
    const host=q.outcome,cp=forecastMust(await forecastQuery(f.store,'checkpoints',{questionId:q.question.id}))[0],score=forecastMust(await forecastGet(f.store,'resolutions',r.id))!.losses[0].scoreId;
    const at=f.now(),reflect=forecastOutcomeValue<{versionId:string}>(await host.service.reflect(host.command('race-reflect',{mode:'create',parentVersionId:null,scoreIds:[score],citations:[score],text:'Evaluate independently registered forecasting pairs.',payload:f.fixture.candidates[0].document,patch:[],configuration:{kind:'scripted',revision:host.adapter.identity.revision}},at)));
    const source=await host.source(r.id,null,cp.id);assert.ok(source);
    // A separate resolved question supplies independent case content and chronology.
    const q2=f.questions[1],r2=await f.begin(1);await f.score(r2.id,1);const other=forecastMust(await forecastQuery(f.store,'checkpoints',{questionId:q2.question.id}))[0],evidence=await host.source(r2.id,null,other.id);assert.ok(evidence);
    const decision=await host.inspect(other.decisionId!);assert.equal(decision.kind,'decision');if(decision.kind!=='decision')throw Error('decision');
    const bind={...host.host,store:(await import('@tangleai/store')).createOutcomeStore(f.db),evaluationSlot:async(slotId:string,versionId:string)=>({slotId,versionId,expectedHead:{versionId:null,revision:0},trainingScoreIds:[score],cases:[{id:other.id,domain:q.question.scopeKey,input:decision.input,source:evidence}],evaluatorRevision:host.adapter.identity.revision,gatePolicyId:host.service.gatePolicyId,maxPhysicalRequests:0,maxCost:null})};
    const a=await createOutcomeService(bind),b=await createOutcomeService(bind);const evaluated=forecastOutcomeValue<{evaluationId:string;eligible:boolean}>(await a.evaluate(host.command('race-evaluate',{versionId:reflect.versionId,slotId:'race'},at)));assert.equal(evaluated.eligible,true);
    const approve=async(service:typeof a,key:string)=>forecastOutcomeValue<{approvalId:string}>(await service.approve(host.command(key,{action:'promote',versionId:reflect.versionId,evaluationId:evaluated.evaluationId,expectedHead:{versionId:null,revision:0},reason:'Independent paired evidence.'},at)));
    const aa=await approve(a,'race-approve-a'),bb=await approve(b,'race-approve-b'),results=await Promise.all([a.promote(host.command('race-promote-a',aa,at)),b.promote(host.command('race-promote-b',bb,at))]);assert.equal(results.filter(r=>r.ok).length,1);
    const loser=results.find(r=>!r.ok)!;assert.throws(()=>forecastOutcomeValue(loser),e=>(e as any).code==='TFCT1011'&&(e as any).issues[0].cause[0].code==='OUTC1013');
    assert.deepEqual((await host.checked())!.payload,f.fixture.candidates[0].document);
  }finally{await f.db.close();}
});
