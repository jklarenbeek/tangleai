/** Seven checkpointed tasks; the injected native job runner owns retries and scheduling. */
import { deepFreeze, equalsJson } from '@jarenjs/core/object';
import { backoffDelay, createAttemptBudget } from '@jarenjs/core/retry';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { checkTrainingCapabilities, validateTrainingSpec, verifyArtifactReceipt, type TrainingBackend,
  type VerifyArtifactReceiptOptions, type BackendResult } from './backend.ts';
import { checkExperientialRecord, sealExperientialRecord } from './identity.ts';
import { checkTrainingBindings, initialTrainingProgress, trainingTerminal } from './training.ts';
import { renderExperientialExamples, type ExperientialDatasetPlan } from './dataset.ts';
import { validateExperientialShape } from './schema.ts';
import { refuseExperiential, type ExperientialResult, type ExperientialIssueCode } from './errors.ts';
import type { ExperientialStore, ExperientialTable, ExperientialTables } from './store-types.ts';
import type { ArtifactReceipt, BackendJob, BackendJobState, ExperientialArtifact, ExperientialDataset,
  ExperientialExampleVariables, ExperientialRuntime, ExperientialTrainingBudget, ExperientialTrainingCommand,
  ExperientialTrainingRun, ExperientialTrainingRunBackendIdentity, TrainingSpec } from './contracts.gen.ts';

export const EXPERIENTIAL_TRAINING_NODES = ['select', 'render', 'submit', 'poll', 'materialize', 'verify', 'register'] as const;
export type ExperientialTrainingNode = typeof EXPERIENTIAL_TRAINING_NODES[number];
export const EXPERIENTIAL_TRAINING_DAG = deepFreeze({
  $dag: '0.1',
  nodes: { input: { kind: 'input' },
    ...Object.fromEntries(EXPERIENTIAL_TRAINING_NODES.map(name => [name, { kind: 'task', run: name, version: 'training/1', checkpoint: true }])),
    result: { kind: 'output' } },
  edges: ['input', ...EXPERIENTIAL_TRAINING_NODES].map((from, i) => ({ from, to: [...EXPERIENTIAL_TRAINING_NODES, 'result'][i] })),
});
export const experientialTrainingRevision = () => canonicalSha256({ document: EXPERIENTIAL_TRAINING_DAG, taskVersion: 'training/1' });
export const experientialTrainingJobKind = (revision: string) => 'experiential-training:' + revision;
export interface ExperientialTrainingInput { runId: string; idempotencyKey: string; pipelineRevision: string }
export interface ExperientialTrainingPlan { run: ExperientialTrainingRun; idempotencyKey: string; pipelineRevision: string; input: ExperientialTrainingInput }

export async function planExperientialTraining(options: { dataset: ExperientialDataset; base: ExperientialArtifact;
  spec: TrainingSpec; backendIdentity: ExperientialTrainingRunBackendIdentity; runtime: ExperientialRuntime;
  recordedAt: string }): Promise<ExperientialResult<ExperientialTrainingPlan>> {
  // Snapshot all caller-owned records before the first asynchronous digest.
  let o: typeof options;
  try { o = JSON.parse(canonicalizeJson(options)); }
  catch { return refuseExperiential('TEXP1001', '', 'Training planning requires finite JSON inputs.'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return refuseExperiential('TEXP1001', '', 'Training planning requires a configuration object.');
  const spec = validateTrainingSpec(o.spec); if (!spec.ok) return spec;
  const [dataset, base] = await Promise.all([checkExperientialRecord('dataset', o.dataset), checkExperientialRecord('artifact', o.base)]);
  if (!dataset.ok) return dataset; if (!base.ok) return base;
  const idempotencyKey = await canonicalSha256(spec.value), pipelineRevision = await experientialTrainingRevision();
  const run = await sealExperientialRecord('trainingRun', { document: 'experiential-training-run', schemaVersion: 1,
    scope: o.dataset.scope, recordedAt: o.recordedAt, idempotencyKey, datasetId: spec.value.datasetId,
    baseArtifactId: spec.value.baseArtifactId, method: spec.value.method, hyperparameters: spec.value.hyperparameters,
    backendIdentity: o.backendIdentity, budget: spec.value.budget, state: 'queued', startedAt: null, finishedAt: null,
    logRefs: [], metricsRef: null, stopReason: null, submissions: 0, spec: spec.value, pipelineRevision,
    runtime: o.runtime, progress: initialTrainingProgress(o.recordedAt) });
  if (!run.ok) return run;
  const checked = await checkTrainingBindings(run.value, o.dataset, o.base); if (!checked.ok) return checked;
  return { ok: true, value: deepFreeze({ run: checked.value, idempotencyKey, pipelineRevision,
    input: { runId: checked.value.id, idempotencyKey, pipelineRevision } }) };
}

export interface ExperientialTrainingContext {
  store: ExperientialStore;
  backend: TrainingBackend;
  clock(): number;
  random(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  budgets: ExperientialTrainingBudget;
  resolveExamples(dataset: ExperientialDataset, signal?: AbortSignal): Promise<{ template: unknown; variables: readonly ExperientialExampleVariables[] }>;
  readBytes: VerifyArtifactReceiptOptions['readBytes'];
  /** Look up the original submission. This capability must never create a new job. */
  reconcileSubmission?(spec: TrainingSpec, signal?: AbortSignal): Promise<BackendResult<BackendJob>>;
}
export class ExperientialTrainingPending extends Error {
  constructor() { super('Training remains pending; the next native job attempt may reserve one further inspect.'); }
}
export class ExperientialSubmissionUnknown extends Error {
  constructor() { super('The retained submission is uncertain; reconciliation is required before further effects.'); }
}
class TrainingRefusal extends Error {
  constructor() { super('The checked training operation was refused.'); }
}
function value<T>(result: ExperientialResult<T>): T { if (!result.ok) throw new TrainingRefusal(); return result.value; }
type FailureReason = Extract<ExperientialTrainingCommand, { kind: 'fail' }>['reason'];

export function createExperientialTrainingTasks(context: ExperientialTrainingContext) {
  const { store, backend, clock, random, sleep, resolveExamples, readBytes, reconcileSubmission } = context;
  const budgets = value(validateExperientialShape<ExperientialTrainingBudget>('ExperientialTrainingBudget', context.budgets));
  const instant = () => {
    const n = clock(); if (!Number.isSafeInteger(n) || n < 0 || !Number.isFinite(new Date(n).getTime()))
      throw new TypeError('Training requires an injected valid millisecond clock.');
    return n;
  };
  async function read<K extends ExperientialTable>(table: K, id: string): Promise<ExperientialTables[K]> {
    const row = value(await store.get(table, id)); if (!row) throw new TrainingRefusal(); return row;
  }
  const update = async (run: ExperientialTrainingRun, command: ExperientialTrainingCommand) =>
    value(await store.training(run.id, run.progress!.revision, command)).after;
  const fail = (run: ExperientialTrainingRun, code: ExperientialIssueCode, reason: FailureReason) => update(run, { kind: 'fail', code, reason });
  async function retained(raw: unknown) {
    if (!raw || typeof raw !== 'object' || !equalsJson(Object.keys(raw).sort(), ['idempotencyKey', 'pipelineRevision', 'runId'])) throw new TrainingRefusal();
    const input = raw as ExperientialTrainingInput, run = await read('training_runs', input.runId);
    if (run.idempotencyKey !== input.idempotencyKey || run.pipelineRevision !== input.pipelineRevision
      || input.pipelineRevision !== await experientialTrainingRevision() || !run.spec || !run.progress
      || !equalsJson(run.backendIdentity, backend.identity)) throw new TrainingRefusal();
    return { run, input };
  }
  async function bounded(run: ExperientialTrainingRun) {
    if (trainingTerminal(run)) return run;
    const now = instant();
    if (run.startedAt && now < Date.parse(run.progress!.updatedAt)) return fail(run, 'TEXP1009', 'clock-regression');
    if (run.startedAt && now - Date.parse(run.startedAt) >= Math.min(run.budget.maxWallMs, budgets.maxWallMs))
      return fail(run, 'TEXP1009', 'wall-budget');
    return run;
  }
  async function datasetPlan(run: ExperientialTrainingRun): Promise<ExperientialDatasetPlan> {
    const dataset = await read('datasets', run.datasetId);
    const experiences = await Promise.all(dataset.selectedIds.map(id => read('experiences', id)));
    const assessments = await Promise.all(dataset.assessmentIds.map(id => read('assessments', id)));
    const grouping = { experiences: await Promise.all((dataset.groupingExperienceIds ?? []).map(id => read('experiences', id))),
      assessments: await Promise.all((dataset.groupingAssessmentIds ?? []).map(id => read('assessments', id))) };
    return { dataset, experiences, assessments, grouping };
  }
  async function execute(node: ExperientialTrainingNode, raw: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const loaded = await retained(raw), input = loaded.input;
    let run = await bounded(loaded.run), p = run.progress!;
    if (trainingTerminal(run)) return input;
    const stages = ['queued', 'selecting', 'selected', 'rendered', 'submitting', 'submitted', 'polled', 'materialized', 'verified', 'registered'];
    const required = { select: 'queued', render: 'selected', submit: 'rendered', poll: 'submitted', materialize: 'polled', verify: 'materialized', register: 'verified' };
    if (stages.indexOf(p.stage) < stages.indexOf(required[node])) throw new TrainingRefusal();
    if (node === 'select' && ['queued', 'selecting'].includes(p.stage)) {
      if (p.stage === 'queued') run = await update(run, { kind: 'begin' });
      const dataset = await read('datasets', run.datasetId), base = await read('artifacts', run.baseArtifactId);
      if (!(await checkTrainingBindings(run, dataset, base)).ok) await fail(run, 'TEXP1002', 'dataset');
      else if (dataset.selectedIds.length > Math.min(run.budget.maxRecords, budgets.maxRecords)) await fail(run, 'TEXP1009', 'record-budget');
      else {
        let capable = false;
        try { capable = checkTrainingCapabilities(run.spec!, await backend.capabilities()).ok; } catch { /* Counted capability refusal below. */ }
        if (!capable) await fail(run, 'TEXP1008', 'capability');
        else await update(run, { kind: 'selected' });
      }
    } else if (node === 'render' && p.stage === 'selected') {
      let rendered;
      try {
        const plan = await datasetPlan(run), source = await resolveExamples(plan.dataset, signal);
        rendered = await renderExperientialExamples(plan, source.template, source.variables);
      } catch { rendered = refuseExperiential('TEXP1002', '/dataset', 'The retained examples could not be rendered.'); }
      signal?.throwIfAborted();
      if (!rendered.ok) await fail(run, 'TEXP1002', 'dataset');
      else {
        const bytes = new TextEncoder().encode(canonicalizeJson(rendered.value)).byteLength;
        if (bytes > Math.min(run.budget.maxBytes, budgets.maxBytes)) await fail(run, 'TEXP1009', 'byte-budget');
        else await update(run, { kind: 'rendered', bytes, digest: await canonicalSha256(rendered.value) });
      }
    } else if (node === 'submit' && ['rendered', 'submitting'].includes(p.stage)) {
      const fresh = p.stage === 'rendered';
      if (fresh) run = await update(run, { kind: 'reserve' });
      signal?.throwIfAborted();
      let submission: BackendResult<BackendJob> | undefined;
      try {
        if (fresh) submission = await backend.submit(run.spec!);
        else if (reconcileSubmission) submission = await reconcileSubmission(run.spec!, signal);
      } catch { /* The durable reservation remains uncertain, never reset. */ }
      if (!submission?.ok) {
        if (run.progress!.dispatch === 'reserved') await update(run, { kind: 'uncertain' });
        throw new ExperientialSubmissionUnknown();
      }
      const job = validateExperientialShape<BackendJob>('BackendJob', submission.value);
      if (!job.ok || job.value.specDigest !== run.idempotencyKey) { await fail(run, 'TEXP1008', 'backend-protocol'); return input; }
      await update(run, { kind: 'submitted', job: job.value });
    } else if (node === 'poll' && p.stage === 'submitted') {
      const remaining = Math.min(run.budget.maxPolls, budgets.maxPolls) - p.polls;
      if (remaining < 1) { await fail(run, 'TEXP1009', 'poll-budget'); return input; }
      const credit = createAttemptBudget(remaining, 'safe-read');
      if (!credit.take()) throw new TypeError('A positive native attempt budget did not issue its first credit.');
      run = await update(run, { kind: 'poll-reserve' }); p = run.progress!;
      signal?.throwIfAborted();
      let observation: BackendResult<BackendJobState>;
      try { observation = await backend.inspect(p.job!.id); }
      catch { observation = refuseExperiential('TEXP1008', '/backend', 'The backend inspect did not return a checked observation.'); }
      signal?.throwIfAborted();
      if (!observation.ok) { await fail(run, 'TEXP1008', 'backend-protocol'); return input; }
      const state = validateExperientialShape<BackendJobState>('BackendJobState', observation.value);
      if (!state.ok || state.value.jobId !== p.job!.id) { await fail(run, 'TEXP1008', 'backend-protocol'); return input; }
      run = await update(run, { kind: 'observed', poll: p.polls, observation: state.value });
      if (trainingTerminal(run)) return input;
      const maxSpend = run.budget.maxSpend === null ? budgets.maxSpend : budgets.maxSpend === null ? run.budget.maxSpend : Math.min(run.budget.maxSpend, budgets.maxSpend);
      if (maxSpend !== null && (state.value.spend === null || state.value.spend > maxSpend)) { await fail(run, 'TEXP1009', 'spend-budget'); return input; }
      if (state.value.state !== 'complete') {
        if (p.polls >= Math.min(run.budget.maxPolls, budgets.maxPolls)) { await fail(run, 'TEXP1009', 'poll-budget'); return input; }
        await sleep(backoffDelay({ baseMs: 100, maxMs: 5000, random }, p.polls), signal);
        throw new ExperientialTrainingPending();
      }
    } else if (node === 'materialize' && p.stage === 'polled') {
      let result: BackendResult<ArtifactReceipt>;
      try { result = await backend.materialize(p.job!.id); }
      catch { result = refuseExperiential('TEXP1008', '/backend', 'The backend did not return a checked receipt.'); }
      signal?.throwIfAborted();
      if (!result.ok) await fail(run, 'TEXP1008', 'backend-receipt');
      else {
        const recorded = await store.training(run.id, p.revision, { kind: 'materialized', receipt: result.value });
        if (!recorded.ok) await fail(run, 'TEXP1008', 'backend-receipt');
      }
    } else if (node === 'verify' && p.stage === 'materialized') {
      const verified = await verifyArtifactReceipt(p.receipt, { spec: run.spec!, job: p.job!, runtime: run.runtime!,
        maxBytes: Math.min(run.budget.maxBytes, budgets.maxBytes), readBytes });
      signal?.throwIfAborted();
      if (!verified.ok) await fail(run, 'TEXP1008', 'artifact-verification');
      else await update(run, { kind: 'verified', verification: verified.value });
    } else if (node === 'register' && p.stage === 'verified') await update(run, { kind: 'register' });
    return input;
  }
  return Object.fromEntries(EXPERIENTIAL_TRAINING_NODES.map(node => [node, {
    version: 'training/1', run: ({ input }: { input: unknown }, signal?: AbortSignal) => execute(node, input, signal),
  }])) as Record<ExperientialTrainingNode, { version: string; run(args: { input: unknown }, signal?: AbortSignal): Promise<ExperientialTrainingInput> }>;
}

/** Local cancellation is durable before contacting the backend; it cannot register an artifact. */
export async function cancelExperientialTraining(store: ExperientialStore, backend: TrainingBackend, runId: string) {
  const found = await store.get('training_runs', runId); if (!found.ok || !found.value) return found;
  const run = found.value;
  if (trainingTerminal(run)) return found;
  if (!run.progress || !equalsJson(run.backendIdentity, backend.identity)) return refuseExperiential('TEXP1008', '/backend', 'Cancellation requires this run’s exact backend.');
  const cancelled = await store.training(run.id, run.progress.revision, { kind: 'cancel' }); if (!cancelled.ok) return cancelled;
  const result = { ...cancelled, value: cancelled.value.after };
  if (run.progress.job) {
    try {
      const remote = await backend.cancel(run.progress.job.id);
      if (!remote.ok) return { ...result, backendCancellation: 'refused' as const };
      const state = validateExperientialShape<BackendJobState>('BackendJobState', remote.value);
      if (!state.ok || state.value.jobId !== run.progress.job.id) return { ...result, backendCancellation: 'unknown' as const };
    }
    catch { return { ...result, backendCancellation: 'unknown' as const }; }
  }
  return { ...result, backendCancellation: run.progress.job ? 'requested' as const : 'not-submitted' as const };
}
