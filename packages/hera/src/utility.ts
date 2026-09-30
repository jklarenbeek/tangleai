/** Empirical applications create new immutable versions; selection is not success. */
import {heraContentIdOf} from './identity.ts';
import {validateHeraShape} from './schema.ts';
import {heraRefuse,type HeraOutcome} from './errors.ts';
import type {HeraExperience,HeraTrajectory,HeraTopology,HeraRolloutGroup} from './contracts.gen.ts';
export interface HeraApplicationPlan {
  library:HeraExperience[];
  updates:Array<{previous:HeraExperience;next:HeraExperience}>;
  evaluated:number;
}
export async function recordApplications(input:{group:HeraRolloutGroup;trajectories:readonly HeraTrajectory[];topologies:readonly HeraTopology[]},
  library:readonly HeraExperience[]):Promise<HeraOutcome<HeraApplicationPlan>> {
  const {group}=input,entries=new Map(library.map(e=>[e.id,e])),topologies=new Map(input.topologies.map(t=>[t.id,t]));
  if(entries.size!==library.length||library.some(e=>e.scope!==group.scope||e.status!=='active'))return heraRefuse('THERA1008','/library','Applications require one active scoped version per identity.');
  if(input.trajectories.length!==group.candidateTrajectoryIds.length||new Set(input.trajectories.map(t=>t.id)).size!==input.trajectories.length
    ||input.trajectories.some(t=>!group.candidateTrajectoryIds.includes(t.id)||t.scope!==group.scope||t.taskId!==group.taskId||t.groupId!==group.id||t.snapshotId!==group.snapshotId))
    return heraRefuse('THERA1008','/trajectories','The complete evaluated group must bind one scope and snapshot.');
  const offered=group.offeredExperienceIds??[];
  if(new Set(offered).size!==offered.length||offered.some(id=>!entries.has(id)))return heraRefuse('THERA1008','/offeredExperienceIds','An offered version is absent from the pinned library.');
  const evaluated=input.trajectories.filter(t=>t.primaryScore!==null),uses=new Map<string,{uses:number;successes:number}>();
  for(const trajectory of evaluated){
    const topology=topologies.get(trajectory.topologyId);
    if(!topology||topology.scope!==group.scope||topology.taskId!==group.taskId||topology.snapshotId!==group.snapshotId||!topology.validation.valid||typeof trajectory.success!=='boolean')
      return heraRefuse('THERA1008','/topologies','An evaluated trajectory must bind its valid topology and success rule.');
    if(new Set(topology.appliedExperienceIds).size!==topology.appliedExperienceIds.length)return heraRefuse('THERA1008','/appliedExperienceIds','An application cannot credit the same version twice.');
    for(const id of topology.appliedExperienceIds){
      if(!entries.has(id)||!offered.includes(id)||!topology.offeredExperienceIds.includes(id))return heraRefuse('THERA1008','/appliedExperienceIds','Application cannot credit an unoffered or unknown version.');
      const counts=uses.get(id)??{uses:0,successes:0};counts.uses++;counts.successes+=Number(trajectory.success);uses.set(id,counts);
    }
  }
  const updates:HeraApplicationPlan['updates']=[],next:HeraExperience[]=[];
  for(const entry of library){
    const shape=validateHeraShape<HeraExperience>('heraExperience',entry);if(!shape.valid)return shape;
    const counts=uses.get(entry.id),selection=evaluated.length>0&&offered.includes(entry.id)?1:0;
    if(!counts&&!selection){next.push(structuredClone(entry));continue;}
    const useCount=entry.useCount+(counts?.uses??0),successCount=entry.successCount+(counts?.successes??0);
    if(![useCount,successCount,entry.selectionCount+selection].every(Number.isSafeInteger))return heraRefuse('THERA1008','/counts','Application counts must remain exact integers.');
    const value={...structuredClone(entry),useCount,successCount,utility:useCount?successCount/useCount:0,selectionCount:entry.selectionCount+selection,
      parents:[entry.id],inheritedCounts:{useCount:entry.useCount,successCount:entry.successCount}};
    const record={...value,id:await heraContentIdOf(value)},checked=validateHeraShape<HeraExperience>('heraExperience',record);if(!checked.valid)return checked;
    updates.push({previous:structuredClone(entry),next:record});next.push(record);
  }
  return {valid:true,value:{library:next,updates,evaluated:evaluated.length}};
}
