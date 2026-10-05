/** Preregistered execution controls and the existing scientific program/evaluator implementations. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { applyJSONPatch } from '@jarenjs/json/patch';
import { createFixtureExecutor, createEvaluationRegistry, createResearchWorkspace, buildExecutionManifest, ResearchFailure, researchValue,
  domainExecutionPolicy, type ResearchFixtureProgram, type ResearchEvaluator, type ResearchExecutionManifestInput } from '@tangleai/research';
import { bindComputationalResearchDomain } from '../../apps/research-runner/src/domains.ts';
import { RESEARCH_PROGRAM_IDS, executeResearchProgram } from './research-programs.ts';
import { RESEARCH_EVALUATOR, researchMetricValues } from './research-evaluator.ts';
import { requireResearchShape } from './research-validation.ts';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchFixtureTopic, ResearchHiddenLabels, ResearchDataset, ResearchExecutionRegistration, ResearchExecutionRefusalFixture } from './research.types.ts';

export async function researchExecutionRegistration(loaded: LoadedResearchFixture): Promise<ResearchExecutionRegistration> {
  return { id: 'research-execution-v1', licence: loaded.manifest.licence,
    imageDigest: 'sha256:' + await canonicalSha256({ pureFixturePrograms: loaded.manifest.programs }),
    dependencyLockHash: await canonicalSha256({ programs: loaded.manifest.programs, evaluator: RESEARCH_EVALUATOR }),
    resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 },
    topics: loaded.topics.map(topic => ({ topicId: topic.id, attemptCap: topic.id === 'kmeans-seeding' ? 3 : 1,
      control: ['Stop'], branching: topic.id === 'kmeans-seeding' ? ['Refine', 'Refine', 'Stop'] : ['Stop'],
      designResources: { calls: 0, tokens: 0, ms: 10000, physical: topic.plan.conditions.length * topic.contract.replicatePolicy.seeds.length } })) };
}
export const RESEARCH_EXECUTION_REFUSALS: ResearchExecutionRefusalFixture[] = [
  { id: 'escape-path', expected: { code: 'TRSH1010', path: '/workspace/entries/0/path' }, patch: [{ op: 'replace', path: '/workspace/manifest/entries/0/path', value: '../outside' }] },
  { id: 'secret-read', expected: { code: 'TRSH1010', path: '/workspace/entries/0/path' }, patch: [{ op: 'replace', path: '/workspace/manifest/entries/0/path', value: 'hidden/labels.json' }] },
  { id: 'network-during-measured', expected: { code: 'TRSH1010', path: '/network' }, patch: [{ op: 'replace', path: '/network/measured', value: 'on' }] },
  { id: 'resource-cap', expected: { code: 'TRSH1010', path: '/resources/memoryBytes' }, patch: [{ op: 'replace', path: '/resources/memoryBytes', value: 2147483649 }] },
  { id: 'writable-evaluator', expected: { code: 'TRSH1010', path: '/workspace/entries/1/mode' }, patch: [{ op: 'replace', path: '/workspace/manifest/entries/1/mode', value: 'writable' }] },
];
export async function researchExecutionFixture(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic) {
  const registration = requireResearchShape<ResearchExecutionRegistration>('ResearchExecutionRegistration',
    JSON.parse(new TextDecoder().decode(loaded.files.get('execution/registration.json')!)));
  const registered = registration.topics.find(row => row.topicId === topic.id)!;
  if (!registered) throw Error('Unregistered execution topic.');
  const programs: Record<string, ResearchFixtureProgram> = Object.fromEntries(RESEARCH_PROGRAM_IDS.map(id => [id, async (request: Parameters<ResearchFixtureProgram>[0]) => {
    const run = await executeResearchProgram(id, JSON.parse(new TextDecoder().decode(request.bytes)) as ResearchDataset, request.seed, request.params);
    if (!run.ok) throw new ResearchFailure(run.issue); return run.output;
  }]));
  const evaluator: ResearchEvaluator<ResearchHiddenLabels> = { ...RESEARCH_EVALUATOR, evaluate: async value => {
    const result = researchMetricValues({ id: topic.id, contract: value.contract, plan: value.plan }, loaded.datasets.get(topic.datasetPath)!, value.hiddenLabels,
      { condition: value.manifest.condition!, output: value.rawOutput });
    return result.valid ? { valid: true, value: result.values } : result;
  } };
  const domain = researchValue(await bindComputationalResearchDomain(evaluator, { resources: registration.resources }));
  const policy = researchValue(await domainExecutionPolicy(domain, { imageDigest: registration.imageDigest, dependencyLockHash: registration.dependencyLockHash,
    datasetPaths: topic.contract.datasets.map((dataset, index) => ({ datasetId: dataset.id, path: topic.plan.inputPaths[index] })), codeFiles: [] }));
  const evaluatorBytes = new TextEncoder().encode(canonicalizeJson(RESEARCH_EVALUATOR)), hiddenLabels = loaded.hidden.get(topic.id)!;
  const workspace = researchValue(await createResearchWorkspace({ projectId: topic.contract.projectId, datasetIds: topic.contract.datasets.map(row => row.id),
    splitIds: [...topic.contract.splits.train, ...topic.contract.splits.test], files: [
      ...topic.plan.inputPaths.map(path => ({ path, bytes: loaded.files.get(path)!, role: 'input' as const, mode: 'read-only' as const })),
      { path: 'evaluation/registry.json', bytes: evaluatorBytes, role: 'evaluator', mode: 'read-only' }] }));
  const input: ResearchExecutionManifestInput = { contract: topic.contract, plan: topic.plan, workspace, branchId: 'execution-refusal-probe',
    condition: topic.plan.conditions[0].id, seed: topic.contract.replicatePolicy.seeds[0], imageDigest: policy.imageDigest,
    dependencyLockHash: policy.dependencyLockHash, resources: policy.resources, network: { setup: 'off', measured: 'off' } };
  return { registration, registered, domain, policy, programs, executor: createFixtureExecutor(programs, { now: () => 0 }),
    evaluator: domain.evaluator, evaluatorBytes, registry: createEvaluationRegistry([domain.evaluator]), hiddenLabels, workspace, input };
}
export async function probeResearchExecutionRefusal(loaded: LoadedResearchFixture, fixture: ResearchExecutionRefusalFixture) {
  const f = await researchExecutionFixture(loaded, loaded.topics[0]);
  const wire = { ...f.input, workspace: { ...f.workspace, artifacts: f.workspace.artifacts.map(row => ({ ...row, bytes: [...row.bytes] })) } };
  const changed = applyJSONPatch(wire, fixture.patch) as typeof wire;
  const result = await buildExecutionManifest({ ...changed, workspace: { ...changed.workspace,
    artifacts: changed.workspace.artifacts.map(row => ({ artifactId: row.artifactId, bytes: new Uint8Array(row.bytes) })) } });
  const first = result.valid ? null : result.issues[0], observed = first ? { code: first.code, path: first.path } : null;
  return { id: fixture.id, expected: fixture.expected, observed, refusedAsRegistered: canonicalizeJson(observed) === canonicalizeJson(fixture.expected) };
}
