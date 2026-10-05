import { cloneJson } from '@jarenjs/core/object';
import { createScheduler } from '@jarenjs/core/schedule';
import { createTrace2SkillStoreAdapter, trace2SkillRowId, trace2SkillRowScope,
  type Trace2SkillStore, type Trace2SkillTable, type Trace2SkillTables, type Trace2SkillTransaction } from '@tangleai/trace2skill';
import type { ArtifactAdmission, Intervention, LessonInjection, LessonSetRecord, LessonValidationRun, ResearchLessonV2,
  ResearchIssue, ResearchProject, ResearchState, StageArtifactDescriptor, StageAttemptKey, StageCommitReceipt } from './contracts.gen.ts';
import type { ResearchRecordEntry, ResearchRecordKind, ResearchRecordMap, ResearchRecordWrite } from './records.ts';
import type { AmendmentPlan, ContractFreezePlan, ProjectCreatePlan, ResearchProjection, StageCommitPlan, StateTransitionPlan } from './transitions.ts';
import { createResearchStoreAdapter } from './store-policy.ts';
import type { LessonStore } from './lessons/store.ts';

export type ResearchStoreOutcome<T> = { ok: true; value: T; replayed?: boolean } | { ok: false; issue: ResearchIssue };
export type { StageCommitReceipt } from './contracts.gen.ts';
export interface ResearchSnapshot {
  project: ResearchProject;
  state: ResearchState;
  records: ResearchRecordEntry[];
  artifacts: ArtifactAdmission[];
  attempts: StageCommitReceipt[];
  committedAdmissionIds: string[];
}
export interface ResearchStore {
  readonly lessons: LessonStore;
  createProject(plan: ProjectCreatePlan): Promise<ResearchStoreOutcome<ResearchState>>;
  getProject(projectId: string): Promise<ResearchStoreOutcome<ResearchProject | null>>;
  getState(projectId: string): Promise<ResearchStoreOutcome<ResearchState | null>>;
  putRecord(projectId: string, record: ResearchRecordWrite): Promise<ResearchStoreOutcome<ResearchRecordEntry>>;
  getRecord<K extends ResearchRecordKind>(projectId: string, kind: K, id: string): Promise<ResearchStoreOutcome<ResearchRecordMap[K] | null>>;
  listRecords<K extends ResearchRecordKind>(projectId: string, kind: K): Promise<ResearchStoreOutcome<ResearchRecordMap[K][]>>;
  stageArtifact(bytes: Uint8Array, descriptor: StageArtifactDescriptor): Promise<ResearchStoreOutcome<ArtifactAdmission>>;
  readArtifact(projectId: string, admissionId: string): Promise<ResearchStoreOutcome<{ admission: ArtifactAdmission; bytes: Uint8Array }>>;
  commitStage(plan: StageCommitPlan): Promise<ResearchStoreOutcome<StageCommitReceipt>>;
  transition(plan: StateTransitionPlan): Promise<ResearchStoreOutcome<ResearchState>>;
  /** Reconcile an attributed native cancellation into one atomic domain receipt. */
  stopWithIntervention(plan: { expectedState: ResearchState; intervention: Intervention }): Promise<ResearchStoreOutcome<ResearchState>>;
  freezeContract(plan: ContractFreezePlan): Promise<ResearchStoreOutcome<ResearchState>>;
  amendContract(plan: AmendmentPlan): Promise<ResearchStoreOutcome<ResearchState>>;
  getAttempt(projectId: string, attemptId: string): Promise<ResearchStoreOutcome<StageCommitReceipt | null>>;
  collectUnreferenced(projectId: string, before: Pick<StageAttemptKey, 'stage' | 'attemptOrdinal'>): Promise<ResearchStoreOutcome<ArtifactAdmission[]>>;
  snapshot(projectId: string): Promise<ResearchStoreOutcome<ResearchSnapshot | null>>;
}

/** Physical payloads are small projections; the shared policy validates their records. */
export interface ResearchTables {
  projects: ResearchProject;
  records: ResearchRecordEntry;
  artifacts: { kind: 'blob'; id: string; data: number[] } | { kind: 'admission'; admission: ArtifactAdmission };
  attempts: StageCommitReceipt;
  state: ResearchState;
  lessons: ResearchLessonV2;
  lessonValidations: LessonValidationRun;
  lessonSets: LessonSetRecord;
  lessonInjections: LessonInjection;
}
export type ResearchTable = keyof ResearchTables;
/** No skill head or activation operation is available to a research transaction. */
export type ResearchSkillStore = Pick<Trace2SkillStore, 'getBundle' | 'getSnapshot' | 'putSnapshot' | 'putStagedCandidate' | 'putPatch'> & {
  listCandidates(scope: string): Promise<Trace2SkillTables['candidates'][]>;
  listPatches(scope: string): Promise<Trace2SkillTables['patches'][]>;
};
export interface ResearchTransaction {
  readonly skills: ResearchSkillStore;
  get<K extends ResearchTable>(table: K, scope: string, id: string): Promise<ResearchTables[K] | undefined>;
  list<K extends ResearchTable>(table: K, scope: string): Promise<ResearchTables[K][]>;
  scopes(table: ResearchTable): Promise<string[]>;
  put<K extends ResearchTable>(table: K, scope: string, id: string, value: ResearchTables[K]): Promise<void>;
  createProjection(projectId: string): Promise<void>;
  appendProjection(projectId: string, projection: ResearchProjection): Promise<void>;
  finishProjection(projectId: string, state: ResearchState, status: ResearchProjection['status']): Promise<void>;
}
export interface ResearchPersistence {
  transaction<T>(body: (tx: ResearchTransaction) => Promise<T>): Promise<T>;
}
export interface ResearchPhysicalRow {
  table: ResearchTable;
  scope: string;
  id: string;
  payload: ResearchTables[ResearchTable];
}
export interface ResearchMemoryState {
  rows: ResearchPhysicalRow[];
  skillRows?: Array<{ table: Trace2SkillTable; id: string; payload: Trace2SkillTables[Trace2SkillTable] }>;
  projections: Array<{ projectId: string; frames: ResearchProjection[]; terminal: { state: ResearchState; status: ResearchProjection['status'] } | null }>;
}
export interface ResearchMemoryOptions { state?: ResearchMemoryState; applyProbe?: (step: string) => void }

/** One native scheduler serializes staged snapshots; a refused scope publishes nothing. */
export function createMemoryResearchPersistence(options: ResearchMemoryOptions = {}): ResearchPersistence & {
  exportState(): ResearchMemoryState;
  close(): Promise<void>;
} {
  const key = (table: ResearchTable, scope: string, id: string) => JSON.stringify([table, scope, id]);
  let rows = new Map((options.state?.rows ?? []).map(row => [key(row.table, row.scope, row.id), cloneJson(row)]));
  let projections = new Map((options.state?.projections ?? []).map(row => [row.projectId, cloneJson(row)]));
  const skillKey = (table: Trace2SkillTable, id: string) => JSON.stringify([table, id]);
  let skillRows = new Map((options.state?.skillRows ?? []).map(row => [skillKey(row.table, row.id), cloneJson(row)]));
  const scheduler = createScheduler({ concurrency: 1, maxQueue: 64 });
  return {
    exportState: () => cloneJson({ rows: [...rows.values()], projections: [...projections.values()], skillRows: [...skillRows.values()] }),
    close: () => scheduler.close(),
    transaction<T>(body: (tx: ResearchTransaction) => Promise<T>): Promise<T> {
      return scheduler.run(async () => {
        const staged = new Map(rows), projected = new Map([...projections].map(([id, value]) => [id, cloneJson(value)]));
        const stagedSkills = new Map(skillRows);
        let active = true;
        const guard = () => { if (!active) throw new TypeError('Research transaction is no longer active.'); };
        const skillView: Trace2SkillTransaction = {
          async get<K extends Trace2SkillTable>(table: K, id: string) {
            guard(); const row = stagedSkills.get(skillKey(table, id));
            return row === undefined ? undefined : cloneJson(row.payload) as Trace2SkillTables[K];
          },
          async list<K extends Trace2SkillTable>(table: K, scope: string) {
            guard(); return [...stagedSkills.values()].filter(row => row.table === table && trace2SkillRowScope(table, row.payload as Trace2SkillTables[K]) === scope)
              .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => cloneJson(row.payload) as Trace2SkillTables[K]);
          },
          async scopes(table) {
            guard(); return [...new Set([...stagedSkills.values()].filter(row => row.table === table)
              .map(row => trace2SkillRowScope(table, row.payload)))].sort();
          },
          async put(table, payload) {
            guard(); options.applyProbe?.('skill:put:' + table);
            const id = trace2SkillRowId(table, payload);
            stagedSkills.set(skillKey(table, id), cloneJson({ table, id, payload }));
          },
        };
        const nativeSkills = createTrace2SkillStoreAdapter({ transaction: async body => { guard(); return body(skillView); } });
        const skills: ResearchSkillStore = { getBundle: nativeSkills.getBundle, getSnapshot: nativeSkills.getSnapshot,
          listCandidates: scope => nativeSkills.listBy(scope, 'candidates'), listPatches: scope => nativeSkills.listBy(scope, 'patches'),
          putSnapshot: nativeSkills.putSnapshot, putStagedCandidate: nativeSkills.putStagedCandidate, putPatch: nativeSkills.putPatch };
        try {
          const result = await body({
            skills,
            async get<K extends ResearchTable>(table: K, scope: string, id: string) {
              guard(); const row = staged.get(key(table, scope, id));
              return row === undefined ? undefined : cloneJson(row.payload) as ResearchTables[K];
            },
            async list<K extends ResearchTable>(table: K, scope: string) {
              guard(); return [...staged.values()].filter(row => row.table === table && row.scope === scope)
                .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => cloneJson(row.payload) as ResearchTables[K]);
            },
            async scopes(table) { guard(); return [...new Set([...staged.values()].filter(row => row.table === table).map(row => row.scope))].sort(); },
            async put(table, scope, id, payload) {
              guard(); options.applyProbe?.('put:' + table);
              staged.set(key(table, scope, id), cloneJson({ table, scope, id, payload }));
            },
            async createProjection(projectId) {
              guard(); options.applyProbe?.('projection:create');
              if (projected.has(projectId)) throw new Error('Project projection already exists.');
              options.applyProbe?.('projection:bind');
              projected.set(projectId, { projectId, frames: [], terminal: null });
            },
            async appendProjection(projectId, projection) {
              guard(); options.applyProbe?.('projection:append');
              const row = projected.get(projectId);
              if (!row || row.terminal !== null) throw new Error('Project projection is absent or terminal.');
              row.frames.push(cloneJson(projection));
            },
            async finishProjection(projectId, state, status) {
              guard(); options.applyProbe?.('projection:finish');
              const row = projected.get(projectId);
              if (!row || row.terminal !== null) throw new Error('Project projection is absent or terminal.');
              row.terminal = cloneJson({ state, status });
            },
          });
          options.applyProbe?.('commit'); rows = staged; projections = projected; skillRows = stagedSkills; return result;
        } finally { active = false; }
      });
    },
  };
}
export function createMemoryResearchStore(options: ResearchMemoryOptions = {}): ResearchStore {
  return createResearchStoreAdapter(createMemoryResearchPersistence(options));
}
export { createResearchStoreAdapter } from './store-policy.ts';
