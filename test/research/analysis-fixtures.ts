import { createFixtureExecutor, createEvaluationRegistry, buildExecutionManifest, createResearchWorkspace, researchRevisionOf, createResearchAnalysis,
  type ResearchAnalysisInput, type ResearchContract, type ResearchEvaluator, type ResearchFixtureProgram, type ExperimentBranch } from '@tangleai/research';
import { researchPairedStatistic } from '../../benchmark/lib/research-statistics.ts';
import { executionFixture } from './execution-fixtures.ts';
import { checked } from './fixtures.ts';

export type AnalysisCase = 'success' | 'bug' | 'degenerate' | 'confound' | 'negative' | 'contradictory';
export async function analysisFixture(kind: AnalysisCase = 'success', count = 5, branchId = 'analysis-branch') {
  const f = await executionFixture();
  const { contractHash: _contractHash, ...contractBody }: ResearchContract = f.contract;
  const policy: NonNullable<ResearchContract['analysisPolicy']> = { seedBatchSize: 2, recoverProgramFailure: true, confoundAction: 'Pivot',
    seedVariationChecks: kind === 'degenerate' ? [{ condition: f.contract.successRule.condition, metric: f.contract.successRule.metric,
      reason: 'The declared randomized initializer must use its seed; identical candidate outputs fail this implementation check.' }] : [] };
  contractBody.attemptCap = 3; contractBody.pivotCap = 2; contractBody.replicatePolicy.minimum = 5;
  contractBody.branchSelectionRule = { kind: 'best-of-n', n: 3, selector: 'preregistered-metric' }; contractBody.analysisPolicy = policy;
  if (kind === 'confound') contractBody.datasets.push({ ...contractBody.datasets[0], id: 'other-data' });
  const contract = { ...contractBody, contractHash: await researchRevisionOf(contractBody) };
  const { planHash: _planHash, ...planBody } = f.plan; planBody.contractHash = contract.contractHash;
  if (kind === 'confound') planBody.conditions[1].datasetId = 'other-data';
  const plan = { ...planBody, planHash: await researchRevisionOf(planBody) };
  const workspace = checked(await createResearchWorkspace({ projectId: contract.projectId, datasetIds: contract.datasets.map(row => row.id),
    splitIds: f.workspace.manifest.splitIds, files: f.workspace.manifest.entries.map(row => ({ ...row,
      bytes: f.workspace.artifacts.find(artifact => artifact.artifactId === row.artifactId)!.bytes })) }));
  const programs: Record<string, ResearchFixtureProgram> = Object.fromEntries(plan.conditions.map(condition => [condition.programId, async ({ seed }) => {
    if (kind === 'bug' && condition.id === contract.successRule.condition) throw Error('Candidate initializer dereferenced a missing parameter.');
    const baseline = condition.id === contract.successRule.baseline;
    const value = baseline || kind === 'negative' ? 20 : kind === 'degenerate' ? 1
      : kind === 'contradictory' ? seed % 2 === 0 ? 30 : 10 : seed;
    return { kind: 'clusters', centroids: [[value]], assignments: [0], iterations: 1 };
  }]));
  const executor = createFixtureExecutor(programs, { now: () => 0 });
  const evaluator: ResearchEvaluator<null> = { ...plan.evaluator, async evaluate({ rawOutput }) {
    if (rawOutput.kind !== 'clusters') throw Error('Fixture expects raw centroids.');
    return { valid: true, value: [{ metric: contract.successRule.metric, value: rawOutput.centroids[0][0], unit: contract.metrics[0].unit }] };
  } };
  const registry = createEvaluationRegistry([evaluator]);
  const input: ResearchAnalysisInput = { contract, plan, branch: {} as ExperimentBranch, ancestors: [], runs: [], manifests: [], observations: [],
    exploratoryObservationIds: [], analystIdentityId: 'deterministic-analyst' };
  for (const seed of contract.replicatePolicy.seeds.slice(0, count)) for (const condition of plan.conditions) {
    const manifest = checked(await buildExecutionManifest({ ...f.input, contract, plan, workspace, branchId, seed, condition: condition.id }));
    const result = checked(await executor.run(manifest, workspace, { contract, plan, signal: new AbortController().signal }));
    input.manifests.push(manifest); input.runs.push(result.run);
    if (result.run.status === 'ok') input.observations.push(...checked(await registry.evaluate({ contract, plan, manifest, workspace, result, hiddenLabels: null })));
  }
  input.branch = { id: branchId, projectId: contract.projectId, contractHash: contract.contractHash, planHash: plan.planHash,
    hypothesisHash: plan.hypothesisHash, parentId: null, kind: 'initial', attemptOrdinal: 1,
    status: input.runs.some(row => row.status !== 'ok') ? 'failed' : 'completed', runIds: input.runs.map(row => row.id),
    spend: { calls: 0, tokens: 0, ms: 0, physical: input.runs.length } };
  const analysis = checked(await createResearchAnalysis(input, researchPairedStatistic));
  return { ...f, contract, plan, workspace, programs, executor, evaluator, registry, input, analysis };
}
