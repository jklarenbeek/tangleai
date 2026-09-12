import {it} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGmplPattern} from '../../benchmark/lib/gmpl-patterns.ts';
import {driveGmplWorkflow} from '../../benchmark/lib/gmpl-runner.ts';
import type {GmplRoundState} from '@tangleai/gmpl';
import fixture from '../../benchmark/fixtures/gmpl/cases/minority-conflict-success.json' with {type:'json'};
it('red defense sees current attacks, judgment sees current defenses, and critical findings block acceptance',async()=>{
  const p=await prepareGmplPattern({pattern:'red-team',maxRounds:1},'round');
  const result={...fixture.script.result,findings:fixture.script.result.findings.map(f=>({...f,critical:true}))};let defenseSaw=false,judgeSaw=false;
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:(node,_i,phase,messages)=>{
    if(phase==='completion'&&(node.startsWith('defense')||node==='resilience-judge')){
      const c=JSON.parse(messages.find(m=>m.role==='user')!.content.split('Declared stage context:\n')[1]);assert.equal(c.round,1);assert.equal(c.attacks.length,1);
      if(node.startsWith('defense'))defenseSaw=true;else{assert.equal(c.defenses.length,1);judgeSaw=true;}
    }
    if(node.startsWith('attack'))return {result,strategy:'adversarial-reframing'};
    if(node.startsWith('defense'))return {result,mitigations:['Retain the risk in audit.']};
    if(node==='resilience-judge')return {result,resilience:0.95,action:'accept'};
    return {result};
  }});
  assert.equal(d.status,'completed',JSON.stringify(d.trace.run.failure));assert.ok(defenseSaw&&judgeSaw);
  const s=(d.output as {state:GmplRoundState}).state;assert.equal(s.disposition,'no-consensus');assert.equal(s.findings[0].critical,true);assert.equal(d.usage.roles,4);assert.equal(d.usage.physical,8);
});
it('a new supported defense finding cannot disappear from the judge output',async()=>{
  const p=await prepareGmplPattern({pattern:'red-team'},'round');
  const extra={...fixture.script.result.findings[0],id:'defense-new',origin:'defense-1',reason:'The defense discovered another supported concern.'};
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>{
    const result=fixture.script.result;
    if(node.startsWith('attack'))return {result,strategy:'adversarial-reframing'};
    if(node.startsWith('defense'))return {result:{...result,findings:[...result.findings,extra]},mitigations:[]};
    if(node==='resilience-judge')return {result,resilience:0.9,action:'accept'};
    return {result};
  }});
  assert.equal(d.status,'failed');assert.match(d.trace.run.failure!.error.detail,/TGMPL1005/);assert.equal(d.usage.physical,8);
});
it('a failed attacker stops the round and retains its request receipt',async()=>{
  const p=await prepareGmplPattern({pattern:'red-team'},'round');
  const d=await driveGmplWorkflow(p,{input:{input:fixture.input},bindings:p.bindings,response:node=>{if(node==='attack-1')throw Error('attacker unavailable');return {result:fixture.script.result};}});
  assert.equal(d.status,'failed');assert.equal(d.usage.physical,3);assert.equal(d.trace.run.budget.spent.turns,3);assert.ok(!d.visibility.some(v=>v.node.startsWith('defense')));
});
