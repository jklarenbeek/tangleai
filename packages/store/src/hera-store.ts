/** Scoped HERA records over immediate SQLite transactions and the shared domain gate. */
import { createHeraStoreAdapter, type HeraStore, type HeraPersistence, type HeraPersistenceView, type HeraRecords, type HeraRecordKind } from '@tangleai/hera';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
const names: Record<HeraRecordKind,string> = {operation:'hera_operations',agent:'hera_agents',promptVersion:'hera_prompt_versions',experience:'hera_experiences',topology:'hera_topologies',rolloutGroup:'hera_rollout_groups',trajectory:'hera_trajectories',trajectoryStep:'hera_trajectory_steps',advantage:'hera_advantages',promptTrial:'hera_prompt_trials',snapshot:'hera_snapshots',head:'hera_heads',failureBuffer:'hera_failure_buffers',mutation:'hera_mutations'};
export interface HeraStoreOptions { scope: string; applyProbe?: (step: string) => void; }
interface HeraStored<K extends HeraRecordKind> { id: string; scope: string; payload: HeraRecords[K]; }
/** Logical role ids may repeat across scopes; physical tuple keys cannot collide. */
export function createHeraStore(db: TangleDb, options: HeraStoreOptions): HeraStore {
  const key = (id: string) => JSON.stringify([options.scope,id]);
  const persistence: HeraPersistence = { transaction: <T>(fn: (view: HeraPersistenceView) => Promise<T>) => db.transaction(async tx => {
    const view: HeraPersistenceView = {
      async get(kind,id) { const row = await tx.collection<HeraStored<typeof kind>>(names[kind]).get(key(id)); return row?.payload; },
      async put(kind,payload) { await tx.collection<HeraStored<typeof kind>>(names[kind]).put({id:key(payload.id),scope:options.scope,payload}); options.applyProbe?.('put:' + kind); },
      async query(kind,q) {
        const where: unknown[] = [{$eq:['$r.scope',{$const:options.scope}]}];
        for (const field of ['scope','status','agentId','groupId','taskId'] as const) if (q[field] !== undefined) where.push({$eq:['$r.payload.' + field,{$const:q[field]}]});
        const query = {$for:{r:'$[*]'},$where:{$and:where},$orderby:'$r.payload.id',$return:'$r.payload'};
        return asRows(await tx.collection<HeraStored<typeof kind>>(names[kind]).execute<HeraRecords[typeof kind]>({$subsequence:[query,0,q.limit ?? 1000]}));
      },
    };
    const result = await fn(view); options.applyProbe?.('commit'); return result;
  }, {mode:'immediate'}) };
  return createHeraStoreAdapter(persistence,options.scope);
}
