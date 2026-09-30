import {it} from 'node:test';
import assert from 'node:assert/strict';
import {emptyHeraHead,planHeraHeadTransition,createMemoryHeraStore,planSnapshotActivation,planPromptActivation} from '@tangleai/hera';
import {authority,scope,fixture} from './fixture.ts';
it('heads refuse a stale revision token after A→B→A',async()=>{
  const store=createMemoryHeraStore({scope});let head=emptyHeraHead(scope,'library');
  let stale=head;
  for(const [index,target] of ['a','b','a'].entries()){
    const plan=planHeraHeadTransition(head,head,target.repeat(64));assert.ok(plan.valid);
    const result=await store.transitionHead(plan.value,authority);assert.ok(result.valid);head=result.value;if(index===0)stale=structuredClone(head);
  }
  const refused=planHeraHeadTransition(head,stale,'b'.repeat(64));assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'THERA1006');
  const forged=planHeraHeadTransition(stale,stale,'b'.repeat(64));assert.ok(forged.valid);
  const stored=await store.transitionHead(forged.value,authority);assert.equal(stored.valid,false);if(!stored.valid)assert.equal(stored.issues[0].code,'THERA1006');
  assert.deepEqual(await store.readHead(head.id),head);
  const bypass=await Reflect.apply(store.put,store,['head',{...head,revision:0},authority]);
  assert.equal(bypass.valid,false);assert.equal(bypass.issues[0].code,'THERA1006');
  assert.deepEqual(await store.readHead(head.id),head);
});
it('a losing snapshot writer cannot reactivate a staged parent with an old fence',async()=>{
  const f=await fixture(),store=createMemoryHeraStore({scope}),head=emptyHeraHead(scope,'snapshot');
  for(const agent of f.agents)assert.ok((await store.put('agent',agent,authority)).valid);
  for(const prompt of f.prompts){
    assert.ok((await store.put('promptVersion',prompt,authority)).valid);
    const initial=emptyHeraHead(scope,'prompt',prompt.agentId),plan=planPromptActivation(initial,initial,prompt);assert.ok(plan.valid);
    assert.ok((await store.transitionHead(plan.value,authority)).valid);
  }
  assert.ok((await store.put('snapshot',f.snapshot,authority)).valid);
  const plan=planSnapshotActivation(head,head,f.snapshot);assert.ok(plan.valid);
  assert.ok((await store.transitionHead(plan.value,authority)).valid);
  const refused=await store.transitionHead(plan.value,authority);assert.equal(refused.valid,false);if(!refused.valid)assert.equal(refused.issues[0].code,'THERA1006');
});
