import {it} from 'node:test';import assert from 'node:assert/strict';
import {recordApplications,mixedOutcome,type HeraRolloutGroup,type HeraTrajectory,type HeraTopology} from '@tangleai/hera';
import {fixture,scope} from './fixture.ts';
async function applications(successes:Array<boolean|null>,applied:boolean){
  const f=await fixture(),ids=successes.map((_,i)=>'t'+i),topologies=ids.map(id=>({id:'p'+id,scope,taskId:'q',snapshotId:f.snapshot.id,validation:{valid:true,issues:[]},offeredExperienceIds:[f.experience.id],appliedExperienceIds:applied?[f.experience.id]:[]} as unknown as HeraTopology));
  const trajectories=ids.map((id,i)=>({id,scope,taskId:'q',groupId:'group',snapshotId:f.snapshot.id,topologyId:topologies[i].id,primaryScore:successes[i]===null?null:Number(successes[i]),success:successes[i]} as unknown as HeraTrajectory));
  const group={id:'group',scope,taskId:'q',snapshotId:f.snapshot.id,offeredExperienceIds:[f.experience.id],candidateTrajectoryIds:ids} as HeraRolloutGroup;
  return {f,input:{group,trajectories,topologies}};
}
it('offered but unapplied guidance changes selection exposure without changing empirical utility',async()=>{
  const {f,input}=await applications([true,false],false),before=structuredClone(f.experience),result=await recordApplications(input,[f.experience]);assert.ok(result.valid);
  assert.equal(result.value.library[0].useCount,0);assert.equal(result.value.library[0].successCount,0);assert.equal(result.value.library[0].utility,0);assert.equal(result.value.library[0].selectionCount,1);
  assert.notEqual(result.value.library[0].id,f.experience.id);assert.deepEqual(f.experience,before);assert.deepEqual(result.value.library[0].parents,[f.experience.id]);
});
it('applications count exact successes and failures independently of the mixed-outcome gate',async()=>{
  for(const successes of [[true,true],[false,false],[true,false]]){
    const {f,input}=await applications(successes,true),result=await recordApplications(input,[f.experience]);assert.ok(result.valid);
    const entry=result.value.library[0];assert.equal(entry.useCount,2);assert.equal(entry.successCount,successes.filter(Boolean).length);assert.equal(entry.utility,entry.successCount/2);assert.equal(entry.selectionCount,1);
    assert.equal(mixedOutcome(input.trajectories).value,successes[0]!==successes[1]);
  }
});
it('unevaluated groups change no counter and cannot acquire a mixed outcome',async()=>{
  const {f,input}=await applications([null,null],true),result=await recordApplications(input,[f.experience]);assert.ok(result.valid);
  assert.deepEqual(result.value.library,[f.experience]);assert.deepEqual(result.value.updates,[]);assert.equal(mixedOutcome(input.trajectories).value,false);
});
it('foreign or incomplete applications are refused without changing the input library',async()=>{
  const {f,input}=await applications([true,false],true),before=structuredClone(f.experience);
  const wrong=structuredClone(input);wrong.topologies[0].appliedExperienceIds=['unknown'];assert.equal((await recordApplications(wrong,[f.experience])).valid,false);
  const incomplete={...input,trajectories:input.trajectories.slice(1)};assert.equal((await recordApplications(incomplete,[f.experience])).valid,false);
  const different=structuredClone(input);different.trajectories[0].taskId='another';assert.equal((await recordApplications(different,[f.experience])).valid,false);
  assert.deepEqual(f.experience,before);
});
