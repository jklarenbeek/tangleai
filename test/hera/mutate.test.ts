import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {applyMutation,createHeraLearner,emptyHeraHead,heraProfileBucket,HERA_RECORD_KINDS,isHeraLearningKind,type HeraLearningRequest,type HeraMutationProposal,type HeraStore} from '@tangleai/hera';
import {HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {topologyFixture,groupBudget} from './topology.test.ts';
import {groupFixture,serialPlan,budget} from './group-fixture.ts';
const config={...HERA_EXAMPLE_CONFIG,flags:{experience:false,rope:false,mutation:true}};
const augment:HeraMutationProposal={action:'augment',addAgentId:'query-rewriter',dependsOn:['b'],reason:'Revisit the failed evidence boundary.'};
async function mutationFixture(options:{win?:boolean;proposal?:unknown;path?:string}={}){
  let changed=false;
  return groupFixture({path:options.path,config,transformResult(node,_request,value){
    if(node.id.startsWith('mutation-'))changed=true;
    return node.role==='conclude-agent'&&!(changed&&options.win)?{...value,answer:'Wrong'}:value;
  },control(stage){
    if(stage==='profile'){changed=false;return {text:'Find the director and school.',tags:['two-hop']};}
    if(stage.startsWith('plan/'))return serialPlan;
    if(stage==='mutation/proposal')return options.proposal??augment;
    throw Error('Unexpected control '+stage);
  }});
}
const learning=(request:ReturnType<Awaited<ReturnType<typeof mutationFixture>>['build']>['request']):HeraLearningRequest=>({...request,task:{...request.task,split:'training'},mode:'learn',learningBudget:budget});
async function threshold(f:Awaited<ReturnType<typeof mutationFixture>>){const {host,request}=f.build();let input=learning(request);
  for(let index=0;index<2;index++){input={...input,groupIndex:index};const result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));assert.deepEqual(result.value.mutationIds,[]);input.snapshot=result.value.snapshot;}
  return {host,input:{...input,groupIndex:2}};
}
test('replace and augment preserve graph ownership and refuse invented roles or tools before execution',async()=>{
  const f=await topologyFixture(),credit=[{trajectoryId:'failed',invocationId:'b',stepIds:['step']}];
  const next=applyMutation(f.topology,augment,credit,f.snapshot,f,groupBudget,'new');assert.ok(next.valid,JSON.stringify(next));
  assert.equal(next.value.parentTopologyId,f.topology.id);assert.equal(next.value.generator.kind,'mutation');assert.deepEqual(next.value.nodes.find(n=>n.id==='c')!.dependsOn,['new']);
  const replaced=applyMutation(f.topology,{...augment,action:'replace',removeInvocationId:'b',dependsOn:['a']},credit,f.snapshot,f,groupBudget,'replacement');assert.ok(replaced.valid,JSON.stringify(replaced));assert.equal(replaced.value.nodes.length,3);
  for(const proposal of [{...augment,addAgentId:'invented'},{...augment,tools:['shell']},{...augment,dependsOn:['c']},{...augment,action:'replace',removeInvocationId:'a',dependsOn:[]},{...augment,addAgentId:'retriever'}]){
    const result=applyMutation(f.topology,proposal as HeraMutationProposal,credit,f.snapshot,f,groupBudget,'new');assert.equal(result.valid,false,JSON.stringify(proposal));if(!result.valid)assert.equal(result.issues[0].code,'THERA1003');
  }
  const forbidden=structuredClone(f.topology);forbidden.nodes[1].tools=['shell'];assert.equal(applyMutation(forbidden,augment,credit,f.snapshot,f,groupBudget,'new').valid,false);
});
test('the threshold mutation rejoins its original group, activates only a measured improvement and reopens without purchases',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-mutation-')),f=await mutationFixture({win:true,path:join(dir,'db.sqlite')});try{
    let {host,input}=await threshold(f);const before=f.counters(),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.mutationIds.length,1);
    const mutation=(await host.store.getMutation(result.value.mutationIds[0]))!,trajectory=(await host.store.getTrajectory(mutation.candidateTrajectoryId!))!,topology=(await host.store.getTopology(mutation.candidateTopologyId!))!;
    assert.equal(mutation.decision,'accepted',JSON.stringify({mutation,trajectory}));assert.equal(mutation.controlScore,0);assert.equal(mutation.candidateScore,1);assert.equal(mutation.spent.calls,10);
    assert.equal(trajectory.groupId,result.value.group.id);assert.equal(trajectory.snapshotId,input.snapshot.id);assert.equal(result.value.group.ranking[0],trajectory.id);assert.equal(result.value.group.mixedOutcome.value,true);
    const control=(await host.store.getTrajectory(mutation.controlTrajectoryId))!,original=(await host.masStore.getRun(control.masRunId))!,candidate=(await host.masStore.getRun(trajectory.masRunId))!;
    assert.deepEqual((candidate.input as {evidence:unknown}).evidence,(original.input as {evidence:unknown}).evidence);assert.deepEqual(candidate.budget.limits,original.budget.limits);
    assert.equal(topology.nodes.length,4);assert.deepEqual(Object.fromEntries(topology.nodes.map(n=>[n.agentId,n.promptVersionId])),Object.fromEntries(topology.nodes.map(n=>[n.agentId,input.snapshot.activePromptVersionIds[n.agentId]])));
    assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls-before.calls-before.controls);
    const bucket=await heraProfileBucket(result.value.group.profile!);assert.equal(result.value.snapshot.preferredTopologyIds![bucket],topology.id);assert.equal(result.value.snapshot.failureState!.buckets[bucket].zeroStreak,0);
    assert.deepEqual(result.value.snapshot.activePromptVersionIds,input.snapshot.activePromptVersionIds);
    const counters=f.counters();await f.base.reopen();host=f.build().host;assert.deepEqual(await createHeraLearner(host).run(input),result);assert.deepEqual(f.counters(),counters);
    const again=await createHeraLearner(host).run({...input,snapshot:result.value.snapshot,groupIndex:3});assert.ok(again.valid,JSON.stringify(again));assert.deepEqual(again.value.mutationIds,[]);
    const offered=f.controlRequests.filter(r=>r.stage==='plan/0').at(-1)!;assert.match(JSON.stringify(offered.request),/mutation-/);
  }finally{await f.close();await rm(dir,{recursive:true,force:true});}
});
test('losing, invalid and unfunded mutations retain exact spend and cannot install a topology hint',async()=>{
  for(const variant of ['losing','invalid','unfunded'] as const){const f=await mutationFixture({proposal:variant==='invalid'?{...augment,addAgentId:'invented'}:augment});try{
    const {host,input}=await threshold(f),before=f.counters(),result=await createHeraLearner(host).run({...input,...(variant==='unfunded'?{learningBudget:{...budget,calls:1}}:{})});assert.ok(result.valid,JSON.stringify(result));
    const mutation=(await host.store.getMutation(result.value.mutationIds[0]))!;assert.equal(mutation.decision,variant==='losing'?'rejected':variant==='invalid'?'invalid':'unevaluated',JSON.stringify(mutation));
    assert.equal(result.value.snapshot.preferredTopologyIds,undefined);assert.equal(mutation.spent.calls,variant==='losing'?10:variant==='invalid'?2:1);
    assert.equal(result.value.spent.calls,f.counters().calls+f.counters().controls-before.calls-before.controls);
    if(variant==='invalid')assert.equal(mutation.validation.issues[0].code,'THERA1003');if(variant!=='losing')assert.equal(mutation.candidateTrajectoryId,null);
    const counters=f.counters(),repeat=await createHeraLearner(host).run({...input,...(variant==='unfunded'?{learningBudget:{...budget,calls:1}}:{})});assert.deepEqual(repeat,result);assert.deepEqual(f.counters(),counters);
    const after=await createHeraLearner(host).run({...input,snapshot:result.value.snapshot,groupIndex:3});assert.ok(after.valid,JSON.stringify(after));assert.deepEqual(after.value.mutationIds,[]);
  }finally{await f.close();}}
});
test('a final transaction crash preserves the old snapshot and reuses the measured mutation',async()=>{
  const f=await mutationFixture({win:true});try{const {host,input}=await threshold(f);
    const state=async()=>Object.fromEntries(await Promise.all(HERA_RECORD_KINDS.filter(isHeraLearningKind).map(async kind=>[kind,await host.store.query(kind,{limit:10000})]))),before=await state();
    const interrupted={...host,store:{...host.store,transaction:((authority,fn)=>host.store.transaction(authority,tx=>fn({...tx,put:async(kind,value)=>{if(kind==='operation'&&'stage' in value&&value.stage==='learning.complete')throw Error('Mutation activation interrupted');return tx.put(kind,value);}}))) as HeraStore['transaction']}};
    await assert.rejects(createHeraLearner(interrupted).run(input),/Mutation activation interrupted/);assert.deepEqual(await state(),before);
    assert.equal((await host.store.readHead(emptyHeraHead(host.store.scope,'snapshot').id))!.versionId,input.snapshot.id);
    const calls=f.counters(),result=await createHeraLearner(host).run(input);assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.mutationIds.length,1);assert.deepEqual(f.counters(),calls);
  }finally{await f.close();}
});
