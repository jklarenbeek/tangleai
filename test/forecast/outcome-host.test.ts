import { it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeRevision } from '@tangleai/outcomes';
import { forecastMust,forecastGet,forecastQuery,forecastResolutionBegin,forecastPredictionsScore,forecastResolutionCorrect,sealForecastRecord,forecastDecisionRecord,FORECAST_TABLES,createMemoryForecastStore } from '@tangleai/forecast';
import { outcomeFixture } from './outcome-fixture.ts';

it('the resolver recomputes pinned evidence, refuses unknown or foreign addresses and grants no memory projection',async () => {
  const f = await outcomeFixture();
  try {
    const q = f.questions[0], r = forecastMust(await forecastQuery(f.store,'resolutions'))[0], cp = forecastMust(await forecastQuery(f.store,'checkpoints'))[0], source = (await q.outcome.source(r.id,cp.decisionId!))!;
    const {digest,...bytes} = source; assert.equal(digest,await outcomeRevision(bytes));
    assert.deepEqual(await q.outcome.host.resolver.resolve({sourceId:source.sourceId,digest},q.outcome.host.scope),source);
    assert.equal(await q.outcome.host.resolver.resolve({sourceId:source.sourceId,digest:'f'.repeat(64)},q.outcome.host.scope),undefined);
    assert.equal(await q.outcome.source('f'.repeat(64),cp.decisionId!),undefined);
    assert.equal(await q.outcome.source(r.id,'f'.repeat(64)),undefined);
    assert.equal(await q.outcome.host.resolver.resolve({sourceId:source.sourceId,digest},{...q.outcome.host.scope,domain:'other'}),undefined);
    assert.equal((await q.outcome.host.authorizeMemoryIds([],q.outcome.host.scope)).allowed,true);
    assert.equal((await q.outcome.host.authorizeMemoryIds(['x'],q.outcome.host.scope)).allowed,false);
    const decisionReplay = await forecastDecisionRecord(q.outcome,cp.id); assert.ok(decisionReplay.ok); assert.equal(decisionReplay.writes,0);
  } finally {await f.db.close();}
});
for (const memory of [false,true]) it('re-resolving the same outcome replays with zero writes; a conflicting fact refuses and an evidenced correction preserves scores ('+(memory?'memory':'SQLite')+')',async () => {
  const f=await outcomeFixture({...(memory?{store:createMemoryForecastStore()}:{} )});
  try {
    const q=f.questions[0],before=await Promise.all(FORECAST_TABLES.map(t=>forecastQuery(f.store,t))), outcomeBefore=await q.outcome.history();
    const repeated=await forecastResolutionBegin(q.outcome,q.input!);assert.ok(repeated.ok);assert.equal(repeated.writes,0);
    const scored=await forecastPredictionsScore(q.outcome,repeated.value.id);assert.ok(scored.ok);assert.equal(scored.writes,0);
    const conflict=await forecastResolutionBegin(q.outcome,{...q.input!,outcome:'reject'});assert.ok(!conflict.ok);assert.equal(conflict.issues[0].code,'TFCT1004');
    assert.deepEqual(await Promise.all(FORECAST_TABLES.map(t=>forecastQuery(f.store,t))),before);
    const {protocol: _protocol,scoringStatus: _scoring,...original}=repeated.value;
    const correction=await sealForecastRecord('resolutions',{...original,correctionOf:original.id,outcome:'reject',observedAt:'2025-01-30T00:00:00.000Z',receivedAt:'2025-01-30T00:00:00.000Z',losses:[],skipped:[]});
    const corrected=await forecastResolutionCorrect(f.store,{...correction,correctionOf:original.id});assert.ok(corrected.ok);const correctionReplay = await forecastResolutionCorrect(f.store,{...correction,correctionOf:original.id});assert.ok(correctionReplay.ok);assert.equal(correctionReplay.writes,0);
    assert.equal(forecastMust(await forecastGet(f.store,'questions',q.question.id))!.status,'disputed');
    assert.deepEqual(await q.outcome.history(),outcomeBefore);assert.deepEqual(forecastMust(await forecastGet(f.store,'resolutions',original.id)),repeated.value);
  }finally{await f.db.close();}
});
it('a checkpoint finalized after the observed outcome is a counted post-resolution skip',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{const q=f.questions[0],r=forecastMust(await forecastResolutionBegin(q.outcome,{...q.input!,observedAt:'2025-01-20T00:00:00.000Z'}));const scored=await f.score(r.id);assert.equal(scored.losses.length,2);assert.equal(scored.skipped.length,1);assert.equal(scored.skipped[0].reason,'post-resolution');assert.equal((await q.outcome.history()).filter(r=>r.kind==='score').length,2);}finally{await f.db.close();}
});
it('a crash after outcome scoring but before forecast publication resumes without duplicate outcome records',async()=>{
  let armed=false;const f=await outcomeFixture({beforeResolution:true,applyProbe:step=>{if(armed&&step==='put:forecast_resolutions'){armed=false;throw Error('stop before score receipt');}}});
  try{const r=await f.begin(),q=f.questions[0];armed=true;const stopped=await forecastPredictionsScore(q.outcome,r.id);assert.ok(!stopped.ok);const history=await q.outcome.history();assert.equal(history.filter(r=>r.kind==='score').length,3);const scored=await forecastPredictionsScore(q.outcome,r.id);assert.ok(scored.ok);assert.equal(scored.writes,1);assert.deepEqual(await q.outcome.history(),history);}finally{await f.db.close();}
});
