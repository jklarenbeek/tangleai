import {it} from 'node:test';import assert from 'node:assert/strict';
import {applyConsolidationPlan,validateConsolidationPlan,heraContentIdOf,type HeraSemanticAdvantage,type HeraConsolidationContext,type HeraConsolidationOutput} from '@tangleai/hera';
import {fixture,scope,config} from './fixture.ts';
export async function consolidationFixture(){
  const f=await fixture();
  const content={scope,groupId:'g',successFactors:[],failureModes:[],insights:[{id:'i1',text:'Prefer the current dated source.',trajectoryIds:['success','failure'],stepIds:['step']}],failedInvocationCredit:[],promptVersionIds:[],sourceTrajectoryIds:['success','failure']};
  const advantage:HeraSemanticAdvantage={...content,id:await heraContentIdOf(content)};
  const entries=await Promise.all([{insight:'Use the old source.',useCount:4,successCount:1},{insight:'Use the current source.',useCount:6,successCount:5}].map(async changes=>{
    const value={...f.experience,...changes,utility:changes.successCount/changes.useCount};return {...value,id:await heraContentIdOf(value)};
  }));
  const context:HeraConsolidationContext={scope,config,profile:f.experience.profile,advantage,conflicts:[{targetIds:[entries[0].id,entries[1].id],sourceInsightIds:['i1'],reason:'The dated-source strategy conflicts with the superseded-source strategy in this registered case.'}]};
  const vector=(text:string)=>({text,embedding:[1,0],embeddedBy:f.experience.profile.embeddedBy});
  return {f,entries,context,vector};
}
it('ADD, MERGE, PRUNE and KEEP retain exact source, ancestry and count semantics',async()=>{
  const {entries,context,vector}=await consolidationFixture(),ids=entries.map(e=>e.id),before=structuredClone(entries);
  const add=await applyConsolidationPlan({ops:[{op:'ADD',sourceInsightIds:['i1'],targetIds:[],text:'Cite the current date.'}]},entries,context,{0:vector('Cite the current date.')});assert.ok(add.valid);
  assert.equal(add.value.library.length,3);assert.equal(add.value.created[0].useCount,0);assert.equal(add.value.created[0].utility,0);assert.equal(add.value.created[0].provenance.advantageId,context.advantage.id);
  const merge=await applyConsolidationPlan({ops:[{op:'MERGE',sourceInsightIds:['i1'],targetIds:ids,text:'Check source dates before answering.'}]},entries,context,{0:vector('Check source dates before answering.')});assert.ok(merge.valid);
  assert.equal(merge.value.library.length,1);assert.deepEqual(merge.value.created[0].inheritedCounts,{useCount:10,successCount:6});assert.equal(merge.value.created[0].utility,.6);assert.deepEqual(merge.value.created[0].parents,[...ids].sort());assert.equal(merge.value.archived.length,2);
  const prune=await applyConsolidationPlan({ops:[{op:'PRUNE',sourceInsightIds:['i1'],targetIds:ids}]},entries,context,{});assert.ok(prune.valid);assert.deepEqual(prune.value.library,[entries[1]]);assert.deepEqual(prune.value.archived,[entries[0]]);
  const keep=await applyConsolidationPlan({ops:[{op:'KEEP',sourceInsightIds:[],targetIds:ids}]},entries,context,{});assert.ok(keep.valid);assert.equal(keep.value.created.length,0);assert.equal(keep.value.archived.length,0);
  assert.deepEqual(entries,before);
});
it('every registered consolidation refusal has an exact content-boundary pointer',async()=>{
  const {entries,context}=await consolidationFixture(),ids=entries.map(e=>e.id);
  const cases:Array<{plan:HeraConsolidationOutput;path:string;context?:HeraConsolidationContext}>=[
    {plan:{ops:[{op:'ADD',sourceInsightIds:['foreign'],targetIds:[],text:'x'}]},path:'/ops/0/sourceInsightIds/0'},
    {plan:{ops:[{op:'KEEP',sourceInsightIds:[],targetIds:['unknown']}]},path:'/ops/0/targetIds/0'},
    {plan:{ops:[{op:'KEEP',sourceInsightIds:[],targetIds:[]},{op:'KEEP',sourceInsightIds:[],targetIds:[]}]},context:{...context,config:{...config,operationCap:1}},path:'/ops'},
    {plan:{ops:[{op:'ADD',sourceInsightIds:['i1'],targetIds:[],text:'x'}]},context:{...context,config:{...config,libraryCap:2}},path:'/ops'},
    {plan:{ops:[{op:'MERGE',sourceInsightIds:['i1'],targetIds:[ids[0]],text:'x'}]},path:'/ops/0/targetIds'},
    {plan:{ops:[{op:'PRUNE',sourceInsightIds:['i1'],targetIds:[ids[1],ids[0]]}]},path:'/ops/0/targetIds/0'},
    {plan:{ops:[{op:'PRUNE',sourceInsightIds:['i1'],targetIds:ids}]},context:{...context,conflicts:[]},path:'/ops/0/targetIds/0'},
    {plan:{ops:[{op:'KEEP',sourceInsightIds:[],targetIds:ids,text:'rewrite'}]},path:'/ops/0/text'},
  ];
  for(const item of cases){const result=validateConsolidationPlan(item.plan,entries,item.context??context);assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'THERA1008');assert.equal(result.issues[0].path,item.path);}}
});
it('merge refuses shared ancestry, missing provenance, foreign identities and unoffered targets',async()=>{
  const {entries,context}=await consolidationFixture(),parent=entries[0];
  const children=await Promise.all(['first','second'].map(async insight=>{const content={...parent,insight,parents:[parent.id],inheritedCounts:{useCount:parent.useCount,successCount:parent.successCount}};return {...content,id:await heraContentIdOf(content)};}));
  const plan={ops:[{op:'MERGE',sourceInsightIds:['i1'],targetIds:children.map(e=>e.id),text:'Combined guidance.'}]};
  for(const history of [[],[parent]]){const result=validateConsolidationPlan(plan,children,{...context,history});assert.equal(result.valid,false);if(!result.valid){assert.equal(result.issues[0].code,'THERA1008');assert.ok(result.issues[0].path.startsWith(history.length?'/ops/0/targetIds':'/history/'));}}
  const off=validateConsolidationPlan({ops:[{op:'KEEP',sourceInsightIds:[],targetIds:[parent.id]}]},entries,{...context,offeredTargetIds:[]});assert.equal(off.valid,false);if(!off.valid)assert.equal(off.issues[0].path,'/ops/0/targetIds/0');
  const foreign=validateConsolidationPlan({ops:[]},entries,{...context,profile:{...context.profile,embeddedBy:{model:'foreign',dims:2}}});assert.equal(foreign.valid,false);if(!foreign.valid)assert.equal(foreign.issues[0].path,'/library/0');
});
