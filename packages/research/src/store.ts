import { cloneJson } from '@jarenjs/core/object';
import { createScheduler } from '@jarenjs/core/schedule';
import type { ArtifactAdmission, Intervention, ResearchIssue, ResearchProject, ResearchState, StageArtifactDescriptor, StageAttemptKey, StageCommitReceipt } from './contracts.gen.ts';
import type { ResearchRecordEntry, ResearchRecordKind, ResearchRecordMap, ResearchRecordWrite } from './records.ts';
import type { AmendmentPlan, ContractFreezePlan, ProjectCreatePlan, ResearchProjection, StageCommitPlan, StateTransitionPlan } from './transitions.ts';
import { createResearchStoreAdapter } from './store-policy.ts';

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
}
export type ResearchTable = keyof ResearchTables;
export interface ResearchTransaction {
  get<K extends ResearchTable>(table: K, scope: string, id: string): Promise<ResearchTables[K] | undefined>;
  list<K extends ResearchTable>(table: K, scope: string): Promise<ResearchTables[K][]>;
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
  const scheduler = createScheduler({ concurrency: 1, maxQueue: 64 });
  return {
    exportState: () => cloneJson({ rows: [...rows.values()], projections: [...projections.values()] }),
    close: () => scheduler.close(),
    transaction<T>(body: (tx: ResearchTransaction) => Promise<T>): Promise<T> {
      return scheduler.run(async () => {
        const staged = new Map(rows), projected = new Map([...projections].map(([id, value]) => [id, cloneJson(value)]));
        let active = true;
        const guard = () => { if (!active) throw new TypeError('Research transaction is no longer active.'); };
        try {
          const result = await body({
            async get<K extends ResearchTable>(table: K, scope: string, id: string) {
              guard(); const row = staged.get(key(table, scope, id));
              return row === undefined ? undefined : cloneJson(row.payload) as ResearchTables[K];
            },
            async list<K extends ResearchTable>(table: K, scope: string) {
              guard(); return [...staged.values()].filter(row => row.table === table && row.scope === scope)
                .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => cloneJson(row.payload) as ResearchTables[K]);
            },
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
          options.applyProbe?.('commit'); rows = staged; projections = projected; return result;
        } finally { active = false; }
      });
    },
  };
}
export function createMemoryResearchStore(options: ResearchMemoryOptions = {}): ResearchStore {
  return createResearchStoreAdapter(createMemoryResearchPersistence(options));
}
export { createResearchStoreAdapter } from './store-policy.ts';
