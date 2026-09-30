import {it} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {resolveProfile} from '@tangleai/config';
import {createHeraLearner,rollbackPromptVersion,emptyHeraHead,createHeraControlReceipts,runHeraPromptTrial,prepareHeraExecutionSnapshot,heraRevisionOf,HERA_RECORD_KINDS,isHeraLearningKind,type HeraLearningRequest,type HeraStore,type HeraRopeOutput} from '@tangleai/hera';
import {HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {groupFixture,serialPlan,parallelPlan,budget} from './group-fixture.ts';
import {promptField,reflectScript} from './learning-fixture.ts';
const rule='Check the complete supporting path before concluding.';
const config={...HERA_EXAMPLE_CONFIG,flags:{experience:false,rope:true,mutation:false}};
function ropeScript(stage:string,request:unknown):HeraRopeOutput{
  if(stage.endsWith('proposal')){const failures=promptField(request,'Evaluated failures: ') as Array<{trajectoryId:string}>;const derivedFrom=[failures.at(-1)!.trajectoryId];return {operationalRules:[{text:rule,derivedFrom}],behavioralPrinciples:[],derivedFrom};}
  const pair=(promptField(request,'Whole-run paired trials: ') as Array<{control:{id:string};replay:{id:string};operationalRules:Array<{text:string}>;behavioralPrinciples:Array<{text:string}>}>)[0],derivedFrom=[pair.control.id,pair.replay.id];
  return {operationalRules:pair.operationalRules.map(r=>({...r,derivedFrom})),behavioralPrinciples:pair.behavioralPrinciples.map(r=>({...r,derivedFrom})),derivedFrom};
}
async function fixture(options:{path?:string;variant?:'unchanged'|'unsupported'|'category'|'duplicate';failReplay?:boolean}={}){
  return groupFixture({path:options.path,config,transformResult(node,request,value){
    const changed=JSON.stringify(request).includes(rule);
    if(node.id==='c'&&changed&&options.failReplay)throw Error('Variant execution failed');
    if(node.id==='c'&&(!changed||options.variant==='unchanged'))return {...value,answer:'Wrong'};
    return value;
  },control(stage,_attempt,request){
    if(stage==='profile')return {text:'Find the director and their school.',tags:['two-hop']};
    if(stage.startsWith('plan/'))return [serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])];
    if(stage==='learn/reflection')return reflectScript(request);
    if(stage.startsWith('learn/rope/')){const result=ropeScript(stage,request);
      if(options.variant==='unsupported'&&stage.endsWith('proposal'))result.operationalRules[0].derivedFrom=['invented'];
      if(options.variant==='category'&&stage.endsWith('contrast')){result.behavioralPrinciples=result.operationalRules;result.operationalRules=[];}
      if(options.variant==='duplicate'&&stage.endsWith('proposal'))result.operationalRules.push({...result.operationalRules[0]});
      return result;
    }throw Error('Unexpected control stage '+stage);
  }});
}
const training=(request:ReturnType<Awaited<ReturnType<typeof fixture>>['build']>['request']):HeraLearningRequest=>({...request,task:{...request.task,split:'training'},mode:'learn',learningBudget:budget});
const state=async(store:HeraStore)=>Object.fromEntries(await Promise.all(HERA_RECORD_KINDS.filter(isHeraLearningKind).map(async kind=>[kind,await store.query(kind,{limit:10000})])));
it('a measured whole-run prompt win activates one role and reopens with zero purchases',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-rope-')),f=await fixture({path:join(dir,'db.sqlite')});try{
    let {host,request}=f.build();const input=training(request),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));
    assert.deepEqual(result.value.trials,{activated:1,rejected:0,malformed:0,unevaluated:0});assert.equal(result.value.librarySize,0);
    assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls);assert.equal(result.value.replayCost.calls,7);
    const trial=(await host.store.getPromptTrial(result.value.promptTrialIds[0]))!,control=(await host.store.getTrajectory(trial.controlTrajectoryId!))!,replay=(await host.store.getTrajectory(trial.replayTrajectoryId!))!;
    assert.equal(trial.delta!.score,1);assert.deepEqual(replay.invocationOrder,control.invocationOrder);assert.deepEqual(replay.invocationOrder,['a','b','c']);
    assert.equal(replay.topologyId,control.topologyId);assert.equal(replay.snapshotId,control.snapshotId);assert.equal(replay.identityId,control.identityId);
    const controlRun=(await host.masStore.getRun(control.masRunId))!,replayRun=(await host.masStore.getRun(replay.masRunId))!;
    assert.deepEqual(replayRun.budget.limits,controlRun.budget.limits);assert.deepEqual((replayRun.input as {evidence:unknown}).evidence,(controlRun.input as {evidence:unknown}).evidence);
    const controlSteps=await Promise.all(control.stepIds.map(id=>host.store.getTrajectoryStep(id))),replaySteps=await Promise.all(replay.stepIds.map(id=>host.store.getTrajectoryStep(id)));
    assert.equal(controlSteps.filter((s,i)=>s!.promptVersionId!==replaySteps[i]!.promptVersionId).length,1);assert.equal(replaySteps[2]!.promptVersionId,trial.candidatePromptVersionId);
    assert.deepEqual(trial.operationalRules[0].derivedFrom,[control.id,replay.id]);assert.equal(trial.pins!.evidenceRevision,host.evidence.revision);
    const candidate=(await host.store.getPromptVersion(trial.candidatePromptVersionId!))!,old=(await host.store.getPromptVersion(input.snapshot.activePromptVersionIds['conclude-agent']))!;
    assert.equal(candidate.status,'active');assert.equal(old.status,'archived');assert.deepEqual(candidate.operationalRules[0].derivedFrom,[control.id]);
    assert.equal(Object.keys(input.snapshot.activePromptVersionIds).filter(id=>input.snapshot.activePromptVersionIds[id]!==result.value.snapshot.activePromptVersionIds[id]).length,1);
    assert.equal((await host.store.getFailureBuffer(result.value.snapshot.failureBufferIds!['conclude-agent']))!.entries.length,1);
    const before=f.counters();await f.base.reopen();host=f.build().host;assert.deepEqual(await createHeraLearner(host).run(input),result);assert.deepEqual(f.counters(),before);
    const expectedPrompt=(await host.store.readHead(emptyHeraHead(host.store.scope,'prompt','conclude-agent').id))!,expectedSnapshot=(await host.store.readHead(emptyHeraHead(host.store.scope,'snapshot').id))!;
    const restored=await rollbackPromptVersion(host.store,{agentId:'conclude-agent',toVersionId:old.id,expectedPrompt,expectedSnapshot},{scope:host.store.scope,mode:'learn'});assert.ok(restored.valid,JSON.stringify(restored));
    assert.equal(restored.value.promptVersion.id,old.id);assert.equal(restored.value.snapshot.activePromptVersionIds['conclude-agent'],old.id);assert.notEqual(restored.value.snapshot.id,input.snapshot.id);assert.deepEqual(f.counters(),before);
    const stale=await rollbackPromptVersion(host.store,{agentId:'conclude-agent',toVersionId:candidate.id,expectedPrompt,expectedSnapshot},{scope:host.store.scope,mode:'learn'});assert.equal(stale.valid,false);if(!stale.valid)assert.equal(stale.issues[0].code,'THERA1006');
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
it('losing, unsupported, recategorized and duplicate trials retain costs without changing the active prompt',async()=>{
  for(const variant of ['unchanged','unsupported','category','duplicate'] as const){const f=await fixture({variant});try{
    const {host,request}=f.build(),input=training(request),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));
    assert.deepEqual(result.value.snapshot.activePromptVersionIds,input.snapshot.activePromptVersionIds);assert.equal(result.value.trials.activated,0);
    assert.equal(result.value.trials[variant==='unchanged'||variant==='duplicate'?'rejected':'malformed'],1);
    assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls);assert.equal(result.value.replayCost.calls,variant==='unsupported'?0:7);
    const before=f.counters();assert.deepEqual(await createHeraLearner(host).run(input),result);assert.deepEqual(f.counters(),before);
    const trial=(await host.store.getPromptTrial(result.value.promptTrialIds[0]))!;assert.ok(trial.reason);
    if(variant==='unsupported')assert.equal(trial.candidatePromptVersionId,null);
  }finally{await f.close();}}
});
it('an exhausted refinement budget refuses the whole replay without buying a partial role call',async()=>{
  const f=await fixture();try{const {host,request}=f.build(),result=await createHeraLearner(host).run({...training(request),learningBudget:{...budget,calls:2}});assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.trials.malformed,1);assert.equal(result.value.replayCost.calls,0);assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls);
    const trial=(await host.store.getPromptTrial(result.value.promptTrialIds[0]))!;assert.match(trial.reason,/complete pinned whole run/);assert.equal(trial.replayTrajectoryId,null);
  }finally{await f.close();}
});
it('a changed evidence policy buys a full control and charges it beside the replay',async()=>{
  const f=await fixture();try{
    const {host,request}=f.build(),input=training(request),first=await createHeraLearner(host).run(input);assert.ok(first.valid);
    const buffer=(await host.store.getFailureBuffer(first.value.snapshot.failureBufferIds!['conclude-agent']))!,prepared=await prepareHeraExecutionSnapshot(host.store,input.snapshot);assert.ok(prepared.valid);
    const resolution=await resolveProfile({...host.profiles,request:{kind:'profile',profile:'scripted',overrides:null}});assert.ok(resolution.ok);
    const changed={...host,evidence:{...host.evidence,revision:await heraRevisionOf('changed-evidence-policy')}},binding=await heraRevisionOf('fresh-control-trial'),groupId='fresh-control-trial';
    const createReceipts=()=>createHeraControlReceipts({store:host.store,authority:{scope:host.store.scope,mode:'learn'},taskId:input.task.id,snapshotId:input.snapshot.id,groupId,binding,identity:resolution.identity,budget,clock:host.clock});
    const receipts=createReceipts(),trialInput={task:input.task,snapshot:input.snapshot,buffer,groupIndex:0,groupId,binding,identity:resolution.identity,artifact:prepared.value.catalog.prompt('hera-rope-evolution')!,roleArtifact:prepared.value.catalog.prompt('hera-role-conclude-agent')!,receipts};
    trialInput.roleArtifact=prepared.value.catalog.prompt(prepared.value.agents.find(a=>a.id==='conclude-agent')!.artifactId)!;
    const before=f.counters(),result=await runHeraPromptTrial(trialInput,changed);assert.equal(result.controlReused,false);assert.equal(result.trial.decision,'activated',JSON.stringify(result.trial));assert.equal(result.replayCost.calls,14);
    assert.equal(f.counters().calls+f.counters().controls-before.calls-before.controls,16);assert.equal(receipts.spent().calls,16);
    const after=f.counters();assert.deepEqual(await runHeraPromptTrial(trialInput,changed),result);assert.equal(receipts.spent().calls,16);assert.deepEqual(f.counters(),after);
    const replayedReceipts=createReceipts();assert.deepEqual(await runHeraPromptTrial({...trialInput,receipts:replayedReceipts},changed),result);assert.deepEqual(f.counters(),after);assert.equal(replayedReceipts.spent().calls,16);
  }finally{await f.close();}
});
it('a final activation crash leaves learning collections unchanged and reuses the measured trial',async()=>{
  const f=await fixture();try{
    const {host,request}=f.build(),input=training(request),before=await state(host.store);
    const interrupted={...host,store:{...host.store,transaction:((authority,fn)=>host.store.transaction(authority,tx=>fn({...tx,put:async(kind,value)=>{
      if(kind==='operation'&&'stage' in value&&value.stage==='learning.complete')throw Error('Final activation interrupted');return tx.put(kind,value);
    }}))) as HeraStore['transaction']}};
    await assert.rejects(createHeraLearner(interrupted).run(input),/Final activation interrupted/);assert.deepEqual(await state(host.store),before);
    const calls=f.counters(),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.trials.activated,1);assert.deepEqual(f.counters(),calls);
  }finally{await f.close();}
});

it('failed and unevaluated whole runs retain their spend and never activate',async()=>{
  for(const kind of ['failed','unevaluated'] as const){const f=await fixture({failReplay:kind==='failed'});try{
    const {host,request}=f.build();
    const selected=kind==='failed'?host:{...host,evaluator:{...host.evaluator,async score(...args:Parameters<typeof host.evaluator.score>){
      return f.controlRequests.some(r=>r.stage==='learn/rope/proposal')?{primaryScore:null,success:null}:host.evaluator.score(...args);
    }}};
    const input=training(request),result=await createHeraLearner(selected).run(input);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.trials[kind==='failed'?'malformed':'unevaluated'],1);assert.equal(result.value.trials.activated,0);
    assert.deepEqual(result.value.snapshot.activePromptVersionIds,input.snapshot.activePromptVersionIds);assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls);
    const trial=(await host.store.getPromptTrial(result.value.promptTrialIds[0]))!;assert.equal(trial.executionRunIds!.length,1);assert.ok(await host.masStore.getRun(trial.executionRunIds![0]));
    const before=f.counters();assert.deepEqual(await createHeraLearner(selected).run(input),result);assert.deepEqual(f.counters(),before);
  }finally{await f.close();}}
});
it('a crash after trial receipts restores proposal, contrast and replay charges without repurchase',async()=>{
  const f=await fixture();try{
    const {host,request}=f.build(),input=training(request),before=await state(host.store);
    const interrupted={...host,store:{...host.store,putOperation:async(record:Parameters<HeraStore['putOperation']>[0],authority:Parameters<HeraStore['putOperation']>[1])=>{
      if(record.stage==='rope.run')throw Error('After measured trial');return host.store.putOperation(record,authority);
    }}};
    await assert.rejects(createHeraLearner(interrupted).run(input),/After measured trial/);assert.deepEqual(await state(host.store),before);
    const calls=f.counters(),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));assert.deepEqual(f.counters(),calls);
    assert.equal(result.value.spent.calls,calls.calls+calls.controls);assert.equal(result.value.usage.calls,10);assert.equal(result.value.replayCost.calls,7);
  }finally{await f.close();}
});

it('competing prompt learners commit one complete activation and no learning records from the loser',async()=>{
  const f=await fixture();let release!:()=>void,entered=0;const barrier=new Promise<void>(resolve=>{release=resolve;});try{
    const {host,request}=f.build(),initial=host.store.counters().learningWrites,clientFor=host.controlClientFor;
    const concurrent={...host,controlClientFor(...args:Parameters<typeof host.controlClientFor>){const client=clientFor(...args);return {...client,async complete(request:Parameters<typeof client.complete>[0]){
      if(args[2]==='learn/rope/contrast'){if(++entered===2)release();await barrier;}return client.complete(request);
    }};}};
    const results=await Promise.all([0,1].map(groupIndex=>createHeraLearner(concurrent).run({...training(request),groupIndex})));
    assert.equal(results.filter(r=>r.valid).length,1,JSON.stringify(results));const loser=results.find(r=>!r.valid)!;if(!loser.valid)assert.equal(loser.issues[0].code,'THERA1006');
    assert.equal(host.store.counters().learningWrites-initial,11);assert.equal((await host.store.query('promptTrial',{})).length,1);assert.equal((await host.store.query('failureBuffer',{})).length,1);
    assert.equal((await host.store.query('advantage',{})).length,1);assert.equal((await host.store.query('promptVersion',{agentId:'conclude-agent'})).length,2);
  }finally{release();await f.close();}
});
