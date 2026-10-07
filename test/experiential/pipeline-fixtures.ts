import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createFakeTrainingBackend, planExperienceTransition, planExperientialSelection, planExperientialDataset,
  planExperientialTraining, type ExperientialStore, type FakeTrainingBackendOptions, type TrainingSpec,
  type ExperientialTrainingContext } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { selectionFixture, selectionText, SELECTION_TIME } from './selection-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';

export async function trainingFixture(store: ExperientialStore, clock: { value: number },
  options: { fake?: Partial<FakeTrainingBackendOptions>; budget?: Partial<TrainingSpec['budget']> } = {}) {
  const base = await addressedFixture('artifact', { scope: 'training-fixture', kind: 'base', method: null,
    trainingRunId: null, baseArtifactId: null, checksum: await canonicalSha256('pipeline-fixture-base'),
    storageUri: 'memory:fake/base', runtime: { provider: 'fake', base: 'memory:fake/inference', servedModel: 'fake-base' } });
  accepted(await store.put('artifacts', base));
  const inputs = await selectionFixture(2, base.scope), selected = [];
  for (const e of inputs.experiences) {
    accepted(await store.put('experiences', e));
    accepted(await store.put('assessments', inputs.assessments.find(a => a.experienceId === e.id)!));
    const eligible = accepted(planExperienceTransition(e, 'eligible')); accepted(await store.transition(eligible));
    const chosen = accepted(planExperienceTransition(eligible.after, 'selected')); accepted(await store.transition(chosen)); selected.push(chosen.after);
  }
  const selection = accepted(await planExperientialSelection({ ...inputs, experiences: selected }));
  const config = datasetOptions(), data = accepted(await planExperientialDataset(selection, config));
  accepted(await store.put('datasets', data.dataset));
  const backend = createFakeTrainingBackend({ seed: 17753, clock: () => clock.value,
    baseModels: [base.id], runtime: base.runtime, ...options.fake });
  const spec: TrainingSpec = { datasetId: data.dataset.id, manifestDigest: data.dataset.manifestDigest,
    baseArtifactId: base.id, baseChecksum: base.checksum, method: 'lora', hyperparameters: { rank: 8, epochs: 1, learningRate: .001 },
    seed: 17753, precision: 'fp32', tokenizerIdentity: data.dataset.tokenizerIdentity, chatTemplateIdentity: data.dataset.chatTemplateIdentity,
    budget: { maxRecords: 10, maxBytes: 1_000_000, maxPolls: 10, maxWallMs: 60_000, maxSpend: null, ...options.budget } };
  const plan = accepted(await planExperientialTraining({ dataset: data.dataset, base, spec,
    backendIdentity: backend.identity, runtime: base.runtime, recordedAt: SELECTION_TIME }));
  const context: ExperientialTrainingContext = { store, backend, clock: () => clock.value, random: () => .5,
    sleep: async (ms, signal) => { signal?.throwIfAborted(); clock.value += ms; }, budgets: spec.budget,
    resolveExamples: async () => ({ template: config.template, variables: inputs.experiences.map((e, i) => ({ experienceId: e.id, ...selectionText(i) })) }),
    readBytes: backend.readBytes };
  return { plan, context, backend, data, base, clock };
}
