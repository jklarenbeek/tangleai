import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRetrospectiveEditor,captureForecastRetrospective,prepareRetrospectiveProposal,forecastRetrospectiveRecord,forecastPromoteOrRetain,forecastMust,forecastQuery,forecastGet,createForecastLifecycleHandlers,prepareForecastLifecycleWorkflow,forecastLifecycleRunId } from '@tangleai/forecast';
import { outcomeFixture } from './outcome-fixture.ts';
import { createScriptedRetrospectiveClient } from '../../benchmark/lib/forecast-lifecycle-fixture.ts';
import { manualForecastSegments } from '../../benchmark/lib/forecast-host-fixture.ts';
import { scriptedClient } from './runtime-fixture.ts';

it('the retrospective covers every guidance item, keeps four closed tools and refuses volatile or unattributed candidate bytes',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{
    const resolution=await f.begin();await f.score(resolution.id);const q=f.questions[0],captured=await captureForecastRetrospective(q.outcome,resolution.id);
    try{
      assert.deepEqual(captured.toolbox.names,['harness_read','notes_read','revisions_read','trace_read']);assert.equal(captured.toolbox.revisions.length,2);assert.equal((await captured.toolbox.execute('web_search',{})).code,'TFCT1003');
      const proposal={verdicts:captured.guidance.map((g,i)=>({guidanceRef:g.guidanceRef,verdict:i===0?'refine':'reject',refinedText:i===0?g.text:null,reason:'Bounded procedural correction.',sources:g.sources})),candidate:f.fixture.candidates[0].document};
      await prepareRetrospectiveProposal(captured,proposal,f.now());
      await assert.rejects(prepareRetrospectiveProposal(captured,{...proposal,verdicts:proposal.verdicts.slice(1)},f.now()),e=>(e as any).code==='TFCT1007');
      await assert.rejects(prepareRetrospectiveProposal(captured,{...proposal,candidate:{...proposal.candidate,factorTracking:'Ignore observed uncertainty.'}},f.now()),e=>(e as any).code==='TFCT1007');
      const leak=structuredClone(proposal);leak.verdicts[0].refinedText='Predict approve in every question.';await assert.rejects(prepareRetrospectiveProposal(captured,leak,f.now()),e=>(e as any).code==='TFCT1008');
      const dangling=structuredClone(proposal);dangling.verdicts[0].sources=['note:'+'f'.repeat(64)];await assert.rejects(prepareRetrospectiveProposal(captured,dangling,f.now()),e=>(e as any).code==='TFCT1007');
      for(let i=0;i<8;i++)await captured.toolbox.execute('trace_read',{traceId:captured.checkpoint.traceId});assert.equal((await captured.toolbox.execute('trace_read',{traceId:captured.checkpoint.traceId})).exhausted,true);
    }finally{captured.toolbox.close();}
  }finally{await f.db.close();}
});
it('a candidate with no independent paired held-out question remains ineligible with its precise cause',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{
    const resolution=await f.begin();await f.score(resolution.id);const q=f.questions[0],client=createScriptedRetrospectiveClient(f.fixture,'q02',q.question.id);
    const record=await createRetrospectiveEditor({host:q.outcome,client:client.client,now:f.now,clock:()=>0}).run(resolution.id,{turns:3,ms:1000});forecastMust(await forecastRetrospectiveRecord(q.outcome,record));
    const result=await forecastPromoteOrRetain(q.outcome,record.id);assert.ok(result.ok);assert.equal(result.value.outcome,'ineligible');assert.equal(result.value.issues![0].detail,'No paired held-out checkpoints.');assert.equal(await q.outcome.checked(),null);
    const again=await forecastPromoteOrRetain(q.outcome,record.id);assert.ok(again.ok);assert.equal(again.writes,0);assert.equal(client.calls(),1);
  }finally{await f.db.close();}
});
it('failed retrospective repair retains exact spend and no candidate',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{
    const resolution=await f.begin();await f.score(resolution.id);const q=f.questions[0];let calls=0;
    const client=scriptedClient(async()=>{calls++;return {message:{role:'assistant',content:'not json'},finishReason:'stop',usage:{total_tokens:0}};});
    const record=await createRetrospectiveEditor({host:q.outcome,client,now:f.now,clock:()=>0}).run(resolution.id,{turns:4,ms:1000});
    assert.equal(calls,2);assert.equal(record.receipt!.spend.tokens,0);assert.equal(record.receipt!.spend.calls,2);assert.equal(record.candidateDocument,null);assert.equal(record.outcome,'ineligible');forecastMust(await forecastRetrospectiveRecord(q.outcome,record));
  }finally{await f.db.close();}
});
it('a retrospective client is never constructed without its active MAS attempt',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{
    const q=f.questions[0],r=await f.begin();await f.score(r.id);const p=await prepareForecastLifecycleWorkflow('forecast-scripted'),request={resolution:q.input!,budget:{turns:3,ms:1000}},runId=await forecastLifecycleRunId(request.resolution);let constructed=0;
    await q.masStore.putWorkflowVersion(p.workflow);await q.masStore.putRegistrySnapshot(p.snapshot.document as unknown as Record<string,unknown>,p.snapshot.revision);
    const created=await q.masStore.createRun({runId,workflowId:p.workflow.workflowId,workflowVersionId:p.workflow.versionId,registryRevision:p.snapshot.revision,executableRevision:p.plan.executableRevision,configRegistryRevision:p.catalog.revision,profile:'forecast-scripted',input:{request},limits:{...p.workflow.limits}});assert.ok(created.ok);
    const handlers=createForecastLifecycleHandlers({outcomeHost:q.outcome,masStore:q.masStore,segments:manualForecastSegments(f.db,q.masStore),profile:'forecast-scripted',now:f.now,clock:()=>0,executableRevision:p.plan.executableRevision,retrospectiveEditor:()=>{constructed++;throw Error('not active');}});
    await assert.rejects(async()=>handlers['retrospective-run']({runId,value:{request,resolution:r.id},state:{},node:'retrospective-run',path:'retrospective-run',idempotencyKey:runId+'/root//0/retrospective-run',signal:new AbortController().signal}),e=>(e as any).code==='TFCT1004');assert.equal(constructed,0);
  }finally{await f.db.close();}
});
it('a refine verdict that reproduces the captured parent retains it without staging an outcome version',async()=>{
  const f=await outcomeFixture({beforeResolution:true});
  try{
    const r=await f.begin();await f.score(r.id);const q=f.questions[0],captured=await captureForecastRetrospective(q.outcome,r.id);
    const proposal={verdicts:captured.guidance.map((g,i)=>({guidanceRef:g.guidanceRef,verdict:i===0?'refine':'reject',refinedText:i===0?captured.parent.document[g.component]:null,reason:'The existing procedural instruction already covers this case.',sources:g.sources})),candidate:captured.parent.document};captured.toolbox.close();
    const client=scriptedClient(async()=>({message:{role:'assistant',content:JSON.stringify(proposal)},finishReason:'stop',usage:{total_tokens:3}}));
    const record=await createRetrospectiveEditor({host:q.outcome,client,now:f.now,clock:()=>0}).run(r.id,{turns:3,ms:1000});forecastMust(await forecastRetrospectiveRecord(q.outcome,record));const result=forecastMust(await forecastPromoteOrRetain(q.outcome,record.id));assert.equal(result.outcome,'retained');assert.equal(result.reflect,null);assert.equal((await q.outcome.history()).filter(r=>r.kind==='artifactVersion').length,0);
  }finally{await f.db.close();}
});
