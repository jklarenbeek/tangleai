/** Skill-evolution transactions use the shared Jaren store and native driver owner. */
import { createTrace2SkillStoreAdapter, trace2SkillRowId, trace2SkillRowScope, type Trace2SkillPersistence,
  type Trace2SkillStore, type Trace2SkillTable, type Trace2SkillTables, type Trace2SkillTransaction } from '@tangleai/trace2skill';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

const names: Record<Trace2SkillTable, string> = {
  bundles: 'skill_bundles', files: 'skill_files', heads: 'skill_heads',
  runs: 'trace2skill_runs', tasks: 'trace2skill_tasks', rollouts: 'trace2skill_rollouts',
  analyses: 'trace2skill_analyses', patches: 'trace2skill_patches', merges: 'trace2skill_merges',
  candidates: 'trace2skill_candidates', evaluations: 'trace2skill_evaluations',
};

interface PhysicalRow { id: string, scope: string, payload: Trace2SkillTables[Trace2SkillTable] }

export interface Trace2SkillDbOptions { applyProbe?: (step: string) => void }

export function createTrace2SkillDbPersistence(db: TangleDb, options: Trace2SkillDbOptions = {}): Trace2SkillPersistence {
  return { transaction: <T>(task: (view: Trace2SkillTransaction) => Promise<T>) => db.transaction(async tx => {
    const view: Trace2SkillTransaction = {
      async get<K extends Trace2SkillTable>(table: K, id: string) {
        const row = await tx.collection<PhysicalRow>(names[table]).get(id);
        return row?.payload as Trace2SkillTables[K] | undefined;
      },
      async list<K extends Trace2SkillTable>(table: K, scope: string) {
        return asRows(await tx.collection<PhysicalRow>(names[table]).execute<Trace2SkillTables[K]>({
          $for: { r: '$[*]' }, $where: { $eq: ['$r.scope', { $const: scope }] }, $orderby: ['$r.id'], $return: '$r.payload',
        }));
      },
      async scopes(table: Trace2SkillTable) {
        const rows = asRows(await tx.collection<PhysicalRow>(names[table]).execute<string>({
          $for: { r: '$[*]' }, $orderby: ['$r.scope'], $return: '$r.scope',
        }));
        return [...new Set(rows)];
      },
      async put<K extends Trace2SkillTable>(table: K, payload: Trace2SkillTables[K]) {
        await tx.collection<PhysicalRow>(names[table]).put({ id: trace2SkillRowId(table, payload), scope: trace2SkillRowScope(table, payload), payload });
        options.applyProbe?.(`put:${table}`);
      },
    };
    const result = await task(view);
    options.applyProbe?.('commit');
    return result;
  }, { mode: 'immediate' }) };
}

export function createTrace2SkillDbStore(db: TangleDb, options: Trace2SkillDbOptions = {}): Trace2SkillStore {
  return createTrace2SkillStoreAdapter(createTrace2SkillDbPersistence(db, options));
}
