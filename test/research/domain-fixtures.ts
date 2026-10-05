import { researchArtifacts, researchRevisionOf, RESEARCH_EXECUTOR_CONTRACT, sealDomainProfile,
  renderMarkdownBundle, type ResearchDomainBindings, type ResearchDomainProfile } from '@tangleai/research';
import { checked, hash } from './fixtures.ts';

export async function domainFixture() {
  const calls = { model: 0, runner: 0, validator: 0, evaluator: 0, exporter: 0 };
  const prompt = researchArtifacts.prompts[0];
  const rubric = { claim: 'Registered observations only', unit: 'squared-distance' };
  const rubricRevision = await researchRevisionOf(rubric);
  const body: Omit<ResearchDomainProfile, 'revision'> = {
    id: 'fixture-domain', promptPackIds: [prompt.id], planValidatorIds: ['fixture-plan'],
    runnerManifestTemplate: { mode: 'fixture', executorContractHash: await researchRevisionOf(RESEARCH_EXECUTOR_CONTRACT),
      resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 },
      maxSeeds: 5, maxConditions: 2, network: { setup: 'off', measured: 'off' },
      bindings: { imageDigest: 'host-image-digest', dependencyLockHash: 'host-dependency-lock',
        datasetPaths: 'preregistered-inputs', codeFiles: 'admitted-code-slots' } },
    evaluatorId: 'fixture-evaluator', evaluatorVersion: '1',
    units: [{ metricId: 'inertia', unit: 'squared-distance', direction: 'minimize' }],
    rubricId: 'fixture-rubric', exportTemplateId: 'fixture-markdown',
    licence: { spdx: 'MIT', manifestPath: 'fixtures/manifest.json' }, taskFamilies: ['clustering'],
    bindingRevisions: [{ id: prompt.id, kind: 'prompt', revision: prompt.revision },
      { id: 'fixture-plan', kind: 'plan-validator', revision: hash('b') },
      { id: 'fixture-evaluator', kind: 'evaluator', revision: hash('c') },
      { id: 'fixture-rubric', kind: 'rubric', revision: rubricRevision },
      { id: 'fixture-markdown', kind: 'exporter', revision: hash('d') }],
  };
  const bindings: ResearchDomainBindings<null> = {
    prompts: { [prompt.id]: prompt },
    planValidators: { 'fixture-plan': { revision: hash('b'), validate: () => { calls.validator++; return []; } } },
    evaluators: { 'fixture-evaluator': { revision: hash('c'), evaluator: { id: 'fixture-evaluator', version: '1',
      evaluate: async () => { calls.evaluator++; return { valid: true, value: [{ metric: 'inertia', value: 1, unit: 'squared-distance' }] }; } } } },
    rubrics: { 'fixture-rubric': { revision: rubricRevision, document: rubric } },
    exporters: { 'fixture-markdown': { revision: hash('d'), render: (...args) => { calls.exporter++; return renderMarkdownBundle(...args); } } },
  };
  return { body, profile: checked(await sealDomainProfile(body)), bindings, calls,
    fields: { imageDigest: 'sha256:' + hash('e'), dependencyLockHash: hash('f'),
      datasetPaths: [{ datasetId: 'fixture-data', path: 'features.json' }], codeFiles: [] } };
}
