import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
it('analysis reopens SQLite and never repeats a committed analyst or terminal result',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gmpl-reopen-'));
  try{
    const p=await prepareGmplPattern(),options={input:{input:fixture.input},bindings:p.bindings,response:()=>({result:fixture.script.result})};
    const clean=await driveGmplWorkflow(p,options);
    for(const [name,crash] of [['after-analysts',{crashBefore:'prepare-synthesis'}],['terminal',{crashBeforeSegmentCompletion:true}]] as const){
      const recovered=await driveGmplWorkflow(p,{...options,...crash,databasePath:join(dir,name+'.sqlite')});
      assert.equal(recovered.status,'completed');assert.deepEqual(recovered.output,clean.output);assert.deepEqual(recovered.trace.run.budget.spent,clean.trace.run.budget.spent);assert.equal(recovered.usage.physical,clean.usage.physical);assert.equal(recovered.crashes,1);assert.equal(recovered.reopens,1);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
it('a red-team round reopens after current attacks and defenses without duplicate requests',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gmpl-red-reopen-'));
  try{
    const p=await prepareGmplPattern({pattern:'red-team'},'round');
    const options={input:{input:fixture.input},bindings:p.bindings,response:(node:string)=>node.startsWith('attack-')?{result:fixture.script.result,strategy:'adversarial-reframing'}:node.startsWith('defense-')?{result:fixture.script.result,mitigations:[]}:node==='resilience-judge'?{result:fixture.script.result,resilience:0.9,action:'accept'}:{result:fixture.script.result}};
    const clean=await driveGmplWorkflow(p,options),resumed=await driveGmplWorkflow(p,{...options,crashBefore:'prepare-judge',databasePath:join(dir,'round.sqlite')});
    assert.equal(resumed.status,'completed');assert.deepEqual(resumed.output,clean.output);assert.equal(resumed.usage.physical,clean.usage.physical);assert.deepEqual(resumed.trace.run.budget.spent,clean.trace.run.budget.spent);assert.equal(resumed.reopens,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});
