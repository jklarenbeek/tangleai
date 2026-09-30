import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createHeraExecutor,createHeraLearner,mixedOutcome,type HeraRopeOutput} from '@tangleai/hera';
import {HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {executorFixture} from '../hera/executor-fixture.ts';
import {groupFixture,serialPlan,parallelPlan,budget} from '../hera/group-fixture.ts';
import {promptField,reflectScript} from '../hera/learning-fixture.ts';

it('an operational failure cannot earn successful abstention credit from an empty answer',async()=>{
  const f=await executorFixture({failNode:'decompose'});
  try{
    let scores=0;const host={...f.runtime.host,evaluator:{...f.runtime.host.evaluator,async score(){scores++;return {primaryScore:1,success:true};}}};
    const result=await createHeraExecutor(host).execute(f.runtime.request);assert.ok(result.valid,JSON.stringify(result));
    assert.equal(result.value.trajectory.status,'failed');assert.equal(result.value.trajectory.primaryScore,0);assert.equal(result.value.trajectory.success,false);
    assert.equal(scores,0,'The answer scorer receives completed answers, not synthetic failure placeholders.');
    assert.equal(mixedOutcome([result.value.trajectory,{...result.value.trajectory,id:'other-failure',primaryScore:0,success:false}]).value,false);
    const before=f.counters();assert.deepEqual(await createHeraExecutor(host).execute(f.runtime.request),result);assert.deepEqual(f.counters(),before);
  }finally{await f.close();}
});

it('fifty learning events keep a bounded library and reject every non-improving prompt',async()=>{
  let event=0;
  const config={...HERA_EXAMPLE_CONFIG,selectorCap:2,libraryCap:2,flags:{experience:true,rope:true,mutation:false}};
  const f=await groupFixture({config,transformResult(node,_request,value){return node.id==='c'?{...value,answer:'Wrong'}:value;},
    control(stage,_attempt,request){
      if(stage==='profile'){event++;return {text:'Find the director and school.',tags:['two-hop']};}
      if(stage.startsWith('plan/'))return [serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])];
      if(stage==='learn/reflection')return reflectScript(request);
      if(stage==='learn/consolidation'){
        const library=promptField(request,'Active library: ') as Array<{id:string}>;
        return {ops:library.length===2?[{op:'MERGE',sourceInsightIds:['supported-path'],targetIds:library.map(e=>e.id),text:'Retain the combined supporting path '+event+'.'}]
          :[{op:'ADD',sourceInsightIds:['supported-path'],targetIds:[],text:'Retain supporting path '+event+'.'}]};
      }
      if(stage==='learn/rope/proposal'){
        const failures=promptField(request,'Evaluated failures: ') as Array<{trajectoryId:string}>,derivedFrom=[failures.at(-1)!.trajectoryId];
        return {operationalRules:[{text:'Check the retained supporting path.',derivedFrom}],behavioralPrinciples:[],derivedFrom} satisfies HeraRopeOutput;
      }
      if(stage==='learn/rope/contrast'){
        const pair=(promptField(request,'Whole-run paired trials: ') as Array<{control:{id:string};replay:{id:string};operationalRules:Array<{text:string}>}>)[0],derivedFrom=[pair.control.id,pair.replay.id];
        return {operationalRules:pair.operationalRules.map(r=>({...r,derivedFrom})),behavioralPrinciples:[],derivedFrom};
      }
      throw Error('Unexpected stage '+stage);
    }});
  try{
    const {host,request}=f.build(),learner=createHeraLearner(host);let snapshot=request.snapshot,adds=0,merges=0,trials=0;
    for(let groupIndex=0;groupIndex<50;groupIndex++){
      const result=await learner.run({...request,task:{...request.task,split:'training'},mode:'learn',snapshot,groupIndex,learningBudget:budget});assert.ok(result.valid,JSON.stringify(result));
      assert.ok(result.value.librarySize<=config.libraryCap);assert.deepEqual(result.value.snapshot.activePromptVersionIds,request.snapshot.activePromptVersionIds);
      assert.equal(result.value.trials.activated,0);assert.equal(result.value.trials.rejected,1);assert.equal(result.value.replayCost.calls,7);
      const trial=(await host.store.getPromptTrial(result.value.promptTrialIds[0]))!;assert.equal(trial.delta!.score,0);assert.equal(trial.decision,'rejected');
      snapshot=result.value.snapshot;adds+=result.value.libraryChurn.add;merges+=result.value.libraryChurn.merge;trials+=result.value.promptTrialIds.length;
      const buffer=(await host.store.getFailureBuffer(snapshot.failureBufferIds!['conclude-agent']))!;assert.ok(buffer.entries.length<=config.failureBufferSize);
    }
    assert.equal(trials,50);assert.ok(adds>1&&merges>1);
    const before=host.store.counters().learningWrites,calls=f.counters(),denied=await learner.run({...request,snapshot,mode:'learn',groupIndex:50,learningBudget:budget});
    assert.equal(denied.valid,false);if(!denied.valid)assert.equal(denied.issues[0].code,'THERA1004');assert.equal(host.store.counters().learningWrites,before);assert.deepEqual(f.counters(),calls);
    const frozen=await createHeraExecutor(host).execute({...f.base.runtime.request,snapshot,mode:'evaluate',groupIndex:51});assert.ok(frozen.valid);assert.equal(host.store.counters().learningWrites,before);
  }finally{await f.close();}
});
