/**
 * The skill-evolution store contract and its in-memory implementation.
 *
 * Eleven collections, every row immutable once written: re-writing the same
 * bytes is a replay, writing different bytes under the same address is a
 * refusal. Two things move, each only through its own guarded transition: a
 * directory's status and a run's stage. Activation is a revision-fenced
 * compare-and-swap inside one transaction, a superseded directory is archived
 * rather than deleted, and its files stay readable because rollouts pin them;
 * a run settles where its drive stopped, so a finished run cannot be read as
 * one still going.
 *
 * Persistence is injected. This module knows transactions, not SQLite.
 */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { byPath } from './identity.ts';
import { validateTrace2SkillShape, type Trace2SkillSchemaName } from './schema.ts';
import { EMPTY_SKILL_HEAD, planActivation, planBundleStatus, planRollback, planRunStage } from './transitions.ts';
import type { SkillSnapshot } from './bundle.ts';
import type {
  ActivationEvent, AnalystResult, EvaluationRow, EvolutionRun, EvolutionTask, MergeNode, SkillBundle,
  SkillCandidate, SkillEvaluation, SkillFile, SkillHead, SkillHeadRow, SkillPatch, TaskRollout,
} from './contracts.gen.ts';

export interface Trace2SkillTables {
  bundles: SkillBundle; files: SkillFile; heads: SkillHeadRow; runs: EvolutionRun;
  tasks: EvolutionTask; rollouts: TaskRollout; analyses: AnalystResult; patches: SkillPatch;
  merges: MergeNode; candidates: SkillCandidate; evaluations: EvaluationRow;
}
export type Trace2SkillTable = keyof Trace2SkillTables;

export const TRACE2SKILL_TABLES: readonly Trace2SkillTable[] = Object.freeze([
  'bundles', 'files', 'heads', 'runs', 'tasks', 'rollouts', 'analyses', 'patches', 'merges', 'candidates', 'evaluations',
]) as readonly Trace2SkillTable[];

const SHAPES: Readonly<Record<Trace2SkillTable, Trace2SkillSchemaName>> = Object.freeze({
  bundles: 'skillBundle', files: 'skillFile', heads: 'skillHeadRow', runs: 'evolutionRun',
  tasks: 'evolutionTask', rollouts: 'taskRollout', analyses: 'analystResult', patches: 'skillPatch',
  merges: 'mergeNode', candidates: 'skillCandidate', evaluations: 'evaluationRow',
});

/** A file's address is its directory and name; a head's is its scope; everything else is content-addressed. */
export function trace2SkillRowId<K extends Trace2SkillTable>(table: K, row: Trace2SkillTables[K]): string {
  if (table === 'heads') return (row as SkillHeadRow).scopeKey;
  if (table === 'files') { const file = row as SkillFile; return `${file.bundleId}/${file.path}`; }
  return (row as { id: string }).id;
}

/** The partition a row is listed under: its scope key, its directory, or its run. */
export function trace2SkillRowScope<K extends Trace2SkillTable>(table: K, row: Trace2SkillTables[K]): string {
  if (table === 'files') return (row as SkillFile).bundleId;
  if (table === 'rollouts' || table === 'analyses' || table === 'patches' || table === 'merges')
    return (row as { runId: string }).runId;
  return (row as { scopeKey: string }).scopeKey;
}

/**
 * Status is store-owned lifecycle state; every identity-bearing field is
 * immutable. Two rows carry one: a directory, which the fenced swap moves, and
 * a run, which the drive settles when it stops. Both are addressed by a hash
 * that excludes the status, so a resume that re-asserts the row as it created
 * it is a replay rather than a conflict.
 */
const LIFECYCLE_ROWS: ReadonlySet<Trace2SkillTable> = new Set<Trace2SkillTable>(['bundles', 'runs']);

function sameRow<K extends Trace2SkillTable>(table: K, stored: Trace2SkillTables[K], next: Trace2SkillTables[K]): boolean {
  if (!LIFECYCLE_ROWS.has(table)) return equalsJson(stored, next);
  const { status: _stored, ...left } = stored as SkillBundle | EvolutionRun;
  const { status: _next, ...right } = next as SkillBundle | EvolutionRun;
  return equalsJson(left, right);
}

export interface Trace2SkillTransaction {
  get<K extends Trace2SkillTable>(table: K, id: string): Promise<Trace2SkillTables[K] | undefined>;
  list<K extends Trace2SkillTable>(table: K, scope: string): Promise<Trace2SkillTables[K][]>;
  /** Every partition one collection holds rows under, in code-point order. */
  scopes(table: Trace2SkillTable): Promise<string[]>;
  put<K extends Trace2SkillTable>(table: K, row: Trace2SkillTables[K]): Promise<void>;
}

/** Trusted persistence extension; never a wire operation. Every write rolls back on throw. */
export interface Trace2SkillPersistence {
  transaction<T>(task: (view: Trace2SkillTransaction) => Promise<T>): Promise<T>;
}

export interface Trace2SkillStoreStats { transactions: number, writes: number, replays: number, activations: number, refusals: number }

export interface Trace2SkillStore {
  putBundle(bundle: SkillBundle): Promise<Trace2SkillOutcome<SkillBundle>>;
  getBundle(id: string): Promise<Trace2SkillOutcome<SkillBundle>>;
  putFile(file: SkillFile): Promise<Trace2SkillOutcome<SkillFile>>;
  getFile(bundleId: string, path: string): Promise<Trace2SkillOutcome<SkillFile>>;
  /** One transaction for a directory and every page it names. */
  putSnapshot(snapshot: SkillSnapshot): Promise<Trace2SkillOutcome<SkillBundle>>;
  /** One transaction for a staged directory, its pages and the candidate that names it. */
  putStagedCandidate(snapshot: SkillSnapshot, candidate: SkillCandidate): Promise<Trace2SkillOutcome<SkillCandidate>>;
  getSnapshot(id: string): Promise<Trace2SkillOutcome<SkillSnapshot>>;
  putRun(run: EvolutionRun): Promise<Trace2SkillOutcome<EvolutionRun>>;
  putTask(task: EvolutionTask): Promise<Trace2SkillOutcome<EvolutionTask>>;
  putRollout(rollout: TaskRollout): Promise<Trace2SkillOutcome<TaskRollout>>;
  putAnalysis(analysis: AnalystResult): Promise<Trace2SkillOutcome<AnalystResult>>;
  putPatch(patch: SkillPatch): Promise<Trace2SkillOutcome<SkillPatch>>;
  putMerge(node: MergeNode): Promise<Trace2SkillOutcome<MergeNode>>;
  putCandidate(candidate: SkillCandidate): Promise<Trace2SkillOutcome<SkillCandidate>>;
  putEvaluation(evaluation: SkillEvaluation): Promise<Trace2SkillOutcome<SkillEvaluation>>;
  /** An activation attempt, stored beside the evaluations of its scope whether it applied or was refused. */
  putActivation(event: ActivationEvent): Promise<Trace2SkillOutcome<ActivationEvent>>;
  listBy<K extends Trace2SkillTable>(scope: string, kind: K): Promise<Trace2SkillTables[K][]>;
  /**
   * The partitions one collection holds rows under. Rows are addressed by
   * scope, so a reader with no scope in hand — a surface listing every run —
   * needs the store to name them rather than guessing or scanning.
   */
  scopes(kind: Trace2SkillTable): Promise<string[]>;
  head(scopeKey: string): Promise<SkillHead>;
  /** Lifecycle moves a host decides; `active` is reachable only through activation. */
  markBundle(bundleId: string, next: SkillBundle['status']): Promise<Trace2SkillOutcome<SkillBundle>>;
  /** Where a run stopped. Settling one that already stopped the same way is a replay. */
  markRun(runId: string, next: EvolutionRun['status']): Promise<Trace2SkillOutcome<EvolutionRun>>;
  activate(scopeKey: string, expectedHead: SkillHead, bundleId: string): Promise<Trace2SkillOutcome<SkillHead>>;
  /** The same fence, backwards: reinstate an archived directory of this scope. */
  rollback(scopeKey: string, expectedHead: SkillHead, bundleId: string): Promise<Trace2SkillOutcome<SkillHead>>;
  stats(): Trace2SkillStoreStats;
}

export function createTrace2SkillStoreAdapter(persistence: Trace2SkillPersistence): Trace2SkillStore {
  if (typeof persistence?.transaction !== 'function') throw new TypeError('An atomic transaction adapter is required.');
  const stats: Trace2SkillStoreStats = { transactions: 0, writes: 0, replays: 0, activations: 0, refusals: 0 };
  const refuse = <T>(code: Parameters<typeof trace2SkillRefuse>[0], path: string, detail: string): Trace2SkillOutcome<T> => {
    stats.refusals++;
    return trace2SkillRefuse<T>(code, path, detail);
  };
  async function transaction<T>(task: (view: Trace2SkillTransaction) => Promise<T>): Promise<T> {
    const value = await persistence.transaction(task);
    stats.transactions++;
    return value;
  }
  async function write<K extends Trace2SkillTable>(view: Trace2SkillTransaction, table: K, row: Trace2SkillTables[K]): Promise<Trace2SkillOutcome<Trace2SkillTables[K]>> {
    const id = trace2SkillRowId(table, row);
    const stored = await view.get(table, id);
    // A directory enters the store staged. Arriving already active or archived
    // would be activation without the fenced swap.
    if (!stored && table === 'bundles' && ((row as SkillBundle).status === 'active' || (row as SkillBundle).status === 'archived'))
      return refuse('TT2S1010', `/${table}/${id}`, `a directory is stored staged, not ${(row as SkillBundle).status}`);
    if (stored) {
      if (!sameRow(table, stored, row))
        return refuse('TT2S1002', `/${table}/${id}`, 'an immutable address was reused with different bytes');
      stats.replays++;
      return { valid: true, value: stored };
    }
    await view.put(table, row);
    stats.writes++;
    return { valid: true, value: row };
  }
  function checked<K extends Trace2SkillTable>(table: K, row: unknown): Trace2SkillOutcome<Trace2SkillTables[K]> {
    const shape = validateTrace2SkillShape<Trace2SkillTables[K]>(SHAPES[table], row);
    if (!shape.valid) stats.refusals++;
    return shape;
  }
  function put<K extends Trace2SkillTable>(table: K): (row: Trace2SkillTables[K]) => Promise<Trace2SkillOutcome<Trace2SkillTables[K]>> {
    return async row => {
      const shape = checked(table, row);
      if (!shape.valid) return shape;
      return transaction(view => write(view, table, shape.value));
    };
  }
  async function read<K extends Trace2SkillTable>(table: K, id: string): Promise<Trace2SkillOutcome<Trace2SkillTables[K]>> {
    const stored = await transaction(view => view.get(table, id));
    if (!stored) return refuse('TT2S1001', `/${table}/${id}`, `no ${table} record is stored under this address`);
    return { valid: true, value: stored };
  }
  /** A directory and its pages in one transaction, with an optional row that rides along. */
  async function writeSnapshot(
    snapshot: SkillSnapshot,
    also?: (view: Trace2SkillTransaction) => Promise<Trace2SkillOutcome<SkillBundle> | null>,
  ): Promise<Trace2SkillOutcome<SkillBundle>> {
    const bundle = checked('bundles', snapshot.bundle);
    if (!bundle.valid) return bundle;
    const files: SkillFile[] = [];
    for (const file of snapshot.files) {
      const shape = checked('files', file);
      if (!shape.valid) return shape;
      if (shape.value.bundleId !== bundle.value.id)
        return refuse<SkillBundle>('TT2S1002', `/files/${shape.value.path}`, 'the page names another directory');
      files.push(shape.value);
    }
    // Every address is checked before the first write, so a conflict on the
    // last page cannot leave the earlier ones committed.
    return transaction(async view => {
      for (const file of files) {
        const stored = await view.get('files', trace2SkillRowId('files', file));
        if (stored && !sameRow('files', stored, file))
          return refuse<SkillBundle>('TT2S1002', `/files/${file.path}`, 'an immutable address was reused with different bytes');
      }
      const storedBundle = await view.get('bundles', bundle.value.id);
      if (storedBundle && !sameRow('bundles', storedBundle, bundle.value))
        return refuse<SkillBundle>('TT2S1002', `/bundles/${bundle.value.id}`, 'an immutable address was reused with different bytes');
      const extra = also === undefined ? null : await also(view);
      if (extra !== null && !extra.valid) return extra;
      for (const file of files) await write(view, 'files', file);
      return write(view, 'bundles', bundle.value);
    });
  }

  const store: Trace2SkillStore = {
    putBundle: put('bundles'),
    getBundle: id => read('bundles', id),
    putFile: put('files'),
    getFile: (bundleId, path) => read('files', `${bundleId}/${path}`),
    putRun: put('runs'),
    putTask: put('tasks'),
    putRollout: put('rollouts'),
    putAnalysis: put('analyses'),
    putPatch: put('patches'),
    putMerge: put('merges'),
    putCandidate: put('candidates'),
    putEvaluation: row => put('evaluations')(row) as Promise<Trace2SkillOutcome<SkillEvaluation>>,
    putActivation: row => put('evaluations')(row) as Promise<Trace2SkillOutcome<ActivationEvent>>,
    putSnapshot(snapshot) { return writeSnapshot(snapshot); },
    async putStagedCandidate(snapshot, candidate) {
      const shape = checked('candidates', candidate);
      if (!shape.valid) return shape;
      if (shape.value.bundleId !== snapshot.bundle.id)
        return refuse<SkillCandidate>('TT2S1002', '/bundleId', 'the candidate names another directory');
      // The directory, its pages and the candidate land together or not at
      // all, so a staged candidate never points at a directory nobody stored.
      const written = await writeSnapshot(snapshot, async view => {
        const stored = await view.get('candidates', shape.value.id);
        if (stored && !sameRow('candidates', stored, shape.value))
          return refuse<SkillBundle>('TT2S1002', `/candidates/${shape.value.id}`, 'an immutable address was reused with different bytes');
        const landed = await write(view, 'candidates', shape.value);
        return landed.valid ? null : { valid: false as const, issues: landed.issues };
      });
      return written.valid ? { valid: true, value: shape.value } : written;
    },
    async getSnapshot(id) {
      const bundle = await read('bundles', id);
      if (!bundle.valid) return bundle;
      const files = await transaction(view => view.list('files', id));
      const missing = bundle.value.files.filter(entry => !files.some(file => file.path === entry.path));
      if (missing.length) return refuse<SkillSnapshot>('TT2S1001', `/files/${missing[0].path}`, 'the directory names a page the store does not hold');
      return { valid: true, value: { bundle: bundle.value, files: [...files].sort((a, b) => byPath(a.path, b.path)) } };
    },
    listBy: (scope, kind) => transaction(view => view.list(kind, scope)),
    scopes: (kind) => transaction(view => view.scopes(kind)),
    async head(scopeKey) {
      const row = await transaction(view => view.get('heads', scopeKey));
      return row ? row.head : { ...EMPTY_SKILL_HEAD };
    },
    async markRun(runId, next) {
      return transaction(async view => {
        const run = await view.get('runs', runId);
        if (!run) return refuse<EvolutionRun>('TT2S1001', `/runs/${runId}`, 'no run record is stored under this address');
        // A resumed drive settles the run it already settled. Re-asserting the
        // stage it is in is the same replay a repeated write is, and refusing
        // it would make finishing a resumed run a counted failure.
        if (run.status === next) { stats.replays++; return { valid: true as const, value: run }; }
        const planned = planRunStage(run.status, next);
        if (!planned.valid) { stats.refusals++; return { valid: false as const, issues: planned.issues }; }
        const moved = { ...run, status: planned.value };
        await view.put('runs', moved);
        stats.writes++;
        return { valid: true as const, value: moved };
      });
    },
    async markBundle(bundleId, next) {
      if (next === 'active' || next === 'archived')
        return refuse<SkillBundle>('TT2S1010', '/status', `only the fenced swap makes a directory ${next}`);
      return transaction(async view => {
        const bundle = await view.get('bundles', bundleId);
        if (!bundle) return refuse<SkillBundle>('TT2S1001', `/bundles/${bundleId}`, 'no directory is stored under this address');
        const planned = planBundleStatus(bundle.status, next);
        if (!planned.valid) { stats.refusals++; return { valid: false as const, issues: planned.issues }; }
        const moved = { ...bundle, status: planned.value };
        await view.put('bundles', moved);
        stats.writes++;
        return { valid: true as const, value: moved };
      });
    },
    activate(scopeKey, expectedHead, bundleId) {
      return transaction(async view => {
        const row = await view.get('heads', scopeKey);
        const current = row ? row.head : { ...EMPTY_SKILL_HEAD };
        const candidate = await view.get('bundles', bundleId);
        if (!candidate) return refuse<SkillHead>('TT2S1010', `/bundles/${bundleId}`, 'no directory is stored under this address');
        if (candidate.scopeKey !== scopeKey) return refuse<SkillHead>('TT2S1010', '/scopeKey', 'the candidate belongs to another scope');
        const planned = planActivation(current, expectedHead, { bundleId: candidate.id, parentId: candidate.parentId });
        if (!planned.valid) { stats.refusals++; return planned; }
        if (candidate.status !== 'eligible')
          return refuse<SkillHead>('TT2S1010', '/status', `activation needs a held-out eligible directory, not a ${candidate.status} one`);
        const promoted = planBundleStatus(candidate.status, 'active');
        if (!promoted.valid) { stats.refusals++; return { valid: false as const, issues: promoted.issues }; }
        if (current.versionId !== null) {
          const prior = await view.get('bundles', current.versionId);
          if (prior) {
            const archived = planBundleStatus(prior.status, 'archived');
            if (!archived.valid) { stats.refusals++; return { valid: false as const, issues: archived.issues }; }
            await view.put('bundles', { ...prior, status: archived.value });
            stats.writes++;
          }
        }
        await view.put('bundles', { ...candidate, status: promoted.value });
        await view.put('heads', { scopeKey, head: planned.value });
        stats.writes += 2;
        stats.activations++;
        return planned;
      });
    },
    rollback(scopeKey, expectedHead, bundleId) {
      return transaction(async view => {
        const row = await view.get('heads', scopeKey);
        const current = row ? row.head : { ...EMPTY_SKILL_HEAD };
        const target = await view.get('bundles', bundleId);
        if (!target) return refuse<SkillHead>('TT2S1010', `/bundles/${bundleId}`, 'no directory is stored under this address');
        if (target.scopeKey !== scopeKey) return refuse<SkillHead>('TT2S1010', '/scopeKey', 'the directory belongs to another scope');
        const planned = planRollback(current, expectedHead, { bundleId: target.id, status: target.status });
        if (!planned.valid) { stats.refusals++; return planned; }
        const reinstated = planBundleStatus(target.status, 'active');
        if (!reinstated.valid) { stats.refusals++; return { valid: false as const, issues: reinstated.issues }; }
        const prior = current.versionId === null ? undefined : await view.get('bundles', current.versionId);
        if (prior) {
          const archived = planBundleStatus(prior.status, 'archived');
          if (!archived.valid) { stats.refusals++; return { valid: false as const, issues: archived.issues }; }
          await view.put('bundles', { ...prior, status: archived.value });
          stats.writes++;
        }
        await view.put('bundles', { ...target, status: reinstated.value });
        await view.put('heads', { scopeKey, head: planned.value });
        stats.writes += 2;
        stats.activations++;
        return planned;
      });
    },
    stats: () => ({ ...stats }),
  };
  return store;
}

export interface MemoryTrace2SkillStoreOptions { applyProbe?: (step: string) => void }

export function createMemoryTrace2SkillStore(options: MemoryTrace2SkillStoreOptions = {}): Trace2SkillStore {
  type State = { [K in Trace2SkillTable]: Map<string, Trace2SkillTables[K]> };
  const empty = (): State => Object.fromEntries(TRACE2SKILL_TABLES.map(table => [table, new Map()])) as State;
  let state = empty();
  let pending: Promise<unknown> = Promise.resolve();
  const persistence: Trace2SkillPersistence = {
    transaction<T>(task: (view: Trace2SkillTransaction) => Promise<T>): Promise<T> {
      const result = pending.then(async () => {
        const staged = Object.fromEntries(TRACE2SKILL_TABLES.map(table =>
          [table, new Map([...state[table]].map(([id, row]) => [id, cloneJson(row)]))])) as State;
        const view: Trace2SkillTransaction = {
          async get(table, id) { return cloneJson(staged[table].get(id)) as never; },
          async list(table, scope) {
            return [...staged[table].values()]
              .filter(row => trace2SkillRowScope(table, row as never) === scope)
              .sort((a, b) => byPath(trace2SkillRowId(table, a as never), trace2SkillRowId(table, b as never)))
              .map(row => cloneJson(row)) as never;
          },
          async scopes(table) {
            return [...new Set([...staged[table].values()].map(row => trace2SkillRowScope(table, row as never)))].sort(byPath);
          },
          async put(table, row) {
            (staged[table] as Map<string, typeof row>).set(trace2SkillRowId(table, row), cloneJson(row));
            options.applyProbe?.(`put:${table}`);
          },
        };
        const value = await task(view);
        options.applyProbe?.('commit');
        state = staged;
        return value;
      });
      pending = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  return createTrace2SkillStoreAdapter(persistence);
}
