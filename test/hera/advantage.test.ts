import {it} from 'node:test';import assert from 'node:assert/strict';
import {createHeraGroupRunner,validateSemanticAdvantage,heraReflectionView,type HeraReflectionOutput,type HeraTrajectoryStep} from '@tangleai/hera';
import {learningFixture,reflectScript} from './learning-fixture.ts';
it('reflection admits only exact evaluated trajectory and invocation evidence',async()=>{
  const f=await learningFixture({failNode:'b'});try{
    const {host,request}=f.build(),executed=await createHeraGroupRunner(host).run(request);assert.ok(executed.valid);
    const evidence={...executed.value,steps:await Promise.all(executed.value.trajectories.flatMap(t=>t.stepIds).map(id=>host.store.getTrajectoryStep(id))) as HeraTrajectoryStep[]};
    const views=heraReflectionView(evidence),output=reflectScript({messages:[{role:'user',content:'Ranked topologies, per-invocation inputs/actions/outputs, answers, task scores and provider-token costs: '+JSON.stringify(views)}]});
    assert.ok(validateSemanticAdvantage(output,evidence).valid);
    const cases:Array<{change:(o:HeraReflectionOutput)=>void;path:string}>=[
      {change:o=>{o.successFactors[0].trajectoryIds=['foreign'];},path:'/successFactors/0/trajectoryIds/0'},
      {change:o=>{o.failureModes[0].trajectoryIds=[o.successFactors[0].trajectoryIds[0]];},path:'/failureModes/0/trajectoryIds/0'},
      {change:o=>{o.insights[0].stepIds=['foreign'];},path:'/insights/0/stepIds/0'},
      {change:o=>{o.failedInvocationCredit[0].invocationId='foreign';},path:'/failedInvocationCredit/0/invocationId'},
      {change:o=>{o.failedInvocationCredit[0].stepIds=[];},path:'/failedInvocationCredit/0/stepIds'},
      {change:o=>{o.failedInvocationCredit[0].stepIds=[o.successFactors[0].stepIds[0]];},path:'/failedInvocationCredit/0/stepIds/0'},
      {change:o=>{o.insights.push({...o.insights[0]});},path:'/insights'},
    ];
    for(const c of cases){const value=structuredClone(output);c.change(value);const checked=validateSemanticAdvantage(value,evidence);assert.equal(checked.valid,false);if(!checked.valid){assert.equal(checked.issues[0].code,'THERA1008');assert.equal(checked.issues[0].path,c.path);}}
    const missing=validateSemanticAdvantage(output,{...evidence,steps:evidence.steps.slice(1)});assert.equal(missing.valid,false);
    assert.ok(views.every(t=>t.steps.every(s=>s.input.text.length<=256&&s.actions.text.length<=256&&s.output.text.length<=256)));
  }finally{await f.close();}
});
