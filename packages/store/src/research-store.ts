import { cloneJson } from '@jarenjs/core/object';
import { createResearchStoreAdapter, type ResearchPersistence, type ResearchStore,
  type ResearchTransaction, type ResearchTable, type ResearchTables } from '@tangleai/research';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';
import { createRunLog } from './runs.ts';
import { createTrace2SkillDbStore } from './trace2skill-store.ts';

const names: Record<ResearchTable, string> = {
  projects: 'research_projects', records: 'research_records', artifacts: 'research_artifacts',
  attempts: 'research_attempts', state: 'research_state',
  lessons: 'research_lessons', lessonValidations: 'research_lesson_validations',
  lessonSets: 'research_lesson_sets', lessonInjections: 'research_lesson_injections',
};
const rowId = (scope: string, id: string) => JSON.stringify([scope, id]);
interface PhysicalRow { id: string; scope: string; payload: ResearchTables[ResearchTable] }
interface ProjectionBinding { id: string; scope: string; payload: { projectId: string; runLogId: string } }
export interface ResearchDbOptions { now?: () => string; applyProbe?: (step: string) => void }

/** The run-log association is explicit; a MAS run id is never a RunLog id. */
export async function researchRunLogId(db: Pick<TangleDb, 'collection'>, projectId: string): Promise<string | null> {
  const binding = await db.collection<ProjectionBinding>('research_state').get(rowId('@projection', projectId));
  if (binding === undefined) return null;
  if (binding.scope !== '@projection' || binding.payload.projectId !== projectId || typeof binding.payload.runLogId !== 'string')
    throw new TypeError('Invalid research run-log association.');
  return binding.payload.runLogId;
}

/** A caller-owned native transaction also owns every RunLog write and frame allocation. */
export function createResearchDbPersistence(db: TangleDb, options: ResearchDbOptions = {}): ResearchPersistence {
  const { now, applyProbe } = options;
  return { transaction: <T>(body: (view: ResearchTransaction) => Promise<T>) => db.transaction(async tx => {
    let active = true;
    const guard = () => { if (!active) throw new TypeError('Research transaction is no longer active.'); };
    const log = createRunLog(tx, { now });
    const nativeSkills = createTrace2SkillDbStore(tx, { applyProbe: step => { guard(); applyProbe?.('skill:' + step); } });
    async function runId(projectId: string) {
      const id = await researchRunLogId(tx, projectId);
      if (id === null) throw new TypeError('Project run-log association is missing.');
      return id;
    }
    const view: ResearchTransaction = {
      skills: {
        listCandidates: scope => { guard(); return nativeSkills.listBy(scope, 'candidates'); },
        listPatches: scope => { guard(); return nativeSkills.listBy(scope, 'patches'); },
        getBundle: id => { guard(); return nativeSkills.getBundle(id); },
        getSnapshot: id => { guard(); return nativeSkills.getSnapshot(id); },
        putSnapshot: snapshot => { guard(); return nativeSkills.putSnapshot(snapshot); },
        putStagedCandidate: (snapshot, candidate) => { guard(); return nativeSkills.putStagedCandidate(snapshot, candidate); },
        putPatch: patch => { guard(); return nativeSkills.putPatch(patch); },
      },
      async get<K extends ResearchTable>(table: K, scope: string, id: string) {
        guard();
        const row = await tx.collection<PhysicalRow>(names[table]).get(rowId(scope, id));
        if (row !== undefined && row.scope !== scope) throw new TypeError('Research payload row scope is corrupt.');
        return row === undefined ? undefined : cloneJson(row.payload) as ResearchTables[K];
      },
      async list<K extends ResearchTable>(table: K, scope: string) {
        guard();
        return cloneJson(asRows(await tx.collection<PhysicalRow>(names[table]).execute<ResearchTables[K]>({
          $for: { r: '$[*]' }, $where: { $eq: ['$r.scope', { $const: scope }] }, $orderby: ['$r.id'], $return: '$r.payload',
        })));
      },
      async scopes(table) {
        guard();
        return [...new Set(asRows(await tx.collection<PhysicalRow>(names[table]).execute<string>({
          $for: { r: '$[*]' }, $orderby: ['$r.scope'], $return: '$r.scope',
        })))];
      },
      async put(table, scope, id, payload) {
        guard();
        applyProbe?.('put:' + table);
        await tx.collection<PhysicalRow>(names[table]).put({ id: rowId(scope, id), scope, payload: cloneJson(payload) });
      },
      async createProjection(projectId) {
        guard();
        applyProbe?.('projection:create');
        if (await researchRunLogId(tx, projectId) !== null) throw new TypeError('Project already has a run-log association.');
        const run = await log.startRun('research');
        applyProbe?.('projection:bind');
        await tx.collection<ProjectionBinding>('research_state').put({ id: rowId('@projection', projectId), scope: '@projection',
          payload: { projectId, runLogId: run.id } });
      },
      async appendProjection(projectId, projection) {
        guard();
        applyProbe?.('projection:append');
        const outcome = await log.appendFrame(await runId(projectId), { kind: 'node', body: {
          node: projection.stage, status: projection.status, ms: projection.ms,
        } });
        if (!outcome.ok) throw Object.assign(new Error(outcome.reason), { code: outcome.code, path: '/runLog' });
      },
      async finishProjection(projectId, state, status) {
        guard();
        applyProbe?.('projection:finish');
        const outcome = await log.finishRun(await runId(projectId), status, { projectId, researchStatus: state.status });
        if (!outcome.ok) throw Object.assign(new Error(outcome.reason), { code: 'TDSK1002', path: '/runLog' });
      },
    };
    try { const result = await body(view); applyProbe?.('commit'); return result; }
    finally { active = false; }
  }, { mode: 'immediate' }) };
}
export function createResearchStore(db: TangleDb, options: ResearchDbOptions = {}): ResearchStore {
  return createResearchStoreAdapter(createResearchDbPersistence(db, options));
}
