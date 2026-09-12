import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
for(const maxRounds of [1,3])it(`debate orders every current stage and caps honestly at ${maxRounds}`,async()=>{
  const p=await prepareGmplPattern({pattern:'structured-debate',maxRounds}),stages:string[]=[];
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,i,phase,messages)=>{
    const result=fixture.script.result,c=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);
    if(phase==='completion'){
      stages.push(node);
      if(node.startsWith('position')){assert.equal(c.history.length,i-1);assert.ok(!Object.hasOwn(c,'positions'));}
      if(node.startsWith('rebuttal'))assert.equal(c.positions.length,2);
      if(node==='judge'){assert.equal(c.positions.length,2);assert.equal(c.rebuttals.length,2);}
    }
    return node.startsWith('position')?{result,stance:node}:node.startsWith('rebuttal')?{result,addresses:[result.findings[0].id]}:node==='judge'?{result,action:'continue'}:{result};
  }});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.usage.roles,5*maxRounds+1);assert.equal(d.usage.physical,2*(5*maxRounds+1));
  for(let i=0;i<maxRounds;i++){assert.deepEqual(stages.slice(i*5,i*5+2).sort(),['position-1','position-2']);assert.deepEqual(stages.slice(i*5+2,i*5+4).sort(),['rebuttal-1','rebuttal-2']);assert.equal(stages[i*5+4],'judge');}
  assert.equal(stages.at(-1),'synthesis');assert.deepEqual((d.output as {result:{findings:unknown}}).result.findings,fixture.script.result.findings);assert.equal((d.output as {result:{disposition:string}}).result.disposition,'no-consensus');
});
it('debate cannot accept supported contradictions or erase them at synthesis',async()=>{
  const p=await prepareGmplPattern({pattern:'structured-debate',maxRounds:1});
  for(const drop of [false,true]){
    const result={...fixture.script.result,findings:fixture.script.result.findings.map(f=>({...f,contradictory:true}))};
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('position')?{result,stance:node}:node.startsWith('rebuttal')?{result,addresses:[result.findings[0].id]}:node==='judge'?{result,action:'accept'}:{result:{...result,findings:drop?[]:result.findings}}});
    assert.equal(d.status,drop?'failed':'completed');if(drop)assert.match(d.trace.run.failure!.error.detail,/TGMPL1005/);else assert.equal((d.output as {result:{disposition:string}}).result.disposition,'no-consensus');
  }
});
for(const action of ['accept','reject','escalate'])it(`debate ${action} makes no next-round call`,async()=>{
  const p=await prepareGmplPattern({pattern:'structured-debate'}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('position')?{result,stance:node}:node.startsWith('rebuttal')?{result,addresses:[result.findings[0].id]}:node==='judge'?{result,action}:{result}});
  assert.equal(d.status,'completed');assert.equal(d.usage.roles,6);assert.equal((d.output as {result:{disposition:string}}).result.disposition,action==='accept'?'completed':'rejected');
});
