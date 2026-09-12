import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
for(const action of ['accept','reject','escalate','continue'])it(`red team bounded ${action} follows current strategy and exact stop`,async()=>{
  const p=await prepareGmplPattern({pattern:'red-team'}),strategies:string[]=[];
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,_i,phase,messages)=>{
    const result=fixture.script.result;
    if(node.startsWith('attack')){const c=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);if(phase==='completion')strategies.push(c.strategy);return {result,strategy:c.strategy};}
    if(node.startsWith('defense'))return {result,mitigations:[]};
    return node==='resilience-judge'?{result,resilience:0.7,action}:{result};
  }});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.usage.roles,action==='continue'?10:4);
  assert.deepEqual(strategies,action==='continue'?['adversarial-reframing','edge-case-injection','assumption-challenge']:['adversarial-reframing']);
  assert.equal((d.output as {result:{disposition:string}}).result.disposition,action==='continue'?'no-consensus':action==='accept'?'completed':'rejected');
});
it('red team refuses an attack that changes its selected strategy',async()=>{
  const p=await prepareGmplPattern({pattern:'red-team'}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('attack')?{result,strategy:'foreign-strategy'}:node.startsWith('defense')?{result,mitigations:[]}:node==='resilience-judge'?{result,resilience:0.9,action:'accept'}:{result}});
  assert.equal(d.status,'failed');assert.match(d.trace.run.failure!.error.detail,/TGMPL1006/);assert.equal(d.usage.physical,4);
});
