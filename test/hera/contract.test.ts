import {after,before,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openLocalClient} from '@jarenjs/contract/local';
import {applyJSONPatch} from '@jarenjs/json/patch';
import {projectMasPlan,type MasWorkflowPlan} from '@tangleai/mas';
import {createHeraContract,createHeraHandlers,heraContractDocument,type HeraReadStore} from '@tangleai/hera/contract';
import {createHeraLearner,createHeraExecutor,type HeraLearningResult,type HeraPromptVersion,type HeraSurfaceAgents,
  type HeraSurfaceExperiences,type HeraSurfacePromptHistory,type HeraSurfaceDiff,type HeraSurfaceGroup,
  type HeraSurfaceTrajectory,type HeraSurfaceMermaid,type HeraSurfaceMutations,type HeraSurfaceEvidence,type HeraRopeOutput} from '@tangleai/hera';
import {HERA_EXAMPLE_CONFIG} from '../../examples/hera.ts';
import {groupFixture,serialPlan,parallelPlan,budget} from './group-fixture.ts';
import {promptField,reflectScript} from './learning-fixture.ts';

const rule='Check the complete supporting path before concluding.';
async function reviewFixture(){
  let event=-1,mutated=false;
  const f=await groupFixture({config:{...HERA_EXAMPLE_CONFIG,flags:{experience:true,rope:true,mutation:true}},
    transformResult(node,request,value){
      if(node.id.startsWith('mutation-'))mutated=true;
      const win=event===0?(node.id!=='c'||JSON.stringify(request).includes(rule)):mutated;
      return node.role==='conclude-agent'&&!win?{...value,answer:'Wrong'}:value;
    },control(stage,_attempt,request){
      if(stage==='profile'){event++;mutated=false;return {text:'Find the director and school.',tags:['two-hop']};}
      if(stage.startsWith('plan/'))return [serialPlan,parallelPlan,serialPlan][Number(stage.split('/')[1])];
      if(stage==='learn/reflection')return reflectScript(request);
      if(stage==='learn/consolidation')return {ops:event===0
        ?[{op:'ADD',sourceInsightIds:['supported-path'],targetIds:[],text:'Retain a complete supporting evidence path.'}]
        :[{op:'KEEP',sourceInsightIds:[],targetIds:[]}]};
      if(stage==='mutation/proposal')return {action:'augment',addAgentId:'query-rewriter',dependsOn:['b'],reason:'Revisit the failed evidence boundary.'};
      if(stage==='learn/rope/proposal'){
        const failures=promptField(request,'Evaluated failures: ') as Array<{trajectoryId:string}>,derivedFrom=[event===0?failures.at(-1)!.trajectoryId:'unsupported'];
        return {operationalRules:[{text:rule,derivedFrom}],behavioralPrinciples:[],derivedFrom} satisfies HeraRopeOutput;
      }
      if(stage==='learn/rope/contrast'){
        const pair=(promptField(request,'Whole-run paired trials: ') as Array<{control:{id:string};replay:{id:string};operationalRules:Array<{text:string}>}>)[0],derivedFrom=[pair.control.id,pair.replay.id];
        return {operationalRules:pair.operationalRules.map(r=>({...r,derivedFrom})),behavioralPrinciples:[],derivedFrom};
      }
      throw Error('Unexpected control '+stage);
    }});
  try{
    const {host,request}=f.build(),results:HeraLearningResult[]=[];let snapshot=request.snapshot;
    for(let groupIndex=0;groupIndex<4;groupIndex++){
      const result=await createHeraLearner(host).run({...request,task:{...request.task,split:'training'},mode:'learn',snapshot,groupIndex,learningBudget:budget});
      assert.ok(result.valid,JSON.stringify(result));results.push(result.value);snapshot=result.value.snapshot;
    }
    assert.equal(results[0].librarySize,1);assert.equal(results[0].trials.activated,1);assert.equal(results[3].mutationIds.length,1);
    assert.equal((await host.store.getMutation(results[3].mutationIds[0]))!.decision,'accepted');
    const ids:string[]=[];
    for(const mode of ['evaluate','infer'] as const){
      const {goldAddress:_,...unlabelled}=request.task;
      const task=mode==='infer'?{...unlabelled,id:'unlabelled',split:'unlabelled' as const,evaluator:null}:request.task;
      const result=await createHeraExecutor(host).execute({...f.base.runtime.request,task,mode,snapshot,groupIndex:10+ids.length});
      assert.ok(result.valid,JSON.stringify(result));assert.equal(result.value.trajectory.primaryScore===null,mode==='infer');ids.push(result.value.trajectory.id);
    }
    return {...f,host,results,snapshot,ids};
  }catch(error){await f.close();throw error;}
}

describe('HERA read contract over retained learning evidence',()=>{
  let f:Awaited<ReturnType<typeof reviewFixture>>,writes:string[],client:ReturnType<typeof openLocalClient>;
  const seen=new Set<string>();
  async function read<T>(name:string,input:unknown):Promise<T>{
    seen.add(name);const result=await client.invoke('hera.'+name,input);assert.ok(result.ok,JSON.stringify(result));return result.value as T;
  }
  before(async()=>{
    f=await reviewFixture();writes=[];
    const store=new Proxy({...f.host.store},{get(target,key,receiver){
      if(typeof key==='string'&&(key.startsWith('put')||key==='transaction'||key==='transitionHead'))return ()=>{writes.push(key);throw Error('Read surface attempted '+key);};
      return Reflect.get(target,key,receiver);
    }});
    client=openLocalClient(createHeraContract(),createHeraHandlers({store}),{validateOutput:'always'});
  });
  after(async()=>{await f?.close();});
  it('dispatches every declared read across learn, evaluate and infer with no writes or purchases',async()=>{
    const counters=f.counters(),storeCounters=f.host.store.counters(),scope=f.host.store.scope;
    assert.equal(Object.keys(heraContractDocument.operations).length,14);
    assert.ok(Object.values(heraContractDocument.operations).every(op=>op.kind==='read'));
    const agents=await read<HeraSurfaceAgents>('agents.list',{}),conclude=agents.agents.find(a=>a.agent.id==='conclude-agent')!;
    assert.equal(conclude.head.versionId,f.snapshot.activePromptVersionIds['conclude-agent']);assert.equal(conclude.promptVersion!.id,conclude.head.versionId);
    assert.notEqual(conclude.agent.activePromptVersionId,conclude.head.versionId);
    await read('snapshots.list',{scope});await read('snapshots.get',{id:f.snapshot.id});
    const experiences=await read<HeraSurfaceExperiences>('experiences.list',{scope,status:'active',limit:100});
    assert.ok(experiences.experiences.length>0);
    const trace=async(source:HeraSurfaceEvidence)=>{
      assert.ok(source.trajectoryIds.length&&source.stepIds.length);
      const outputs=await Promise.all(source.trajectoryIds.map(id=>read<HeraSurfaceTrajectory>('trajectories.get',{id})));
      assert.ok(outputs.every(r=>r.trajectory.primaryScore!==null));
      assert.ok(source.stepIds.every(id=>outputs.some(r=>r.steps.some(s=>s.id===id))));
    };
    for(const entry of experiences.experiences){await read('experiences.get',{id:entry.experience.id});await trace(entry.source);
      for(const insight of entry.advantage.insights)await trace({trajectoryIds:insight.trajectoryIds,stepIds:insight.stepIds});}
    const history=await read<HeraSurfacePromptHistory>('prompts.history',{agentId:'conclude-agent'});
    const active=history.versions.find(p=>p.promptVersion.status==='active')!;assert.ok(active.rules.length);
    for(const entry of history.versions){await read('prompts.get',{id:entry.promptVersion.id});for(const r of entry.rules)await trace(r.source);}
    const diff=await read<HeraSurfaceDiff>('prompts.diff',{fromId:active.promptVersion.parentId,toId:active.promptVersion.id});
    const parent=history.versions.find(p=>p.promptVersion.id===active.promptVersion.parentId)!.promptVersion;
    const blocks=(p:HeraPromptVersion)=>({operationalRules:p.operationalRules,behavioralPrinciples:p.behavioralPrinciples});
    assert.deepEqual(applyJSONPatch(blocks(parent),diff.patch),blocks(active.promptVersion));assert.equal(diff.toLength,new TextEncoder().encode(active.promptVersion.effectivePrompt).length);
    for(const result of f.results){const detail=await read<HeraSurfaceGroup>('groups.get',{id:result.group.id});
      assert.ok(detail.stages.some(s=>s.stage==='learning.complete'&&s.state==='enabled'));
      assert.ok(detail.stages.every(s=>s.operationIds.every(id=>detail.operations.some(op=>op.id===id))));
      for(const id of result.group.ranking)await read('trajectories.get',{id});}
    await read('trials.list',{agentId:'conclude-agent'});
    const trial=(await f.host.store.getPromptTrial(f.results[0].promptTrialIds[0]))!;
    await read('trials.get',{id:trial.id});
    for(const id of [...f.ids,trial.replayTrajectoryId!]){
      const trajectory=await read<HeraSurfaceTrajectory>('trajectories.get',{id}),view=await read<HeraSurfaceMermaid>('trajectories.mermaid',{id});
      const retained=(await f.host.store.getOperation(trajectory.trajectory.masRunId+':plan'))!.value as {plan:MasWorkflowPlan};
      assert.deepEqual(view.executable,projectMasPlan(retained.plan));assert.match(view.roles.mermaid,/conclude-agent/);
      if(id===trial.replayTrajectoryId)assert.equal(view.roles.nodes.find(n=>n.roleId==='conclude-agent')!.promptVersionId,trial.candidatePromptVersionId);
    }
    const mutations=await read<HeraSurfaceMutations>('mutations.list',{scope});assert.equal(mutations.mutations[0].mutation.decision,'accepted');
    assert.equal(mutations.mutations[0].topology!.parentTopologyId,mutations.mutations[0].parentTopology.id);
    assert.equal(seen.size,14);assert.deepEqual(writes,[]);assert.deepEqual(f.counters(),counters);assert.deepEqual(f.host.store.counters(),storeCounters);
  });
  it('declares absent and foreign lookups and separates malformed input from broken handlers',async()=>{
    for(const [name,input] of [
      ['snapshots.get',{id:'missing'}],['experiences.get',{id:'missing'}],['prompts.get',{id:'missing'}],['prompts.history',{agentId:'missing'}],
      ['prompts.diff',{fromId:'missing',toId:'missing'}],['groups.get',{id:'missing'}],['trajectories.get',{id:'missing'}],['trajectories.mermaid',{id:'missing'}],
      ['trials.get',{id:'missing'}],['trials.list',{agentId:'missing'}],['snapshots.list',{scope:'foreign'}],['experiences.list',{scope:'foreign',limit:1}],['mutations.list',{scope:'foreign'}],
    ] as const){const result=await client.invoke('hera.'+name,input);assert.equal(result.ok,false);assert.match(JSON.stringify(result),/not-found/);}
    const malformed=await client.invoke('hera.experiences.list',{scope:f.host.store.scope,limit:-1});assert.equal(malformed.ok,false);assert.match(JSON.stringify(malformed),/JC2050/);
    const broken=openLocalClient(createHeraContract(),{...createHeraHandlers({store:f.host.store}),'hera.agents.list':()=>({invented:true})},{validateOutput:'always'});
    const result=await broken.invoke('hera.agents.list',{});assert.equal(result.ok,false);assert.match(JSON.stringify(result),/JC2070/);assert.deepEqual(writes,[]);
  });
  it('refuses missing provenance and legacy plans without reconstructing evidence',async()=>{
    const source=(await f.host.store.getExperience(f.snapshot.experienceIds[0]))!,trial=(await f.host.store.getPromptTrial(f.results[0].promptTrialIds[0]))!;
    for(const kind of ['advantage','trajectory','trajectoryStep','operation'] as const){
      const store:HeraReadStore={...f.host.store,get:async(k,id)=>k===kind?undefined:f.host.store.get(k,id)};
      const c=openLocalClient(createHeraContract(),createHeraHandlers({store}),{validateOutput:'always'});
      const result=await c.invoke(kind==='operation'?'hera.trajectories.mermaid':'hera.experiences.get',{id:kind==='operation'?trial.replayTrajectoryId:source.id});
      assert.equal(result.ok,false);assert.match(JSON.stringify(result),/not-found/);
    }
  });
  it('returns historical nested block edits as round-trippable RFC 6902 patches',async()=>{
    const from=(await f.host.store.getPromptVersion(f.snapshot.activePromptVersionIds['conclude-agent']))!,to=structuredClone(from);to.id='historical-edit';
    to.operationalRules[0].text+=' Verify café evidence.';to.behavioralPrinciples=[{...to.operationalRules[0]}];to.effectivePrompt+=' café';
    const store:HeraReadStore={...f.host.store,get:async(k,id)=>k==='promptVersion'&&id===to.id?to as never:f.host.store.get(k,id)};
    const c=openLocalClient(createHeraContract(),createHeraHandlers({store}),{validateOutput:'always'}),result=await c.invoke('hera.prompts.diff',{fromId:from.id,toId:to.id});
    assert.ok(result.ok,JSON.stringify(result));const diff=result.value as HeraSurfaceDiff;
    assert.ok(diff.patch.some(p=>p.path.endsWith('/text')));
    assert.deepEqual(applyJSONPatch({operationalRules:from.operationalRules,behavioralPrinciples:from.behavioralPrinciples},diff.patch),{operationalRules:to.operationalRules,behavioralPrinciples:to.behavioralPrinciples});
    assert.equal(diff.toLength-diff.fromLength,new TextEncoder().encode(' café').length);
  });
});

it('rejects removing an operation from the frozen read contract',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'hera-contract-'));
  try{
    const document=structuredClone(heraContractDocument);delete (document.operations as Record<string,unknown>)['hera.trajectories.get'];
    const path=join(dir,'removed.json');await writeFile(path,JSON.stringify(document));
    assert.throws(()=>execFileSync('node_modules/.bin/jaren-contract',['diff','--from','scripts/fixtures/hera-contract-v1.json','--to',path,'--fail-on','breaking'],{stdio:'pipe'}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
