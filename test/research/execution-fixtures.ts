import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createResearchWorkspace, buildExecutionManifest, createFixtureExecutor, createEvaluationRegistry, ResearchFailure,
  type ResearchFixtureProgram, type ResearchEvaluator, type ResearchExecutionManifestInput } from '@tangleai/research';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { executeResearchProgram, RESEARCH_PROGRAM_IDS } from '../../benchmark/lib/research-programs.ts';
import { researchMetricValues, RESEARCH_EVALUATOR } from '../../benchmark/lib/research-evaluator.ts';
import type { ResearchDataset, ResearchHiddenLabels } from '../../benchmark/lib/research.types.ts';
import { checked, hash } from './fixtures.ts';

const loaded = loadResearchFixture();
export async function executionFixture() {
  const fixture = await loaded, topic = fixture.topics.find(row => row.id === 'kmeans-seeding')!;
  const contract = structuredClone(topic.contract), plan = structuredClone(topic.plan);
  const workspace = checked(await createResearchWorkspace({ projectId: contract.projectId,
    datasetIds: contract.datasets.map(row => row.id), splitIds: [...contract.splits.train, ...contract.splits.test],
    files: [...plan.inputPaths.map(path => ({ path, bytes: fixture.files.get(path)!, mode: 'read-only' as const, role: 'input' as const })),
      { path: 'evaluation/identity.json', bytes: new TextEncoder().encode(canonicalizeJson(RESEARCH_EVALUATOR)), mode: 'read-only', role: 'evaluator' }] }));
  const input: ResearchExecutionManifestInput = { contract, plan, workspace, branchId: 'branch-control',
    condition: plan.conditions[0].id, seed: contract.replicatePolicy.seeds[0], imageDigest: 'sha256:' + hash('d'),
    dependencyLockHash: hash('e'), resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 } };
  const manifest = checked(await buildExecutionManifest(input));
  const programs: Record<string, ResearchFixtureProgram> = Object.fromEntries(RESEARCH_PROGRAM_IDS.map(id => [id, async (request: Parameters<ResearchFixtureProgram>[0]) => {
    const run = await executeResearchProgram(id, JSON.parse(new TextDecoder().decode(request.bytes)) as ResearchDataset, request.seed, request.params);
    if (!run.ok) throw new ResearchFailure(run.issue);
    return run.output;
  }]));
  const executor = createFixtureExecutor(programs, { now: () => 0 });
  const evaluator: ResearchEvaluator<ResearchHiddenLabels> = { ...RESEARCH_EVALUATOR, evaluate: async value => {
    const dataset = fixture.datasets.get(plan.inputPaths[0])!;
    const result = researchMetricValues({ id: topic.id, contract: value.contract, plan: value.plan }, dataset, value.hiddenLabels,
      { condition: value.manifest.condition!, output: value.rawOutput });
    return result.valid ? { valid: true, value: result.values } : result;
  } };
  const registry = createEvaluationRegistry([evaluator]);
  const context = { contract, plan, signal: new AbortController().signal }, hiddenLabels = fixture.hidden.get(topic.id)!;
  return { fixture, topic, input, manifest, workspace, contract, plan, executor, registry, context, hiddenLabels, programs, evaluator };
}
