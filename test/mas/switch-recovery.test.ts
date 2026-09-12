import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/direct-fact-success.json' with {type:'json'};
it('MAS resumes a selected or merged switch without losing branch output or repeating agents',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mas-switch-reopen-'));
  try{
    const p=await prepareGmplPattern({pattern:'peer-review'},'round');
    const options={input:{input:fixture.input},bindings:p.bindings,response:(node:string)=>node.startsWith('reviewer')?{result:fixture.script.result,assessment:'minor-revision',issues:[],strengths:[]}:{result:fixture.script.result}};
    const clean=await driveGmplWorkflow(p,options);assert.equal(clean.status,'completed');
    for(const state of ['run-revise','merged']){
      const recovered=await driveGmplWorkflow(p,{...options,crashFsm:{state},databasePath:join(dir,state+'.sqlite')});
      assert.equal(recovered.status,'completed',JSON.stringify(recovered.trace.run.failure));assert.deepEqual(recovered.output,clean.output);assert.equal(recovered.usage.physical,clean.usage.physical);assert.deepEqual(recovered.trace.run.budget.spent,clean.trace.run.budget.spent);assert.equal(recovered.reopens,1);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
