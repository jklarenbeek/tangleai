import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryHeraStore,assertTaskSplit,heraContentIdOf} from '@tangleai/hera';
import {fixture,scope,authority} from './fixture.ts';
it('the store refuses learning writes outside learn and across scope',async()=>{
  const f=await fixture(),store=createMemoryHeraStore({scope});
  for(const offered of [{...authority,mode:'evaluate' as const},{...authority,mode:'infer' as const},{...authority,scope:'foreign'}]){
    const result=await store.put('experience',f.experience,offered);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'THERA1004');
  }
  const foreign={...f.experience,scope:'foreign'};foreign.id=await heraContentIdOf(foreign);
  const result=await store.put('experience',foreign,authority);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,'THERA1004');
  assert.equal(store.counters().learningWrites,0);assert.equal((await store.listExperiences({scope})).length,0);
  for(const split of ['held-out','unlabelled'] as const){const r=assertTaskSplit({split},'learn');assert.equal(r.valid,false);if(!r.valid)assert.equal(r.issues[0].code,'THERA1004');}
  assert.ok(assertTaskSplit({split:'training'},'learn').valid);
});
