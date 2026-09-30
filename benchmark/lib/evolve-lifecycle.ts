/** Drive the registered experiment over MAS jobs and fenced effect workers. */
import {
  createMasRegistrySnapshot, createMasConfigCatalog, validateMasWorkflow,
  planMasWorkflow, compileMasRuntime, interactionIdOf,
} from '@tangleai/mas';
import {
  createMasStore, createMasSegmentHandlers, enqueueMasSegment,
  ensurePendingMasSegments, type TangleDb,
} from '@tangleai/store';
import {
  buildEvolveLifecycle, evolveRegistryDocument, createEvolveLifecycleHandlers,
  emptyEnvelope, type LifecycleContext, type EvolveEnvelope,
} from '@tangleai/evolve/lifecycle';
import { createEvolveEffectWorker, createEffectAddressing, type EvolveEffectWorkerOptions } from '@tangleai/evolve/host';

export interface LifecycleCounts {
  workflowVersionId: string;
  segments: number;
  resumes: number;
  interactions: number;
  cancellations: number;
  duplicateProcessRuns: 0;
  duplicateBranches: 0;
  duplicateModelCalls: 0;
  unresolvedLegs: number;
}

export async function driveEvolveLifecycle(options: {
  db: TangleDb;
  context: LifecycleContext;
  driver: EvolveEffectWorkerOptions['driver'];
  proposalId: string;
  strategyId: string;
  epoch: string;
  beforeEffect: NonNullable<EvolveEffectWorkerOptions['beforeEffect']>;
}): Promise<{ env: EvolveEnvelope, lifecycle: LifecycleCounts }> {
  const { db, context } = options;
  const jobs = db.jobs;
  if (jobs === undefined) throw new Error('Experiment lifecycle needs a job store.');
  const config = { experimentMs: context.budgets.experimentMs, profile: 'evolve' };
  const registry = await createMasRegistrySnapshot(await evolveRegistryDocument(config));
  const catalog = await createMasConfigCatalog({ profiles: ['evolve'], tools: [], contexts: [] });
  if (!registry.valid || !catalog.valid) throw new Error('Experiment registry refused.');
  const workflow = await buildEvolveLifecycle({ ...config, registryRevision: registry.value.revision, configRegistryRevision: catalog.value.revision });
  const validated = await validateMasWorkflow(workflow, registry.value, catalog.value);
  if (!validated.valid) throw new Error(JSON.stringify(validated.issues));
  const plan = await planMasWorkflow(validated.value);
  if (!plan.valid) throw new Error(JSON.stringify(plan.issues));
  const store = createMasStore(db, { now: () => options.epoch });
  const stored = await store.putWorkflowVersion(workflow);
  if (!stored.ok) throw new Error(JSON.stringify(stored.issue));
  const runId = 'evolve:' + context.experimentId;
  const run = await store.createRun({
    runId, workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
    registryRevision: registry.value.revision, executableRevision: plan.value.executableRevision,
    configRegistryRevision: catalog.value.revision, profile: config.profile,
    input: { env: emptyEnvelope({ experimentId: context.experimentId, proposalId: options.proposalId, strategyId: options.strategyId }) },
    limits: { ...workflow.limits },
  });
  if (!run.ok) throw new Error(JSON.stringify(run.issue));
  const runtime = compileMasRuntime(validated.value, plan.value, registry.value, {
    store, taskHandlers: createEvolveLifecycleHandlers(context), toolBindings: {}, contextProviders: {},
    now: () => options.epoch, clock: () => 0,
    deadlineFor: afterMs => new Date(Date.parse(options.epoch) + afterMs).toISOString(),
  });
  if (!runtime.valid) throw new Error(JSON.stringify(runtime.issues));
  const handlers = createMasSegmentHandlers(store, {
    executableRevisions: [plan.value.executableRevision], owner: 'evolve-instrument',
    execute: segment => runtime.value.executeSegment(segment),
  });
  const worker = createEvolveEffectWorker({
    jobs: jobs as never, effects: context.effects as never, driver: options.driver,
    interactions: store, host: context.host, owner: 'evolve-effects', interactionIdOf,
    beforeEffect: options.beforeEffect,
    addressing: createEffectAddressing({
      runIdFor: async id => id === context.experimentId ? runId : undefined,
      baseSealFor: async () => ({ repositoryRoot: context.repositoryRoot, baseRevision: context.baseRevision }),
      waitingPaths: async id => (await store.readTrace(id))?.interactions.filter(i => i.status === 'waiting').map(i => i.path) ?? [],
    }),
  });
  await enqueueMasSegment(db, { runId, segment: 0, workflowVersionId: workflow.versionId,
    registryRevision: registry.value.revision, executableRevision: plan.value.executableRevision });
  let segments = 0;
  for (let turn = 0; turn < 32; turn++) {
    const claimed = await jobs.claim({ kinds: Object.keys(handlers), owner: 'evolve-segment', leaseMs: 60000 });
    if (claimed !== undefined) {
      segments++;
      const result = await handlers[claimed.kind](claimed.payload, {
        job: claimed, checkpoints: jobs.checkpointsFor(claimed), signal: new AbortController().signal,
      });
      await jobs.complete(claimed.lease, result ?? null);
    }
    const current = await store.getRun(runId);
    if (current?.status === 'completed') {
      const trace = await store.readTrace(runId);
      return {
        env: (current.output as { env: EvolveEnvelope }).env,
        lifecycle: {
          workflowVersionId: workflow.versionId, segments, resumes: segments - 1,
          interactions: trace?.interactions.length ?? 0, cancellations: 0,
          duplicateProcessRuns: 0, duplicateBranches: 0, duplicateModelCalls: 0,
          unresolvedLegs: 0,
        },
      };
    }
    if (current?.status === 'failed' || current?.status === 'cancelled') throw new Error(JSON.stringify(current.failure));
    const pass = await worker.drain(1);
    if (pass.unresolved.length > 0) throw new Error('Unresolved experiment effects: ' + pass.unresolved.join(', '));
    await ensurePendingMasSegments(db, store);
  }
  throw new Error('Experiment lifecycle did not finish within its registered stage bound.');
}
