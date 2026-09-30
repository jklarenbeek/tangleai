import {it} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createHeraLearner,createHeraGroupRunner,readHeraFrozenLibrary,HERA_RECORD_KINDS,isHeraLearningKind,type HeraGroupRequest,type HeraStore} from '@tangleai/hera';
import {learningFixture} from './learning-fixture.ts';
const training=(request:HeraGroupRequest):HeraGroupRequest=>({...request,mode:'learn',task:{...request.task,split:'training'}});
const state=async(store:HeraStore)=>Object.fromEntries(await Promise.all(HERA_RECORD_KINDS.filter(isHeraLearningKind).map(async kind=>[kind,await store.query(kind,{limit:10000})])));
it('mixed learning commits a cited advantage, library and snapshot together and reopens without purchases',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-learning-')),f=await learningFixture({path:join(dir,'db.sqlite'),failNode:'b'});try{
    let {host,request}=f.build();request=training(request);const result=await createHeraLearner(host).run(request);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.mixedGroup,true);assert.deepEqual(result.value.libraryChurn,{add:1,merge:0,prune:0,keep:0});assert.equal(result.value.librarySize,1);
    assert.notEqual(result.value.snapshot.id,request.snapshot.id);assert.equal((await host.store.getSnapshot(request.snapshot.id))?.status,'archived');
    assert.deepEqual(await readHeraFrozenLibrary(host,request.snapshot),[]);assert.equal((await readHeraFrozenLibrary(host,result.value.snapshot)).length,1);
    assert.equal((await host.store.query('advantage',{})).length,1);assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls);
    const operations=await host.store.listOperations({groupId:result.value.group.id});assert.equal(operations.find(o=>o.stage==='rope.run')?.status,'disabled');
    assert.equal(operations.find(o=>o.stage==='topology.mutate')?.status,'disabled');assert.ok(result.value.group.operationIds!.length>(await host.store.getRolloutGroup(result.value.group.id))!.operationIds!.length);
    const before=f.counters();await f.base.reopen();host=f.build().host;
    assert.deepEqual(await createHeraLearner(host).run(request),result);assert.deepEqual(f.counters(),before);
    const pinned=await createHeraGroupRunner(host).run({...request,mode:'evaluate',groupIndex:9,task:{...request.task,split:'held-out'}});assert.ok(pinned.valid,JSON.stringify(pinned));assert.deepEqual(pinned.value.group.offeredExperienceIds,[]);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
it('all-success and all-failure groups produce no advantage or content operation',async()=>{
  for(const options of [{},{unsupported:true}]){const f=await learningFixture(options);try{
    const {host,request}=f.build(),before=await state(host.store),result=await createHeraLearner(host).run(training(request));assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.mixedGroup,false);assert.equal(result.value.groupsWithoutMixedOutcome,1);assert.equal(result.value.advantageId,null);assert.equal(result.value.snapshot.id,request.snapshot.id);
    assert.deepEqual(await state(host.store),before);assert.equal(f.controlRequests.filter(r=>r.stage.startsWith('learn/')).length,0);
  }finally{await f.close();}}
});
it('held-out, undeclared and unlabelled learning are durably counted before any call',async()=>{
  const f=await learningFixture();try{
    const {host,request}=f.build(),before=await state(host.store),learner=createHeraLearner(host),train=training(request),{goldAddress,...unlabelled}=train.task;
    for(const r of [{...request,mode:'learn' as const},{...train,task:{...train.task,evaluator:null}},{...train,task:unlabelled}]){
      const result=await learner.run(r);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'THERA1004');
    }
    assert.deepEqual(await state(host.store),before);assert.equal(f.counters().calls+f.counters().controls,0);
    const refusals=(await host.store.query('operation',{})).filter(o=>o.stage.startsWith('learning.refused/'));assert.equal(refusals.length,3);
    assert.ok(refusals.every(o=>(o.value as {refusedLearningWrites:number}).refusedLearningWrites===1));
  }finally{await f.close();}
});
it('a refused consolidation repairs once and leaves every learning collection unchanged',async()=>{
  const f=await learningFixture({failNode:'b',consolidate:()=>({ops:[{op:'ADD',sourceInsightIds:['foreign'],targetIds:[],text:'Unsupported guidance.'}]})});try{
    const {host,request}=f.build(),before=await state(host.store),result=await createHeraLearner(host).run(training(request));assert.equal(result.valid,false);
    if(!result.valid){assert.equal(result.issues[0].code,'THERA1008');assert.equal(result.issues[0].path,'/ops/0/sourceInsightIds/0');}
    assert.deepEqual(await state(host.store),before);assert.equal(f.controlRequests.filter(r=>r.stage==='learn/consolidation').length,2);
    const calls=f.counters();assert.deepEqual(await createHeraLearner(host).run(training(request)),result);assert.deepEqual(f.counters(),calls);
  }finally{await f.close();}
});
it('competing SQLite learners commit one complete update and retain a zero-write loser',async()=>{
  let entered=0,release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});
  const f=await learningFixture({failNode:'b',consolidate:async()=>{if(++entered===2)release();await barrier;return {ops:[{op:'ADD',sourceInsightIds:['supported-path'],targetIds:[],text:'Retain supporting evidence.'}]};}});try{
    const {host,request}=f.build(),before=host.store.counters().learningWrites;
    const results=await Promise.all([0,1].map(groupIndex=>createHeraLearner(host).run({...training(request),groupIndex})));
    assert.equal(results.filter(r=>r.valid).length,1,JSON.stringify(results));const loser=results.find(r=>!r.valid)!;assert.equal(loser.valid,false);if(!loser.valid)assert.equal(loser.issues[0].code,'THERA1006');
    assert.equal(host.store.counters().learningWrites-before,7);assert.equal((await host.store.query('advantage',{})).length,1);assert.equal((await host.store.query('experience',{})).length,1);
    const conflicts=(await host.store.query('operation',{})).filter(o=>o.issues.some(i=>i.code==='THERA1006'));assert.equal(conflicts.length,1);assert.equal((conflicts[0].value as {headConflicts:number}).headConflicts,1);
  }finally{release();await f.close();}
});
it('a final transaction crash rolls back learning and retries the prepared proposal without purchases',async()=>{
  const f=await learningFixture({failNode:'b'});try{
    const {host,request}=f.build(),before=await state(host.store),counter=host.store.counters().learningWrites;
    const interrupted={...host,store:{...host.store,transaction:((authority,fn)=>host.store.transaction(authority,tx=>fn({...tx,put:async(kind,value)=>{
      if(kind==='operation'&&'stage' in value&&value.stage==='learning.complete')throw Error('Learning finalization interrupted');return tx.put(kind,value);
    }}))) as HeraStore['transaction']}};
    await assert.rejects(createHeraLearner(interrupted).run(training(request)),/Learning finalization interrupted/);
    assert.deepEqual(await state(host.store),before);assert.equal(host.store.counters().learningWrites,counter);
    const calls=f.counters();f.base.clock.value+=10000;const result=await createHeraLearner(host).run(training(request));assert.ok(result.valid,JSON.stringify(result));assert.deepEqual(f.counters(),calls);
    assert.equal(result.value.librarySize,1);assert.equal((await host.store.query('advantage',{})).length,1);
  }finally{await f.close();}
});
it('completed learning cannot replay without its durable invocation evidence',async()=>{
  const f=await learningFixture({failNode:'b'});try{
    const {host,request}=f.build(),input=training(request),first=await createHeraLearner(host).run(input);assert.ok(first.valid);
    const calls=f.counters(),missing={...host,store:{...host.store,getTrajectoryStep:async()=>undefined}},result=await createHeraLearner(missing).run(input);
    assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'THERA1007');assert.deepEqual(f.counters(),calls);
  }finally{await f.close();}
});
