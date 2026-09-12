import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import type {GmplRoundState} from '@tangleai/gmpl';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
it('reviewers share the current immutable draft, without peer feedback, and acceptance skips revision',async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review'},'round'),drafts:string[]=[];
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,_i,phase,messages)=>{
    if(node.startsWith('reviewer')){
      if(phase==='completion'){const context=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);drafts.push(context.draftRevision);assert.ok(!Object.hasOwn(context,'reviews'));assert.equal(context.round,1);}
      return {result:fixture.script.result,assessment:'accept',issues:[],strengths:[]};
    }return {result:fixture.script.result};
  }});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(new Set(drafts).size,1);assert.equal(drafts.length,2);
  const s=(d.output as {state:GmplRoundState}).state;assert.deepEqual(s.acceptance,{accepted:2,ratio:1,total:2});assert.equal(s.disposition,'completed');assert.equal(s.draftRevision,s.reviewedRevision);assert.equal(d.visibility.filter(v=>v.node==='revision').length,0);assert.equal(d.usage.roles,3);
});
it('one accept and one minor revision require exactly one revision; the revised draft is not accepted',async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review'},'round');
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('reviewer')?{result:fixture.script.result,assessment:node==='reviewer-1'?'accept':'minor-revision',issues:[],strengths:[]}:{result:{...fixture.script.result,answer:node==='revision'?'Revised Wednesday':fixture.script.result.answer}}});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));const s=(d.output as {state:GmplRoundState}).state;
  assert.deepEqual(s.acceptance,{accepted:1,ratio:0.5,total:2});assert.equal(s.done,false);assert.equal(s.disposition,null);assert.equal(s.round,2);assert.notEqual(s.draftRevision,s.reviewedRevision);assert.equal(d.visibility.filter(v=>v.node==='revision'&&v.phase==='completion').length,1);
});
it('nested round messages retain both hierarchical endpoints',async()=>{
  const p=await prepareGmplPattern({pattern:'peer-review'},'round');
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node.startsWith('reviewer')?{result:fixture.script.result,assessment:'accept',issues:[],strengths:[]}:{result:fixture.script.result}});
  assert.equal(d.status,'completed');
  const messages=d.trace.messages.filter(m=>m.from.path.startsWith('round/'));
  assert.ok(messages.length>0);assert.ok(messages.every(m=>m.to.path.startsWith('round/')));
});
