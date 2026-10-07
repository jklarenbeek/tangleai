import { createExperientialMemoryStore, createExperientialRunner, createExperientialDeployment, createFakeTrainingBackend,
  type ExperientialTriggerPolicy, type ExperientialTrainingRecipe, type ExperientialTrainingPlan } from '@tangleai/experiential';
import { trainingFixture } from './pipeline-fixtures.ts';
import { accepted } from './identity-fixtures.ts';
import { SELECTION_TIME } from './selection-fixtures.ts';
import { experientialStoreFixture, pendingActivation } from './store-fixtures.ts';

export async function cadenceFixture(policy: Partial<Omit<ExperientialTriggerPolicy, 'revision'>> = {}) {
  const clock = { value: Date.parse(SELECTION_TIME) };
  const store = createExperientialMemoryStore({ now: () => new Date(clock.value).toISOString() });
  const f = await trainingFixture(store, clock);
  const deployment = accepted(await createExperientialDeployment({ profile: 'training-profile', scope: f.base.scope,
    candidateId: 'fake-base', baseArtifact: f.base, recordedAt: SELECTION_TIME,
    operationalLimits: { maxFailureRate: 0, maxP95Ms: 100, window: 10 } }));
  accepted(await store.put('deployments', deployment));
  const { datasetId: _dataset, manifestDigest: _manifest, baseArtifactId: _base, baseChecksum: _checksum,
    tokenizerIdentity: _tokenizer, chatTemplateIdentity: _template, ...recipeFields } = f.plan.run.spec!;
  const recipe: ExperientialTrainingRecipe = { ...recipeFields, profile: deployment.profile, runtime: f.base.runtime };
  const jobs = new Map<string, ExperientialTrainingPlan>(); let enqueueCalls = 0;
  const binding = { async enqueue(plan: ExperientialTrainingPlan) { enqueueCalls++; if (!jobs.has(plan.idempotencyKey)) jobs.set(plan.idempotencyKey, plan); return plan.idempotencyKey; } };
  const options = { store, backend: f.backend, jobs: binding, recipe, now: () => clock.value, sleep: f.context.sleep,
    policy: { enabled: true, minimumEligible: 2, maxCadenceMs: 1000, scopeCooldownMs: 0,
      computeBudget: { maxRunsPerDay: 100, maxSpend: null }, maxQueued: 10, concurrency: 4, maxQueue: 32, ...policy } };
  const runner = await createExperientialRunner(options);
  return { ...f, store, clock, recipe, options, runner, jobs, binding, deployment, enqueueCalls: () => enqueueCalls,
    trigger: { scope: f.base.scope, kind: 'manual' as const, key: 'manual-a' },
    async close() { await runner.close(); await store.close(); } };
}

export async function activeCadenceFixture(policy: Partial<Omit<ExperientialTriggerPolicy, 'revision'>> = {}) {
  const clock = { value: Date.parse(SELECTION_TIME) };
  const store = createExperientialMemoryStore({ now: () => new Date(clock.value).toISOString() });
  const fixture = await experientialStoreFixture(store); clock.value += 1000;
  const backend = createFakeTrainingBackend({ seed: 17753, clock: () => clock.value, baseModels: [fixture.base.id, fixture.artifact.id], runtime: fixture.base.runtime });
  const recipe: ExperientialTrainingRecipe = { profile: fixture.servingDeployment.profile, method: 'lora', hyperparameters: { rank: 8, epochs: 1, learningRate: 0.001 },
    seed: 17753, precision: 'fp32', runtime: fixture.base.runtime, budget: { maxRecords: 10, maxBytes: 100000, maxWallMs: 10000, maxPolls: 8, maxSpend: null } };
  const jobs = new Map<string, ExperientialTrainingPlan>();
  const options = { store, backend, recipe, jobs: { async enqueue(plan: ExperientialTrainingPlan) { if (!jobs.has(plan.idempotencyKey)) jobs.set(plan.idempotencyKey, plan); return plan.idempotencyKey; } },
    now: () => clock.value, sleep: async (ms: number) => { clock.value += ms; },
    policy: { enabled: true, minimumEligible: 1, maxCadenceMs: 10, scopeCooldownMs: 0,
      computeBudget: { maxRunsPerDay: 100, maxSpend: null }, maxQueued: 10, concurrency: 4, maxQueue: 32, ...policy } };
  const runner = await createExperientialRunner(options);
  return { fixture, clock, store, backend, recipe, jobs, options, runner,
    trigger: { scope: 'fixture', kind: 'manual' as const, key: 'active-parent-tick' },
    async moveHead() { const plan = await pendingActivation(store, fixture, 'superseding-parent'); accepted(await store.activate(plan)); clock.value += 1000; return plan; },
    async close() { await runner.close(); await store.close(); } };
}
