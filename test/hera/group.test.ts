import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHeraGroupRunner,rankTrajectories,type HeraTrajectory} from '@tangleai/hera';
import {groupFixture,serialPlan,parallelPlan} from './group-fixture.ts';
it('frozen groups execute two distinct plans, count duplicates and replay without purchases',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),runner=createHeraGroupRunner(host),before=host.store.counters();
    const result=await runner.run(request);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.trajectories.length,2);assert.equal(result.value.group.state,'completed');assert.equal(result.value.group.refusals?.duplicateCandidates,1);
    assert.ok(result.value.trajectories.every(t=>t.primaryScore===1));assert.equal(result.value.group.mixedOutcome.value,false);
    assert.equal(f.counters().controls,4);assert.equal(f.counters().embeddings,1);assert.equal(result.value.group.budget.spent.calls,f.counters().calls+f.counters().controls);
    assert.equal(result.value.group.controlUsage?.calls,4);assert.equal(result.value.group.controlUsage?.promptTokens,28);
    assert.deepEqual(host.store.counters(),before);
    const calls=f.counters();assert.deepEqual(await runner.run(request),result);assert.deepEqual(f.counters(),calls);
    for(const entry of f.controlRequests)assert.doesNotMatch(JSON.stringify(entry.request),/goldAddress|"split"/);
  }finally{await f.close();}
});
it('invalid survivors are retained and failed candidates are counted values in a completed group',async()=>{
  const invalid={...serialPlan,appliedExperienceIds:['unoffered']};
  const f=await groupFixture({plans:[serialPlan,parallelPlan,invalid],failNode:'b'});try{
    const {host,request}=f.build(),result=await createHeraGroupRunner(host).run(request);assert.ok(result.valid,JSON.stringify(result));
    const {group,topologies,trajectories}=result.value;
    assert.equal(group.state,'completed');assert.equal(group.refusals?.invalidCandidates,1);assert.equal(group.refusals?.appliedNotOffered,1);
    assert.equal(topologies.filter(t=>!t.validation.valid).length,1);assert.deepEqual(topologies.find(t=>!t.validation.valid)?.rawProposal,invalid);
    assert.equal(trajectories.filter(t=>t.status==='failed').length,1);assert.ok(group.failures.some(i=>i.path.includes('b')));
    assert.equal(group.mixedOutcome.value,true);assert.equal(f.counters().controls,5);
    assert.equal(group.budget.spent.calls,f.counters().calls+f.counters().controls);
  }finally{await f.close();}
});
it('unlabelled inference remains unevaluated and unlabelled learning refuses before purchase',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),runner=createHeraGroupRunner(host),before=host.store.counters();
    const {goldAddress,...unlabelled}=request.task;
    const result=await runner.run({...request,mode:'infer',task:{...unlabelled,evaluator:null}});assert.ok(result.valid,JSON.stringify(result));
    assert.ok(result.value.trajectories.every(t=>t.primaryScore===null&&t.success===null));assert.equal(result.value.group.unevaluatedTrajectoryIds?.length,2);
    assert.equal(host.store.counters().learningWrites,before.learningWrites);
    const calls=f.counters(),denied=await runner.run({...request,mode:'learn',task:{...unlabelled,split:'training'}});assert.equal(denied.valid,false);if(!denied.valid)assert.equal(denied.issues[0].code,'THERA1004');assert.deepEqual(f.counters(),calls);
    const heldout=await runner.run({...request,mode:'learn'});assert.equal(heldout.valid,false);if(!heldout.valid)assert.equal(heldout.issues[0].code,'THERA1004');
  }finally{await f.close();}
});
it('a response retained before group finalization replays all stages without buying them again',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),put=host.store.putRolloutGroup;
    const interrupted={...host,store:{...host.store,putRolloutGroup:async()=>{throw Error('interrupted finalization');}}};
    await assert.rejects(createHeraGroupRunner(interrupted).run(request),/interrupted finalization/);
    const calls=f.counters(),result=await createHeraGroupRunner({...host,store:{...host.store,putRolloutGroup:put}}).run(request);
    assert.ok(result.valid,JSON.stringify(result));assert.deepEqual(f.counters(),calls);
    assert.equal(result.value.group.budget.spent.calls,calls.calls+calls.controls);
    assert.equal(result.value.group.controlUsage?.ms,4);
  }finally{await f.close();}
});
it('prepared shares survive an advancing clock and a crash after candidates finish',async()=>{
  const f=await groupFixture();try{
    const built=f.build(),host={...built.host,clock:()=>f.base.clock.value++},request=built.request;
    const interrupted={...host,store:{...host.store,putRolloutGroup:async()=>{throw Error('finalization crash');}}};
    await assert.rejects(createHeraGroupRunner(interrupted).run(request),/finalization crash/);const calls=f.counters();f.base.clock.value+=10000;
    const result=await createHeraGroupRunner(host).run(request);assert.ok(result.valid,JSON.stringify(result));assert.deepEqual(f.counters(),calls);
    assert.ok((await host.store.listOperations({groupId:result.value.group.id})).some(o=>o.stage==='group/prepared'&&o.phase==='result'));
  }finally{await f.close();}
});
it('group concurrency bounds simultaneous durable candidate workers',async()=>{
  for(const concurrency of [1,2]){
    const f=await groupFixture();try{
      const {host,request}=f.build();let active=0,maximum=0,release!:()=>void;
      const both=new Promise<void>(r=>{release=r;}),segments={async drive(...args:Parameters<typeof host.segments.drive>){
        active++;maximum=Math.max(maximum,active);if(active===2)release();if(concurrency===2)await both;
        try{await host.segments.drive(...args);}finally{active--;}
      }};
      const result=await createHeraGroupRunner({...host,segments}).run({...request,groupConcurrency:concurrency});assert.ok(result.valid,JSON.stringify(result));
      assert.equal(maximum,concurrency);assert.equal(active,0);
      for(const trajectory of result.value.trajectories){const run=await host.masStore.getRun(trajectory.masRunId);assert.equal(run?.budget.limits.concurrency,2);assert.equal(run?.budget.limits.calls,10);}
    }finally{await f.close();}
  }
});
it('a competing control dispatch reports uncertainty while the original owner completes',async()=>{
  let enter!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>{enter=r;}),released=new Promise<void>(r=>{release=r;});
  const f=await groupFixture({control:async(stage)=>{if(stage==='profile'){enter();await released;return {text:'Locate supporting facts',tags:[]};}return [serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])];}});
  try{
    const {host,request}=f.build(),first=createHeraGroupRunner(host).run(request);await entered;
    const conflict=await createHeraGroupRunner(host).run(request);assert.equal(conflict.valid,false);if(!conflict.valid)assert.equal(conflict.issues[0].code,'THERA1007');
    assert.equal(f.counters().controls,1);assert.equal((await host.store.query('rolloutGroup',{})).length,0);
    release();const result=await first;assert.ok(result.valid,JSON.stringify(result));assert.equal(f.counters().controls,4);
  }finally{release();await f.close();}
});
it('exhausted shared call allocations refuse candidates without exceeding the provider call cap',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),result=await createHeraGroupRunner(host).run({...request,budget:{...request.budget,calls:4}});
    assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.group.state,'failed');assert.equal(f.counters().controls,4);assert.equal(f.counters().calls,0);
    assert.equal(result.value.group.budget.spent.calls,4);assert.equal(result.value.group.refusals?.invalidCandidates,2);
  }finally{await f.close();}
});
it('task score outranks provider cost and null scores remain explicit',()=>{
  const candidate=(id:string,score:number|null,tokens:number)=>({id,primaryScore:score,tokens:{prompt:tokens,completion:0}} as HeraTrajectory);
  const result=rankTrajectories([candidate('unknown',null,0),candidate('low',.5,1),candidate('high',1,100),candidate('tie-b',1,10),candidate('tie-a',1,10)]);
  assert.deepEqual(result.ranked.map(t=>t.id),['tie-a','tie-b','high','low','unknown']);assert.deepEqual(result.unevaluatedIds,['unknown']);
});
it('completed groups reopen with identical evidence and no control, embedding or role calls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-group-')),f=await groupFixture({path:join(dir,'run.sqlite')});try{
    const first=f.build(),result=await createHeraGroupRunner(first.host).run(first.request);assert.ok(result.valid,JSON.stringify(result));const before=f.counters();
    await f.base.reopen();const second=f.build(),replay=await createHeraGroupRunner(second.host).run(second.request);assert.deepEqual(replay,result);assert.deepEqual(f.counters(),before);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
it('the structured-output gate owns the only repair and malformed survivors remain raw evidence',async()=>{
  const unknown={...serialPlan,nodes:serialPlan.nodes.map((node,index)=>index===0?{...node,agentId:'unregistered'}:node)};
  const f=await groupFixture({plans:[unknown,'not JSON',serialPlan]});try{
    const {host,request}=f.build(),result=await createHeraGroupRunner(host).run(request);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.group.refusals?.invalidCandidates,2);assert.equal(result.value.trajectories.length,1);assert.equal(f.counters().controls,6);
    assert.deepEqual(result.value.topologies.filter(t=>!t.validation.valid).map(t=>t.rawProposal),[unknown,'not JSON']);
    assert.ok(result.value.topologies.filter(t=>!t.validation.valid).every(t=>t.nodes.length===0));
  }finally{await f.close();}
  const repaired=await groupFixture({control:(stage,attempt)=>stage==='profile'?{text:'Read supporting facts',tags:[]}:stage==='plan/0'&&attempt===0?unknown:[serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])]});
  try{const {host,request}=repaired.build(),result=await createHeraGroupRunner(host).run(request);assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.group.refusals?.invalidCandidates,0);assert.equal(repaired.counters().controls,5);}
  finally{await repaired.close();}
});
it('a failed control purchase retains its unknown usage while other candidates finish',async()=>{
  const f=await groupFixture({control:stage=>{if(stage==='plan/1')throw Error('scripted transport failure');return stage==='profile'?{text:'Read the facts',tags:[]}:serialPlan;}});
  try{const {host,request}=f.build(),result=await createHeraGroupRunner(host).run(request);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.group.state,'completed');assert.equal(result.value.group.controlUsage?.unknownTokenRequests,1);assert.equal(result.value.group.controlUsage?.calls,4);
    assert.ok(result.value.group.failures.some(i=>i.detail==='scripted transport failure'));assert.equal(result.value.group.budget.spent.calls,f.counters().calls+f.counters().controls);
  }finally{await f.close();}
});
it('losing a purchased control response refuses replay rather than calling its provider again',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),interrupted={...host,store:{...host.store,putOperation:async()=>{throw Error('response persistence failed');}}};
    await assert.rejects(createHeraGroupRunner(interrupted).run(request),/response persistence failed/);assert.equal(f.counters().controls,1);
    const replay=await createHeraGroupRunner(host).run(request);assert.equal(replay.valid,false);if(!replay.valid)assert.equal(replay.issues[0].code,'THERA1007');
    assert.equal(f.counters().controls,1);assert.equal((await host.store.query('rolloutGroup',{})).length,0);
    const operations=await host.store.query('operation',{});assert.equal(operations.length,1);assert.equal(operations[0].phase,'dispatch');
  }finally{await f.close();}
});
it('control elapsed time reduces every candidate share and prevents additional dispatch',async()=>{
  const f=await groupFixture();try{
    const {host,request}=f.build(),result=await createHeraGroupRunner(host).run({...request,budget:{...request.budget,ms:2}});assert.ok(result.valid,JSON.stringify(result));
    assert.equal(f.counters().controls,2);assert.equal(f.counters().calls,0);assert.equal(result.value.group.budget.spent.ms,2);
    assert.ok(result.value.group.failures.some(i=>i.code==='THERA1007'&&i.detail.includes('budget-ms')));
  }finally{await f.close();}
});
