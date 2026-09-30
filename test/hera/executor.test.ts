import {it} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MasInfrastructureCrash} from '@tangleai/mas';
import {createHeraExecutor} from '@tangleai/hera';
import {validateClaimEvidence} from '@tangleai/context';
import {heraValue} from '../../examples/hera.ts';
import {executorFixture} from './executor-fixture.ts';
it('parallel retrievers overlap under the deferred gate and use distinct sub-queries',async()=>{
  const f=await executorFixture({overlap:true});try{
    const result=heraValue(await f.runtime.executor.execute(f.runtime.request));assert.equal(result.trajectory.status,'completed');
    assert.ok(f.counters().maxActive>=2);assert.equal(result.steps.filter(s=>s.agentId==='retriever').length,2);
    assert.equal(result.trajectory.calls,f.counters().calls);assert.equal(result.trajectory.calls,14);
    assert.equal(result.trajectory.tokens.prompt,98);assert.equal(result.trajectory.tokens.completion,42);
    assert.equal(result.trajectory.tokens.unknownRequests,0);assert.equal(result.trajectory.primaryScore,1);assert.equal(result.trajectory.metrics.evaluator?.answerExact,1);
    assert.equal(f.runtime.store.counters().learningWrites,f.runtime.initialWrites);
    const queries=f.requests.filter(r=>r.node.startsWith('retrieve')&&r.phase==='completion').map(r=>JSON.stringify(r.request));
    assert.ok(queries.some(q=>q.includes('Who directed Lumen?')));assert.ok(queries.some(q=>q.includes('Where did Ivo study?')));
    assert.ok(result.steps.every(s=>s.evidenceAddresses.includes(f.units[0].address)));
  }finally{await f.close();}
});
it('replaying a completed key spends zero calls after reopening SQLite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-executor-'));const f=await executorFixture({path:join(dir,'state.sqlite')});
  try{const a=heraValue(await f.runtime.executor.execute(f.runtime.request)),before=f.counters();await f.reopen();
    const b=heraValue(await f.runtime.executor.execute(f.runtime.request));assert.deepEqual(b,a);assert.deepEqual(f.counters(),before);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
it('a crash before validation resumes committed agents without buying them twice',async()=>{
  let armed=true;const dir=await mkdtemp(join(tmpdir(),'hera-resume-')),f=await executorFixture({path:join(dir,'state.sqlite'),observer:{onNodeEnter(path){if(armed&&path==='validate'){armed=false;throw new MasInfrastructureCrash('before validation');}}}});
  try{await assert.rejects(f.runtime.executor.execute(f.runtime.request),/before validation/);const calls=f.counters().calls;await f.reopen();
    const result=heraValue(await f.runtime.executor.execute(f.runtime.request));assert.equal(result.trajectory.status,'completed');assert.equal(f.counters().calls,calls);assert.equal(result.steps.length,6);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
it('unsupported citations are counted without deleting the evaluated answer',async()=>{
  const f=await executorFixture({unsupported:true});try{
    const r=heraValue(await f.runtime.executor.execute(f.runtime.request));assert.equal(r.trajectory.status,'completed');assert.equal(r.trajectory.primaryScore,1);
    assert.equal(r.trajectory.metrics.citationRecall,0);assert.equal(r.trajectory.metrics.unsupported[0].code,'THERA1005');
    const trace=(await f.runtime.masStore.readTrace(r.trajectory.masRunId))!;assert.ok(validateClaimEvidence((trace.run.output as any).result.envelope).valid);
  }finally{await f.close();}
});
it('normalization repair and missing usage remain counted separately from estimates',async()=>{
  const f=await executorFixture({unknownUsage:true,repairNode:'conclude'});try{
    const r=heraValue(await f.runtime.executor.execute(f.runtime.request));assert.equal(r.trajectory.status,'completed');assert.equal(r.trajectory.calls,15);
    assert.equal(r.trajectory.tokens.unknownRequests,15);assert.equal(r.trajectory.tokens.prompt,0);assert.equal(r.trajectory.tokens.completion,0);assert.ok(r.trajectory.tokens.estimated>0);
    assert.equal(r.trajectory.calls,f.counters().calls);
  }finally{await f.close();}
});
for(const kind of ['failed','budget','orphan'] as const)it(`${kind} retains invocation attribution and refuses to repeat completed costly work`,async()=>{
  const f=await executorFixture({failNode:kind==='failed'?'answer':undefined,uncertain:kind==='orphan'});try{
    const request={...f.runtime.request,...(kind==='budget'?{caps:{calls:1}}:{})};const r=heraValue(await f.runtime.executor.execute(request));
    assert.equal(r.trajectory.status,kind==='orphan'?'orphan':'failed');assert.ok(r.trajectory.failure);
    assert.equal((r.trajectory.failure.issue.cause as {code:string}).code,kind==='failed'?'TMAS2004':kind==='budget'?'TMAS2009':'TMAS2006');
    if(kind==='failed')assert.equal(r.trajectory.failure.node,'answer');else assert.equal(r.trajectory.failure.issue.code,'THERA1007');
    const calls=f.counters();assert.deepEqual(heraValue(await f.runtime.executor.execute(request)),r);assert.deepEqual(f.counters(),calls);
  }finally{await f.close();}
});
it('changed identity, key payload and corpus pins refuse before further provider calls',async()=>{
  const f=await executorFixture();try{
    heraValue(await f.runtime.executor.execute(f.runtime.request));const before=f.counters().calls;
    const changed=await f.runtime.executor.execute({...f.runtime.request,task:{...f.runtime.request.task,query:'Changed same id'}});assert.equal(changed.valid,false);if(!changed.valid)assert.equal(changed.issues[0].code,'THERA1007');
    const wrong=createHeraExecutor({...f.runtime.host,embedder:{...f.runtime.host.embedder,model:'foreign'}});const mismatch=await wrong.execute(f.runtime.request);assert.equal(mismatch.valid,false);if(!mismatch.valid)assert.equal(mismatch.issues[0].code,'THERA1009');
    f.supersede();const stale=await f.runtime.executor.execute(f.runtime.request);assert.equal(stale.valid,false);if(!stale.valid)assert.equal(stale.issues[0].code,'THERA1002');assert.equal(f.counters().calls,before);
  }finally{await f.close();}
});
it('unlabelled inference remains unscored and cannot enter learning or evaluation',async()=>{
  const f=await executorFixture();try{
    const task={...f.runtime.request.task,id:'unlabelled',split:'unlabelled' as const,evaluator:null};delete task.goldAddress;
    const request={...f.runtime.request,task,mode:'infer' as const};
    const result=heraValue(await f.runtime.executor.execute(request));assert.equal(result.trajectory.primaryScore,null);assert.equal(result.trajectory.success,null);
    const before=f.counters().calls;
    for(const mode of ['learn','evaluate'] as const)assert.equal((await f.runtime.executor.execute({...request,mode})).valid,false);
    assert.equal(f.counters().calls,before);
  }finally{await f.close();}
});
it('a changed host tool schema refuses before any model request',async()=>{
  const f=await executorFixture();try{
    const profiles=structuredClone(f.runtime.host.profiles) as typeof f.runtime.host.profiles & {host:{tools:Array<{inputSchemaRevision:string}>}};
    profiles.host.tools[0].inputSchemaRevision='a'.repeat(64);
    const result=await createHeraExecutor({...f.runtime.host,profiles}).execute(f.runtime.request);assert.equal(result.valid,false);
    if(!result.valid)assert.equal(result.issues[0].code,'THERA1002');assert.equal(f.counters().calls,0);
  }finally{await f.close();}
});
it('a memory evidence host uses the native MAS memory context adapter',async()=>{
  const f=await executorFixture();try{
    const host={...f.runtime.host,evidence:{...f.runtime.host.evidence,contextAdapter:'memory' as const}};
    const result=heraValue(await createHeraExecutor(host).execute(f.runtime.request));assert.equal(result.trajectory.status,'completed');
    const trace=(await f.runtime.masStore.readTrace(result.trajectory.masRunId))!;
    for(const attempt of trace.attempts.filter(a=>a.kind==='agent')){
      assert.ok(attempt.contextReads.some(r=>r.adapter==='memory'&&r.outcome==='ok'));
      assert.ok(attempt.contextReads.some(r=>r.adapter==='documents'&&r.outcome==='unavailable'));
    }
    const before=f.counters().calls;assert.equal((await f.runtime.executor.execute(f.runtime.request)).valid,false);assert.equal(f.counters().calls,before);
  }finally{await f.close();}
});
