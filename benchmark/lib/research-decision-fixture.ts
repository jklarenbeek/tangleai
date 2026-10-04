/** Registered decision sensitivity cases are synthetic mechanisms, not research efficacy. */
import { createFixtureExecutor, createEvaluationRegistry, createResearchWorkspace, buildExecutionManifest, createResearchAnalysis, selectBranch,
  planResearchDecision, researchValue, researchRevisionOf, researchArtifactIdOf, type ResearchFixtureProgram, type ResearchEvaluator,
  type ResearchAnalysisInput, type ExperimentBranch, type ResearchLicence, type ResearchContract, type ExperimentPlan } from '@tangleai/research';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { researchPairedStatistic } from './research-statistics.ts';
import type { ResearchDecisionRegistration, ResearchDecisionProbe } from './research.types.ts';
import { requireResearchShape } from './research-validation.ts';

export function researchDecisionRegistration(licence: ResearchLicence): ResearchDecisionRegistration {
  return { id: 'research-decisions-v1', licence, analystIdentityId: 'research-deterministic-analyst', reviewerIdentityId: 'research-independent-result-reviewers',
    statisticId: 'jaren-paired-bootstrap-nearest-rank',
    repair: { topicId: 'kmeans-seeding', programId: 'kmeans-seeding/initializer-fault-v1',
      fault: 'Registered persistent initializer fault; repeating the implementation cannot repair it.' }, control: { attemptCap: 1, seedBatchSize: 5, rule: { kind: 'single' } },
    branching: { attemptCap: 3, seedBatchSize: 2, rule: { kind: 'best-of-n', n: 3, selector: 'preregistered-metric' } },
    cases: [
      { id: 'success', baseline: [10, 10, 10, 10, 10], candidate: [12, 13, 14, 15, 16], variationCheck: false, confounded: false, expected: 'Proceed' },
      { id: 'bug', baseline: [10, 10, 10, 10, 10], candidate: null, variationCheck: false, confounded: false, expected: 'Refine' },
      { id: 'degenerate', baseline: [10, 10, 10, 10, 10], candidate: [12, 12, 12, 12, 12], variationCheck: true, confounded: false, expected: 'Refine' },
      { id: 'confound', baseline: [10, 10, 10, 10, 10], candidate: [12, 13, 14, 15, 16], variationCheck: false, confounded: true, expected: 'Pivot' },
      { id: 'negative', baseline: [10, 10, 10, 10, 10], candidate: [10, 10, 10, 10, 10], variationCheck: false, confounded: false, expected: 'Stop' },
    ] };
}
export async function probeResearchDecision(registration: ResearchDecisionRegistration, fixture: ResearchDecisionRegistration['cases'][number]): Promise<ResearchDecisionProbe> {
  const projectId = 'decision-' + fixture.id, data = new TextEncoder().encode(canonicalizeJson({ baseline: fixture.baseline, candidate: fixture.candidate }));
  const contractBody: Omit<ResearchContract, 'contractHash'> = { id: projectId + '-contract', projectId, hypothesisSpace: ['Candidate raw coordinate exceeds the control.'],
    successRule: { metric: 'coordinate', baseline: 'baseline', condition: 'candidate', minImprovement: 1, confidenceLevel: 0.95 },
    failureRule: 'stop-on-invalid', metrics: [{ id: 'coordinate', unit: 'raw-coordinate', direction: 'maximize' }],
    datasets: [{ id: 'decision-data', sha256: (await researchArtifactIdOf(data)).slice(4) }, ...(fixture.confounded ? [{ id: 'other-data', sha256: (await researchArtifactIdOf(data)).slice(4) }] : [])],
    splits: { train: [], test: ['registered-pairs'] }, requiredBaselines: [{ condition: 'baseline', programId: 'decision-control', source: 'benchmark/lib/research-decision-fixture.ts', licence: registration.licence }],
    replicatePolicy: { seeds: [1, 2, 3, 4, 5], minimum: 5, resamples: 2000, bootstrapSeed: 17753 }, attemptCap: 3, pivotCap: 2, reviewCap: 1,
    selectionRule: { kind: 'all', n: 5, metric: 'coordinate' }, branchSelectionRule: registration.branching.rule,
    analysisPolicy: { seedBatchSize: 5, recoverProgramFailure: true, confoundAction: 'Pivot', seedVariationChecks: fixture.variationCheck
      ? [{ condition: 'candidate', metric: 'coordinate', reason: 'The preregistered seed-echo program ignored its input seed.' }] : [] },
    stopConditions: ['budget exhausted', 'negative evidence'] };
  const contract = { ...contractBody, contractHash: await researchRevisionOf(contractBody) };
  const planBody: Omit<ExperimentPlan, 'planHash'> = { id: projectId + '-plan', projectId, contractHash: contract.contractHash,
    hypothesisHash: await researchRevisionOf(contract.hypothesisSpace), conditions: [
      { id: 'baseline', programId: 'decision-control', datasetId: 'decision-data', params: {} },
      { id: 'candidate', programId: 'decision-candidate', datasetId: fixture.confounded ? 'other-data' : 'decision-data', params: {} }],
    inputPaths: ['features.json'], evaluator: { id: 'raw-coordinate', version: '1' } };
  const plan = { ...planBody, planHash: await researchRevisionOf(planBody) };
  const workspace = researchValue(await createResearchWorkspace({ projectId, datasetIds: contract.datasets.map(row => row.id), splitIds: contract.splits.test,
    files: [{ path: 'features.json', role: 'input', mode: 'read-only', bytes: data },
      { path: 'evaluation/registry.json', role: 'evaluator', mode: 'read-only', bytes: new TextEncoder().encode(canonicalizeJson(plan.evaluator)) }] }));
  const program = (condition: 'baseline' | 'candidate'): ResearchFixtureProgram => async input => {
    const values = (JSON.parse(new TextDecoder().decode(input.bytes)) as { baseline: number[]; candidate: number[] | null })[condition];
    if (!values) throw Error('The registered candidate omitted its required initializer parameter.');
    return { kind: 'clusters', centroids: [[values[input.seed - 1]]], assignments: [0], iterations: 1 };
  };
  const executor = createFixtureExecutor({ 'decision-control': program('baseline'), 'decision-candidate': program('candidate') }, { now: () => 0 });
  const evaluator: ResearchEvaluator<null> = { ...plan.evaluator, async evaluate({ rawOutput }) {
    if (rawOutput.kind !== 'clusters') throw Error('The coordinate evaluator requires raw centroid output.');
    return { valid: true, value: [{ metric: 'coordinate', unit: 'raw-coordinate', value: rawOutput.centroids[0][0] }] };
  } }, registry = createEvaluationRegistry([evaluator]);
  const branchId = projectId + '-branch', input: ResearchAnalysisInput = { contract, plan, branch: {} as ExperimentBranch, ancestors: [],
    runs: [], manifests: [], observations: [], exploratoryObservationIds: [], analystIdentityId: registration.analystIdentityId };
  for (const seed of contract.replicatePolicy.seeds) for (const condition of plan.conditions) {
    const manifest = researchValue(await buildExecutionManifest({ contract, plan, workspace, branchId, condition: condition.id, seed,
      imageDigest: 'sha256:' + await researchRevisionOf({ fixture: registration.id }), dependencyLockHash: await researchRevisionOf(plan.evaluator),
      resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 } }));
    const result = researchValue(await executor.run(manifest, workspace, { contract, plan, signal: new AbortController().signal }));
    input.manifests.push(manifest); input.runs.push(result.run);
    if (result.run.status === 'ok') input.observations.push(...researchValue(await registry.evaluate({ result, manifest, workspace, contract, plan, hiddenLabels: null })));
  }
  input.branch = { id: branchId, projectId, contractHash: contract.contractHash, planHash: plan.planHash, hypothesisHash: plan.hypothesisHash,
    parentId: null, kind: 'initial', attemptOrdinal: 1, status: input.runs.some(row => row.status === 'failed') ? 'failed' : 'completed',
    runIds: input.runs.map(row => row.id), spend: { calls: 0, tokens: 0, ms: 0, physical: input.runs.length } };
  const analysis = researchValue(await createResearchAnalysis(input, researchPairedStatistic));
  const selection = researchValue(await selectBranch([{ analysis, branches: [input.branch] }], contract));
  const grant = { calls: 10, tokens: 1000, ms: 10000, physical: 100 }, next = { calls: 0, tokens: 0, ms: 0, physical: 10 };
  const review = new TextEncoder().encode(canonicalizeJson({ scope: 'component-fixture', analystIdentityId: registration.analystIdentityId,
    reviewerIdentityId: 'component-review-control', analysisId: analysis.id, findings: [] }));
  const decision = researchValue(await planResearchDecision(analysis, contract, { attempt: 1, pivot: 1, selection },
    { remaining: grant, nextAttempt: next, nextPivot: next }, { reviewerIdentityId: 'component-review-control', findings: [], artifactIds: [await researchArtifactIdOf(review)] }));
  return requireResearchShape<ResearchDecisionProbe>('ResearchDecisionProbe', { id: fixture.id, expected: fixture.expected, matched: decision.kind === fixture.expected,
    review: { artifactId: await researchArtifactIdOf(review), bytes: [...review] }, analysis, decision, selection, contract, plan, branches: [input.branch], manifests: input.manifests, runs: input.runs,
    observations: input.observations, cost: input.branch.spend });
}
