import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
function inputContext(messages:Array<{role:string;content:string}>){const user=messages.find(m=>m.role==='user')!.content;return JSON.parse(user.split('Declared stage context:\n')[1]);}
it('analysis overlaps independent analysts, reverse settlement retains declared ordering',async()=>{
  const p=await prepareGmplPattern();const waiting=new Map<string,()=>void>();const settled:string[]=[];let ordered:unknown;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,
    beforeCall:async(node,_i,phase)=>{if(!node.startsWith('analyst-')||phase!=='completion')return;await new Promise<void>(resolve=>{waiting.set(node,resolve);if(waiting.size===2)queueMicrotask(()=>{waiting.get('analyst-2')!();waiting.get('analyst-1')!();});});settled.push(node);},
    response:(node,_i,phase,messages)=>{
      if(phase==='completion'){
        const context=inputContext(messages);
        if(node.startsWith('analyst')){assert.deepEqual(context,{participant:node});assert.ok(!messages.some(m=>m.content.includes('"oracle"')));}
        else ordered=context.reports.map((r:{result:{answer:string}})=>r.result.answer);
      }
      return {result:{...fixture.script.result,answer:node.startsWith('analyst')?node:fixture.script.result.answer}};
    }});
  assert.equal(d.status,'completed');assert.deepEqual(settled,['analyst-2','analyst-1']);assert.deepEqual(ordered,['analyst-1','analyst-2']);assert.equal(d.usage.roles,3);assert.equal(d.usage.physical,6);
});
it('analysis respects a serialized host and fails visibly on a missing member',async()=>{
  const p=await prepareGmplPattern({pattern:'parallel-analysis',caps:{concurrency:1}});
  const good=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:()=>({result:fixture.script.result})});assert.equal(good.status,'completed');
  assert.ok(good.events.indexOf('analyst-1:completed')<good.events.indexOf('analyst-2:enter'));
  const failed=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>{if(node==='analyst-2')throw Error('missing analyst');return {result:fixture.script.result};}});
  assert.equal(failed.status,'failed');assert.equal(failed.usage.physical,3);assert.equal(failed.trace.run.budget.spent.turns,3);assert.equal(failed.trace.attempts.filter(a=>a.kind==='agent'&&a.status==='failed').length,1);assert.ok(!failed.visibility.some(v=>v.node==='synthesis'));
});
it('analysis synthesis cannot silently remove supported minority findings',async()=>{
  const p=await prepareGmplPattern();const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>({result:{...fixture.script.result,findings:node==='synthesis'?[]:fixture.script.result.findings}})});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,6);assert.match(d.trace.run.failure!.error.detail,/TGMPL1005/);
});
