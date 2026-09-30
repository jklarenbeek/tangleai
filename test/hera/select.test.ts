import {it} from 'node:test';import assert from 'node:assert/strict';
import {selectExperiences,heraContentIdOf,createMemoryHeraStore,readHeraFrozenLibrary,type HeraExperience} from '@tangleai/hera';
import {fixture,config,scope} from './fixture.ts';
async function library(){
  const f=await fixture(),base=f.experience;
  const values=[{name:'a',profile:[1,0],insight:[1,0]},{name:'b',profile:[.99,.1],insight:[1,0]},{name:'c',profile:[.8,.6],insight:[0,1]}];
  const entries=await Promise.all(values.map(async value=>{const content={...base,insight:value.name,profile:{...base.profile,embedding:value.profile},insightEmbedding:value.insight};return {...content,id:await heraContentIdOf(content)};}));
  return {entries,profile:base.profile,options:{...config,scope,selectorCap:2,selectorWeights:{similarity:1,utility:0,novelty:.5,selectionPenalty:0}}};
}
it('selects relevant diverse insights with hand-computed scores and writes no counters',async()=>{
  const {entries,profile,options}=await library(),before=structuredClone(entries),selected=selectExperiences(entries,profile,options);assert.ok(selected.valid);
  assert.deepEqual(selected.value.experiences.map(e=>e.insight),['a','c']);assert.deepEqual(selected.value.scores.map(s=>s.score),[1,.8]);assert.deepEqual(entries,before);
  assert.deepEqual(selectExperiences([...entries].reverse(),profile,options),selected);
});
it('a frozen library retains its pinned archived versions and ignores current unpinned entries',async()=>{
  const f=await fixture(),store=createMemoryHeraStore({scope}),archived={...f.experience,status:'archived' as const};
  assert.ok((await store.putExperience(archived,{scope,mode:'learn'})).valid);
  const loaded=await readHeraFrozenLibrary({store},{...f.snapshot,experienceIds:[archived.id]});
  assert.deepEqual(loaded.map(e=>e.id),[archived.id]);assert.equal(loaded[0].status,'active');
  assert.equal((await store.getExperience(archived.id))?.status,'archived');
});
it('repeated-selection penalty demotes the previously preferred insight',async()=>{
  const {entries,profile,options}=await library();entries[0].selectionCount=9;entries[0].id=await heraContentIdOf(entries[0]);
  const selected=selectExperiences(entries,profile,{...options,selectorCap:1,selectorWeights:{...options.selectorWeights,selectionPenalty:1}});assert.ok(selected.valid);assert.equal(selected.value.experiences[0].insight,'b');
});
it('identity, scope, selector version and malformed-vector refusals precede ranking',async()=>{
  const {entries,profile,options}=await library();
  const foreign=structuredClone(entries);foreign[0].profile.embeddedBy.model='different';
  const invalid=structuredClone(entries);invalid[0].insightEmbedding=[1];
  for(const [values,opts,code] of [[foreign,options,'THERA1009'],[invalid,options,'THERA1009'],[entries,{...options,scope:'foreign'},'THERA1004'],[entries,{...options,selectorVersion:'unknown'},'THERA1002']] as const){
    const result=selectExperiences(values,profile,opts);assert.equal(result.valid,false);if(!result.valid)assert.equal(result.issues[0].code,code);
  }
});
