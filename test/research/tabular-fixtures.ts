import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createResearchWorkspace, buildExecutionManifest, createFixtureExecutor, createEvaluationRegistry,
  domainExecutionPolicy, tabularStatisticsPrograms, TABULAR_EVALUATOR } from '@tangleai/research';
import { loadTabularStatisticsFixture } from '../../benchmark/lib/research-tabular-fixture.ts';
import { bindTabularResearchDomain } from '../../apps/research-runner/src/domains.ts';
import { checked, hash } from './fixtures.ts';
export async function tabularFixture(index = 0) {
  const fixture = await loadTabularStatisticsFixture(), topic = fixture.topics[index];
  const domain = checked(await bindTabularResearchDomain(fixture.datasets));
  checked(domain.validatePlan(topic.contract, topic.plan));
  const policy = checked(await domainExecutionPolicy(domain, { imageDigest: 'sha256:' + hash('a'), dependencyLockHash: hash('b'),
    datasetPaths: [{ datasetId: topic.contract.datasets[0].id, path: topic.datasetPath }], codeFiles: [] }));
  const workspace = checked(await createResearchWorkspace({ projectId: topic.contract.projectId,
    datasetIds: topic.contract.datasets.map(row => row.id), splitIds: topic.contract.splits.test,
    files: [{ path: topic.datasetPath, bytes: fixture.files.get(topic.datasetPath)!, mode: 'read-only', role: 'input' },
      { path: 'evaluation/identity.json', bytes: new TextEncoder().encode(canonicalizeJson(TABULAR_EVALUATOR)), mode: 'read-only', role: 'evaluator' }] }));
  const manifest = checked(await buildExecutionManifest({ contract: topic.contract, plan: topic.plan, workspace,
    branchId: 'tabular-control', condition: 'candidate', seed: 1, imageDigest: policy.imageDigest,
    dependencyLockHash: policy.dependencyLockHash, resources: policy.resources }));
  const context = { contract: topic.contract, plan: topic.plan, signal: new AbortController().signal };
  const programs = tabularStatisticsPrograms(), executor = createFixtureExecutor(programs, { now: () => 0 });
  const registry = createEvaluationRegistry([domain.evaluator]);
  return { fixture, topic, domain, policy, workspace, manifest, context, programs, executor, registry,
    contract: topic.contract, plan: topic.plan, hiddenLabels: null };
}
