import {it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
it('clear intent skips all human waits and answers once',async()=>{
  const p=await prepareGmplPattern({pattern:'clarification'}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>node==='inspect'?{result,resolved:true,refinedQuery:fixture.input.query}:{result}});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.trace.interactions.length,0);assert.equal(d.usage.roles,2);assert.equal(d.usage.physical,4);assert.deepEqual(d.output,{result});
});
it('two human responses survive SQLite reopen, enter evidence only after acceptance and resolve once',async()=>{
  const p=await prepareGmplPattern({pattern:'clarification'}),result=fixture.script.result,dir=await mkdtemp(join(tmpdir(),'gmpl-human-'));
  try{
    const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,databasePath:join(dir,'turns.sqlite'),reopenAfterResponse:true,humanResponses:[{answers:{q1:'First host clarification'}},{answers:{q1:'Second host clarification'}}],response:(node,i,phase,messages)=>{
      if(phase==='completion'){
        const user=messages.find(m=>m.role==='user')!.content;
        if(node==='inspect'||node==='question'&&i===1)assert.ok(!user.includes('First host clarification'));
        if(node==='resolve')assert.ok(user.includes('First host clarification'));
        if(node==='answer')assert.ok(user.includes('Second host clarification'));
      }
      if(node==='question')return {questions:[{id:'q1',text:'Which scope?'}]};
      if(node==='inspect'||node==='resolve')return {result,resolved:node==='resolve'&&i===2,refinedQuery:`Refined intent ${i}`};
      return {result};
    }});
    assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.responses,2);assert.equal(d.reopens,2);assert.equal(d.usage.roles,6);assert.equal(d.usage.physical,12);assert.deepEqual(d.output,{result});
    assert.equal(new Set(d.trace.interactions.map(i=>i.id)).size,2);assert.deepEqual(d.trace.interactions.map(i=>i.response),[{answers:{q1:'First host clarification'}},{answers:{q1:'Second host clarification'}}]);
    assert.ok(d.trace.interactions[0].path.includes('/1/'));assert.ok(d.trace.interactions[1].path.includes('/2/'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
for(const count of [1,2,3])it(`clarification binds exactly ${count} questions and stops without an answer at the turn cap`,async()=>{
  const p=await prepareGmplPattern({pattern:'clarification',maxTurns:1}),result=fixture.script.result,questions=Array.from({length:count},(_,i)=>({id:`q${i+1}`,text:`Clarify choice ${i+1}`}));
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,humanResponses:[{answers:Object.fromEntries(questions.map(q=>[q.id,'Still unclear']))}],response:node=>node==='question'?{questions}:{result,resolved:false,refinedQuery:'Unresolved intent'}});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.equal(d.usage.roles,3);assert.ok(!d.visibility.some(v=>v.node==='answer'));
  assert.deepEqual(d.output,{result:{...result,disposition:'needs-information',outstandingQuestions:questions.map(q=>q.id)}});
});
for(const response of [{answers:{q2:'Unasked'}},{answers:{q1:7}},{answers:{q1:'  '}},{answers:[{id:'q1',answer:'a'},{id:'q1',answer:'b'}]}])it('invalid or unasked human answers never enqueue a resume segment',async()=>{
  const p=await prepareGmplPattern({pattern:'clarification'}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,humanResponses:[response],response:node=>node==='question'?{questions:[{id:'q1',text:'Which scope?'}]}:{result,resolved:false,refinedQuery:fixture.input.query}});
  assert.equal(d.status,'waiting_for_input');assert.equal(d.trace.run.segment,0);assert.equal(d.responses,0);assert.equal(d.responseIssues[0].code,'TMAS2007');assert.equal(d.responseIssues[0].path,'/response');assert.equal(d.usage.roles,2);
});
for(const waitingResolution of ['cancelled','expired'] as const)it(`clarification ${waitingResolution} releases the wait without answer calls`,async()=>{
  const p=await prepareGmplPattern({pattern:'clarification'}),result=fixture.script.result;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,waitingResolution,response:node=>node==='question'?{questions:[{id:'q1',text:'Which scope?'}]}:{result,resolved:false,refinedQuery:fixture.input.query}});
  assert.equal(d.trace.interactions[0].status,waitingResolution);assert.equal(d.trace.run.segment,0);assert.equal(d.usage.roles,2);assert.equal(d.responses,0);
});
