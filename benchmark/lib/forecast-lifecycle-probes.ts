/** Lifecycle probes execute independent scorers and negative chronology through public boundaries. */
import { openTangleDb,createForecastStore } from '@tangleai/store';
import { createForecastHarnessAdapter,forecastQuery,forecastMust } from '@tangleai/forecast';
import { fixtureForecastHost,type ForecastScriptCounter } from './forecast-host-fixture.ts';
import { fixtureForecastOutcome,fixtureForecastResolution } from './forecast-lifecycle-fixture.ts';
import { measureForecastLifecycleResume } from './forecast-lifecycle-resume.ts';
import { scoreForecast } from './forecast-oracle.ts';
import type { ForecastFixtures } from './forecast-fixtures.ts';
import type { measureEvolvingForecast } from './forecast-evolving.ts';
import type { Probe } from './forecast.types.ts';

export async function measureForecastChronologyRefusals(fixture:ForecastFixtures) {
  const db=await openTangleDb({jobs:{}}),store=createForecastStore(db),counters:ForecastScriptCounter[]=[];let instant=fixture.questions[0].issuedAt;
  try{
    const retrospectives=[];
    for(const [questionIndex,registered] of fixture.questions.slice(0,2).entries()){
      instant=registered.issuedAt;const host=await fixtureForecastOutcome({db,store,fixture,scopeKey:registered.scopeKey,instant:()=>instant});
      const f=await fixtureForecastHost({db,fixture,questionIndex,forecastStore:store,counters,evolving:true,instant:()=>instant,outcomeHost:()=>host,outcomeAdmission:host});
      for(const cp of registered.checkpoints){instant=cp.scheduledAt;const tick=await f.host.tick(instant);if(tick.failed.length||tick.refused.length)throw Error('Chronology control failed before resolution.');}
      const fact=fixture.resolutions[questionIndex];instant=fact.observedAt;
      const evidence=fact.evidence.map(id=>{const s=fixture.snapshots.find(s=>s.id===id)!;return{address:{corpus:fixture.manifest.registrationId,snapshotId:id},sha256:s.sha256,excerpt:s.excerpt};});
      const done=await fixtureForecastResolution({db,fixture,host,masStore:f.masStore,question:f.question,registeredId:registered.id,instant:()=>instant,counters,resolutionInput:{questionId:f.question.id,outcome:fact.outcome,receivedAt:fact.observedAt,observedAt:questionIndex===0?registered.checkpoints[0].cutoffAt:fact.observedAt,evidence}});
      retrospectives.push(done!.retrospective);
    }
    const resolutions=forecastMust(await forecastQuery(store,'resolutions')),skips=resolutions.flatMap(r=>r.skipped).filter(c=>c.reason==='post-resolution').length;
    return {skips,scored:resolutions.reduce((n,r)=>n+r.losses.length,0),forwardRefused:retrospectives[1].outcome==='ineligible'&&retrospectives[1].issues?.some(i=>i.code==='TFCT1011'&&i.detail==='Held-out checkpoints must precede their source observation.')===true,physicalRequests:counters.reduce((n,c)=>n+c.physicalCalls(),0)};
  }finally{await db.close();}
}
export async function forecastLifecycleProbes(fixture:ForecastFixtures,measured:Awaited<ReturnType<typeof measureEvolvingForecast>>):Promise<Probe[]> {
  const probes:Probe[]=[],add=(id:string,holds:boolean,detail:string)=>{if(!holds)throw Error('Forecast lifecycle probe failed: '+id);probes.push({id,holds:true,detail});};
  const adapter=await createForecastHarnessAdapter();let comparisons=0;
  for(const q of fixture.questions){const resolution=fixture.resolutions.find(r=>r.questionId===q.id);if(!resolution)continue;for(const cp of q.checkpoints)for(const [index,payload] of [fixture.seed,...fixture.candidates.map(c=>c.document)].entries()){
    const digest=[fixture.manifest.seedHarnessDigest,...fixture.manifest.candidateDigests][index],answer=fixture.predictions[cp.id][digest];
    const input={questionId:'a'.repeat(64),checkpointId:'b'.repeat(64),ordinal:cp.ordinal,cutoffAt:cp.cutoffAt,adapter:{...q.adapter,version:'1'},usedHarnessDigest:digest,predictions:{[digest]:answer}};
    const actual=adapter.score(await adapter.interpret(input,{...payload}),{outcome:resolution.outcome}),expected=scoreForecast(q.adapter,answer,resolution.outcome);
    if(actual.outcome!==expected.category)throw Error('Forecast adapter score differs from independent oracle.');comparisons++;
  }}
  add('adapter-score-parity',comparisons===45,`${comparisons} choice/numeric candidate predictions reproduce the independent fixture scorer; the total digest miss remains a failure.`);
  const events=measured.lifecycle.records.outcomes.filter(r=>r.kind==='activationEvent'),retros=measured.lifecycle.records.retrospectives;
  add('promotion-fencing',events.length===1&&events.every(e=>e.nextHead.revision===e.previousHead.revision+1&&retros.some(r=>r.promotion?.activationEventId===e.id&&r.evaluation?.eligible))&&measured.lifecycle.checkedHeads[1].versionId===null,'One checked activation advances its captured parent by one; the losing release-date scope has no eligible candidate and no head. Concurrency is separately exercised by two service hosts.');
  const related=measured.retained.find(r=>r.fixtureCheckpointId===fixture.questions[2].checkpoints[0].id),unrelated=measured.retained.find(r=>r.fixtureCheckpointId===fixture.questions[5].checkpoints[0].id);
  add('checked-scope-transfer',related.question.startedFromCheckedVersionId===measured.lifecycle.checkedHeads[0].versionId&&related.harness.status==='checked-ref'&&unrelated.question.startedFromCheckedVersionId===null&&unrelated.harness.provenance.seed,'The next related question uses the independently promoted head; an unrelated scope starts from its seed.');
  const controls=await measureForecastChronologyRefusals(fixture);
  add('post-resolution-skip',controls.skips===2&&controls.scored===4&&controls.physicalRequests===0,'A separate early-observation control scores four checkpoints and retains two post-resolution skips without resolving those late decisions.');
  const registrations=measured.lifecycle.records.outcomes.filter(r=>r.kind==='evaluationRegistration'),pairs=registrations.flatMap(r=>r.cases);
  add('held-out-forward-only',controls.forwardRefused&&pairs.every(c=>((c.input as Record<string,unknown>).cutoffAt as string)<c.source.observedAt)&&new Set(pairs.map(c=>c.id)).size===pairs.length,`${pairs.length} disjoint forward-only paired cases exclude their training question. An equal-cutoff observation is refused before evaluation; consumed pairs are not reused.`);
  const recovery=await measureForecastLifecycleResume();
  add('lifecycle-resume-identity',recovery.stages.length===8&&recovery.stages.every(s=>s.stops===1&&s.extraCalls===0&&s.artifactDigest===recovery.artifactDigest),`Eight committed forecast/MAS boundaries reopen SQLite with identical artifact digest ${recovery.artifactDigest}; ${recovery.logicalCalls} logical calls, zero extra purchases, ${recovery.physicalCalls} physical requests and ${recovery.duplicates} duplicate deliveries.`);
  return probes;
}
