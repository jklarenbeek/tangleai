/** Hosts bind each evaluator and dataset; the lifecycle consumes capabilities only. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { researchValue, researchRevisionOf, domainExecutionPolicy, createFixtureExecutor,
  tabularStatisticsPrograms, tabularStatistics, parseTabularSamples, TABULAR_EVALUATOR } from '@tangleai/research';
import { bindTabularResearchDomain } from '../../apps/research-runner/src/domains.ts';
import { researchExecutionFixture } from './research-execution-fixture.ts';
import { researchComparison } from './research-evaluator.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import { loadTabularStatisticsFixture } from './research-tabular-fixture.ts';
import type { ResearchFixtureTopic, ResearchHiddenLabels } from './research.types.ts';
import type { DomainRuntimeInput } from './research-domain-runtime.ts';

export async function computationalDomainInput(loaded: LoadedResearchFixture, topic: ResearchFixtureTopic): Promise<DomainRuntimeInput<ResearchHiddenLabels>> {
  const f = await researchExecutionFixture(loaded, topic);
  return { topic, topicHash: researchBytesSha256(loaded.files.get('topics/' + topic.id + '.json')!), domain: f.domain,
    scope: { domainProfileId: f.domain.profile.id, taskFamily: 'registered-experiment' }, policy: f.policy, executor: f.executor,
    hiddenLabels: f.hiddenLabels, evaluatorBytes: f.evaluatorBytes, files: loaded.files,
    summarize(_runs, observations) {
      const result = researchComparison(topic, observations).result;
      return { result, tabular: null };
    } };
}
export async function tabularDomainInputs(root = process.cwd()): Promise<Array<DomainRuntimeInput<null>>> {
  const loaded = await loadTabularStatisticsFixture(root), domain = researchValue(await bindTabularResearchDomain(loaded.datasets));
  const programHash = loaded.manifest.program.sha256;
  return Promise.all(loaded.topics.map(async topic => ({ topic,
    topicHash: researchBytesSha256(loaded.files.get('domains/tabular-statistics/' + loaded.manifest.topics.find(row => row.id === topic.id)!.path)!),
    domain, scope: { domainProfileId: domain.profile.id, taskFamily: topic.taskFamily },
    policy: researchValue(await domainExecutionPolicy(domain, { imageDigest: 'sha256:' + programHash,
      dependencyLockHash: await researchRevisionOf({ programHash, evaluator: TABULAR_EVALUATOR }),
      datasetPaths: [{ datasetId: topic.contract.datasets[0].id, path: topic.datasetPath }], codeFiles: [] })),
    executor: createFixtureExecutor(tabularStatisticsPrograms(), { now: () => 0 }), hiddenLabels: null,
    evaluatorBytes: new TextEncoder().encode(canonicalizeJson(TABULAR_EVALUATOR)), files: loaded.files,
    summarize() {
      const samples = researchValue(parseTabularSamples(loaded.datasets[topic.contract.datasets[0].id]));
      const summary = researchValue(tabularStatistics(samples, topic.contract.replicatePolicy.bootstrapSeed));
      const result = summary.interval.lower > topic.hypothesis.delta ? 'improvement' as const
        : summary.interval.upper <= topic.hypothesis.delta ? 'no-improvement' as const : 'inconclusive' as const;
      return { result, tabular: summary };
    },
  })));
}
