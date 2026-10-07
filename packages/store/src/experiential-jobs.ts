/** Thin durable training assembly over native jobs, checkpoint identity and lease fencing. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createDagJobRunner, type JobWorker, type JobWorkerOptions } from '@jarenjs/db';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { checkExperientialRecord, EXPERIENTIAL_TRAINING_DAG, experientialTrainingJobKind,
  experientialTrainingRevision, createExperientialTrainingTasks, type ExperientialTrainingContext,
  type ExperientialTrainingPlan } from '@tangleai/experiential';
import { createExperientialDbStore } from './experiential-store.ts';
import type { TangleDb } from './db.ts';

type AttemptContext = Parameters<JobWorkerOptions['handlers'][string]>[1];
export interface ExperientialTrainingRunnerOptions extends Omit<ExperientialTrainingContext, 'store'> {
  compileDag: Parameters<typeof createDagJobRunner>[1]['compileDag'];
  concurrency?: number;
  pollInterval?: number;
  leaseMs?: number;
  owner?: string;
  renew?: boolean;
  onOutcome?: JobWorkerOptions['onOutcome'];
  stopGraceMs?: number;
}

/** Native caller-supplied-id enqueue preserves one job; the retained input must agree. */
export async function enqueueExperientialTraining(db: TangleDb, requested: ExperientialTrainingPlan): Promise<string> {
  if (!db.jobs) throw new TypeError('Training enqueue requires a database opened with jobs.');
  const plan = JSON.parse(canonicalizeJson(requested)) as ExperientialTrainingPlan;
  const checked = await checkExperientialRecord('trainingRun', plan.run);
  if (!checked.ok || !plan.run.spec || !plan.run.progress || plan.run.state !== 'queued'
    || plan.idempotencyKey !== plan.run.idempotencyKey || plan.pipelineRevision !== plan.run.pipelineRevision
    || plan.pipelineRevision !== await experientialTrainingRevision()
    || !equalsJson(plan.input, { runId: plan.run.id, idempotencyKey: plan.idempotencyKey, pipelineRevision: plan.pipelineRevision }))
    throw new TypeError('The training plan does not reproduce its registered input identity.');
  const kind = experientialTrainingJobKind(plan.pipelineRevision), payload = { input: plan.input };
  const prior = await db.jobs.get(plan.idempotencyKey);
  if (prior && (prior.kind !== kind || !equalsJson(prior.payload, payload)))
    throw new TypeError('This training idempotency key already names another registered run.');
  const store = createExperientialDbStore(db, { now: () => plan.run.recordedAt });
  const existing = await store.get('training_runs', plan.run.id);
  if (!existing.ok) throw new TypeError('The retained training run could not be read.');
  if (!existing.value && !(await store.put('training_runs', plan.run)).ok)
    throw new TypeError('The training run could not be admitted with its exact ancestry.');
  // Poll credits belong to the run. Extra attempts recover checkpoints without
  // replenishing those credits or authorizing another backend submission.
  const maxAttempts = Math.min(Number.MAX_SAFE_INTEGER, plan.run.budget.maxPolls + 16);
  const id = await db.jobs.enqueue(kind, payload, { id: plan.idempotencyKey, maxAttempts });
  const retained = await db.jobs.get(id);
  if (!retained || retained.kind !== kind || !equalsJson(retained.payload, payload))
    throw new TypeError('Concurrent enqueue retained a different training identity.');
  return id;
}

export async function createExperientialTrainingRunner(db: TangleDb, options: ExperientialTrainingRunnerOptions): Promise<JobWorker> {
  if (!db.jobs) throw new TypeError('Training execution requires a database opened with jobs.');
  const attempts = new AsyncLocalStorage<AttemptContext>();
  const fenced: Pick<TangleDb, 'transaction'> = {
    transaction: (task, policy) => db.transaction(async tx => {
      const attempt = attempts.getStore();
      if (!attempt || !tx.jobs) throw new TypeError('Training task writes require an active native attempt.');
      attempt.signal.throwIfAborted();
      if (!await tx.jobs.assertLease(attempt.lease())) throw new TypeError('The training attempt no longer holds its lease.');
      return task(tx);
    }, policy),
  };
  const now = () => new Date(options.clock()).toISOString();
  const store = createExperientialDbStore(fenced, { now }), readStore = createExperientialDbStore(db, { now });
  // Native task handlers expose input and signal, while the worker owns the
  // renewed lease. Bind that existing context to each domain transaction.
  const jobs = Object.create(db.jobs) as NonNullable<TangleDb['jobs']>;
  Object.defineProperty(jobs, 'createWorker', { value: (workerOptions: JobWorkerOptions) => db.jobs!.createWorker({ ...workerOptions,
    handlers: Object.fromEntries(Object.entries(workerOptions.handlers).map(([kind, handler]) => [kind,
      (payload: unknown, context: AttemptContext) => attempts.run(context, () => handler(payload, context))])),
  }) });
  const facade = Object.create(db) as TangleDb;
  Object.defineProperty(facade, 'jobs', { value: jobs });
  const revision = await experientialTrainingRevision();
  return createDagJobRunner(facade, { compileDag: options.compileDag,
    documents: { [experientialTrainingJobKind(revision)]: EXPERIENTIAL_TRAINING_DAG },
    tasks: createExperientialTrainingTasks({ ...options, store }), concurrency: options.concurrency,
    pollInterval: options.pollInterval, leaseMs: options.leaseMs, owner: options.owner, renew: options.renew,
    onOutcome: options.onOutcome, stopGraceMs: options.stopGraceMs, backoffBase: 0, backoffCap: 0,
    effectSafety: async job => {
      const input = (job.payload as { input?: { runId?: string } } | null)?.input;
      if (!input?.runId) return false;
      const run = await readStore.get('training_runs', input.runId);
      return run.ok && !!run.value?.progress && (!['reserved', 'unknown'].includes(run.value.progress.dispatch)
        || typeof options.reconcileSubmission === 'function');
    },
  });
}
