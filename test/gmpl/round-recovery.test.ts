import type {GmplPatternResult} from '@tangleai/gmpl';
import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import {scriptedGmplResponse} from '../../benchmark/lib/gmpl-scripts.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
for(const pattern of ['peer-review','red-team','structured-debate'] as const)it(`${pattern} reopens committed roles, persisted carry and terminal segments without extra calls`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gmpl-round-recovery-'));
  try{
    const p=await prepareGmplPattern({pattern}),options={input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult,{continueRounds:true})};
    const clean=await driveGmplWorkflow(p,options);assert.equal(clean.status,'completed');
    const crashes=[{crashBefore:pattern==='peer-review'?'acceptance':pattern==='red-team'?'resilience-gate':'judgment'},{crashFsm:{state:'body',iteration:2}},{crashBeforeSegmentCompletion:true}];
    for(const [i,crash] of crashes.entries()){
      const resumed=await driveGmplWorkflow(p,{...options,...crash,databasePath:join(dir,`${i}.sqlite`)});
      assert.equal(resumed.status,'completed',JSON.stringify(resumed.trace.run.failure));assert.equal(resumed.crashes,1);assert.equal(resumed.reopens,1);
      assert.deepEqual(resumed.output,clean.output);assert.equal(resumed.usage.physical,clean.usage.physical);assert.deepEqual(resumed.trace.run.budget.spent,clean.trace.run.budget.spent);
      assert.deepEqual(resumed.trace.attempts.filter(a=>a.kind==='agent').map(a=>[a.path,a.status,a.output]),clean.trace.attempts.filter(a=>a.kind==='agent').map(a=>[a.path,a.status,a.output]));
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('Delphi reopens after polls and aggregate carry with no repeated completed polls',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gmpl-panel-recovery-'));
  try{
    const p=await prepareGmplPattern({pattern:'delphi-panel'}),options={input:{input:fixture.input},bindings:p.bindings,response:scriptedGmplResponse(fixture.input,fixture.script.result as GmplPatternResult,{continueRounds:true})};
    const clean=await driveGmplWorkflow(p,options);assert.equal(clean.status,'completed');
    for(const [i,crash] of [{crashBefore:'aggregate'},{crashFsm:{state:'body',iteration:2}},{crashBeforeSegmentCompletion:true}].entries()){
      const resumed=await driveGmplWorkflow(p,{...options,...crash,databasePath:join(dir,`${i}.sqlite`)});
      assert.equal(resumed.status,'completed');assert.equal(resumed.reopens,1);assert.deepEqual(resumed.output,clean.output);assert.equal(resumed.usage.physical,clean.usage.physical);assert.deepEqual(resumed.trace.run.budget.spent,clean.trace.run.budget.spent);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
