/** Physical scoped keys only; generated HERA contracts own payload validation. */
const id = {type:'string',minLength:1};
const collection = {schema:{type:'object',required:['id','scope','payload'],properties:{id,scope:id,payload:{type:'object'}}},key:'/id',indexes:[{name:'by_scope_id',path:['$.scope','$.payload.id']}]};
export const HERA_COLLECTIONS = {
  hera_agents:collection,hera_prompt_versions:collection,hera_experiences:collection,
  hera_topologies:collection,hera_rollout_groups:collection,hera_trajectories:collection,
  hera_trajectory_steps:collection,hera_advantages:collection,hera_prompt_trials:collection,
  hera_snapshots:collection,hera_heads:collection,
};
