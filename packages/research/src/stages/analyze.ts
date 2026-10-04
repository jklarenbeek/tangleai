/** Only registered, admitted rows enter analysis; model opinions never change aggregates. */
import { equalsJson } from '@jarenjs/core/object';
import type { Analysis, ResearchContract, ExperimentPlan, ExperimentBranch, ExperimentRun, ExecutionManifest,
  MetricObservation, ResearchAnalysisDiagnostic } from '../contracts.gen.ts';
import { researchAggregate, researchPairedEstimate, type ResearchPairedStatistic } from '../statistics.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { validateResearchShape } from '../schema.ts';
import { researchObservationSignature } from '../execution/registry.ts';
import { researchRefuse, type ResearchOutcome } from '../errors.ts';
import { researchValue, researchFail, ResearchFailure } from '../workflow-contract.ts';

export interface ResearchAnalysisInput {
  contract: ResearchContract;
  plan: ExperimentPlan;
  branch: ExperimentBranch;
  /** Only the immutable replication ancestry; repair candidates are analyzed separately. */
  ancestors: ExperimentBranch[];
  runs: ExperimentRun[];
  manifests: ExecutionManifest[];
  observations: MetricObservation[];
  exploratoryObservationIds: string[];
  analystIdentityId: string;
}

export async function createResearchAnalysis(input: ResearchAnalysisInput, statistic: ResearchPairedStatistic): Promise<ResearchOutcome<Analysis>> {
  try {
    const data = immutableResearchJson(input), { contract, plan, branch, observations, runs, manifests } = data;
    researchValue(validateResearchShape('ResearchContract', contract)); researchValue(validateResearchShape('ExperimentPlan', plan));
    const { contractHash, ...contractBody } = contract, { planHash, ...planBody } = plan;
    if (contractHash !== await researchRevisionOf(contractBody) || planHash !== await researchRevisionOf(planBody)
      || plan.contractHash !== contractHash || plan.projectId !== contract.projectId)
      researchFail('TRSH1002', '/preregistration', 'Analysis requires exact frozen contract and plan content.');
    if (contract.replicatePolicy.minimum > contract.replicatePolicy.seeds.length)
      researchFail('TRSH1006', '/replicatePolicy', 'The declared seeds cannot meet the minimum replicate count.');
    const branches = [...data.ancestors, branch], branchIds = branches.map(row => row.id);
    if (new Set(branchIds).size !== branchIds.length) researchFail('TRSH1002', '/branches', 'Replication ancestry contains duplicate branches.');
    for (const [i, row] of branches.entries()) {
      researchValue(validateResearchShape('ExperimentBranch', row));
      if (row.projectId !== contract.projectId || row.contractHash !== contractHash || row.planHash !== planHash || row.hypothesisHash !== plan.hypothesisHash
        || i > 0 && (row.kind !== 'replicate' || row.parentId !== branches[i - 1].id || row.attemptOrdinal <= branches[i - 1].attemptOrdinal))
        researchFail('TRSH1009', '/branches', 'Only unchanged replication lineage can pool observations.');
    }
    const runIds = branches.flatMap(row => row.runIds);
    if (new Set(runIds).size !== runIds.length || runs.length !== runIds.length || new Set(runs.map(row => row.id)).size !== runs.length
      || runs.some(row => !runIds.includes(row.id)) || new Set(manifests.map(row => row.executionManifestHash)).size !== manifests.length)
      researchFail('TRSH1002', '/runs', 'Analysis needs exactly the runs of its retained branch lineage.');
    const experimentKeys = new Set<string>();
    for (const manifest of manifests) {
      researchValue(validateResearchShape('ExecutionManifest', manifest));
      const condition = plan.conditions.find(row => row.id === manifest.condition);
      const { executionManifestHash, id, ...body } = manifest;
      const key = JSON.stringify([manifest.condition, manifest.seed]);
      if (experimentKeys.has(key)) researchFail('TRSH1006', '/manifests', 'Replicate pooling cannot select duplicate seed/condition attempts.');
      experimentKeys.add(key);
      if (executionManifestHash !== await researchRevisionOf(body) || id !== 'execution-' + executionManifestHash)
        researchFail('TRSH1002', '/manifests', 'Execution manifest content address changed.');
      if (manifest.projectId !== contract.projectId || manifest.contractHash !== contractHash || manifest.planHash !== planHash
        || !branchIds.includes(manifest.branchId) || !condition || condition.datasetId !== manifest.datasetId
        || !equalsJson(condition.params, manifest.params) || !equalsJson(plan.evaluator, manifest.evaluator)
        || !contract.replicatePolicy.seeds.includes(manifest.seed)
        || manifest.programId !== condition.programId && manifest.codeArtifactId === null)
        researchFail('TRSH1009', '/manifests', 'Execution differs from its declared condition, evaluator or replicate.');
    }
    for (const run of runs) {
      researchValue(validateResearchShape('ExperimentRun', run));
      const manifest = manifests.find(row => row.executionManifestHash === run.executionManifestHash);
      const { id, ...body } = run;
      if (id !== 'run-' + await researchRevisionOf(body) || run.rawArtifactHash !== (run.output === null ? null : await researchRevisionOf(run.output)))
        researchFail('TRSH1002', '/runs', 'Run or raw-output content changed after registration.');
      if (!manifest || run.projectId !== contract.projectId || run.condition !== manifest.condition || run.seed !== manifest.seed || run.programId !== (manifest.programId ?? manifest.codeArtifactId)
        || run.inputHash !== manifest.workspaceHash || !branches.find(row => row.id === manifest.branchId)?.runIds.includes(run.id))
        researchFail('TRSH1005', '/runs', 'Registered runs must resolve to this branch and manifest.');
    }
    const observationKeys = new Set<string>();
    for (const row of observations) {
      researchValue(validateResearchShape('MetricObservation', row));
      const run = runs.find(run => run.id === row.experimentRunId), metric = contract.metrics.find(metric => metric.id === row.metric);
      if (!run || run.status !== 'ok' || run.stopReason !== 'completed' || run.exitStatus !== 0 || row.projectId !== contract.projectId
        || row.runArtifactHash !== run.rawArtifactHash || row.condition !== run.condition || row.seed !== run.seed
        || row.evaluatorId !== plan.evaluator.id || row.evaluatorVersion !== plan.evaluator.version || !metric || row.unit !== metric.unit)
        researchFail('TRSH1005', '/observations', 'Analysis cannot admit a foreign, failed or unregistered measurement.');
      const signature = await researchObservationSignature(row);
      if (row.registrySignature !== signature || row.id !== 'metric-' + await researchRevisionOf({ experimentRunId: run.id, registrySignature: signature }))
        researchFail('TRSH1002', '/observations', 'Registered observation content address changed.');
      const key = JSON.stringify([row.condition, row.metric, row.seed]);
      if (observationKeys.has(key)) researchFail('TRSH1006', '/observations', 'Each condition/metric/seed can contribute only once.');
      observationKeys.add(key);
    }
    for (const run of runs.filter(row => row.status === 'ok'))
      if (observations.filter(row => row.experimentRunId === run.id).length !== contract.metrics.length)
        researchFail('TRSH1005', '/observations', 'Every successful run needs its complete registry row set.');
    const metrics = plan.conditions.flatMap(condition => contract.metrics.map(metric => researchAggregate(condition.id, metric.id, metric.unit, observations)));
    const rule = contract.successRule, definition = contract.metrics.find(row => row.id === rule.metric);
    const baseline = metrics.find(row => row.condition === rule.baseline && row.metric === rule.metric);
    const candidate = metrics.find(row => row.condition === rule.condition && row.metric === rule.metric);
    if (!baseline || !candidate || !definition || rule.condition === rule.baseline)
      researchFail('TRSH1009', '/successRule', 'The registered comparison must name distinct admitted conditions and a metric.');
    const seeds = contract.replicatePolicy.seeds.filter(seed => baseline.values.some(row => row.seed === seed) && candidate.values.some(row => row.seed === seed));
    const pairs = seeds.map(seed => {
      const a = baseline.values.find(row => row.seed === seed)!.value, b = candidate.values.find(row => row.seed === seed)!.value;
      return (definition.direction === 'maximize' ? [a, b] : [b, a]) as [number, number];
    });
    const estimate = researchPairedEstimate(pairs);
    const interval = pairs.length ? statistic(pairs, { resamples: contract.replicatePolicy.resamples,
      seed: contract.replicatePolicy.bootstrapSeed, level: rule.confidenceLevel }) : null;
    if (interval) {
      researchValue(validateResearchShape('ResearchPairedInterval', interval));
      if (interval.estimate !== estimate || interval.lower > interval.upper || interval.resamples !== contract.replicatePolicy.resamples
        || interval.seed !== contract.replicatePolicy.bootstrapSeed || interval.level !== rule.confidenceLevel)
        researchFail('TRSH1002', '/evidence/interval', 'The statistic must retain the preregistered interval policy.');
    }
    const minimum = Math.max(2, contract.replicatePolicy.minimum), missingSeeds = contract.replicatePolicy.seeds.filter(seed => !seeds.includes(seed));
    const underpowered = seeds.length < minimum;
    const outcome = !interval ? 'unmeasured' : interval.lower > 0 ? 'positive' : interval.upper < 0 ? 'negative'
      : interval.lower === 0 && interval.upper === 0 ? 'neutral' : 'inconclusive';
    const diagnostics: ResearchAnalysisDiagnostic[] = [];
    const a = plan.conditions.find(row => row.id === rule.baseline)!, b = plan.conditions.find(row => row.id === rule.condition)!;
    if (a.datasetId !== b.datasetId) diagnostics.push({ kind: 'confound', reason: 'Comparison conditions use different frozen datasets.', evidenceIds: [plan.id] });
    const failed = runs.filter(row => row.status !== 'ok');
    for (const run of failed) diagnostics.push({ kind: run.stopReason === 'completed' && run.exitStatus !== null && run.exitStatus !== undefined
      && run.exitStatus !== 0 ? 'program-error' : 'invalid-execution', reason: run.error
        ? run.error.detail + (run.error.cause ? ' ' + run.error.cause.detail : '') : 'Execution failed its declared stop policy.', evidenceIds: [run.id] });
    for (const check of contract.analysisPolicy?.seedVariationChecks ?? []) {
      const values = metrics.find(row => row.condition === check.condition && row.metric === check.metric);
      if (!values) researchFail('TRSH1009', '/analysisPolicy/seedVariationChecks', 'Variation checks must name a preregistered condition and metric.');
      if (values.n >= minimum && values.sampleStddev === 0) diagnostics.push({ kind: 'degenerate', reason: check.reason, evidenceIds: values.values.map(row => row.observationId) });
    }
    const exploratoryObservationIds = data.exploratoryObservationIds.filter(id => observations.some(row => row.id === id)).sort();
    const met = estimate === null ? null : estimate > 0 && estimate >= rule.minImprovement;
    const success = failed.length === 0 && runs.length === contract.replicatePolicy.seeds.length * plan.conditions.length;
    const support: Analysis['support'] = exploratoryObservationIds.length ? 'exploratory'
      : diagnostics.length || !success ? 'inconclusive'
      : met === false || outcome === 'negative' || outcome === 'neutral' ? 'not-supported'
      : !underpowered && outcome === 'positive' && met && missingSeeds.length === 0 ? 'supported' : 'inconclusive';
    const body: Omit<Analysis, 'id'> = { projectId: contract.projectId, branchId: branch.id, contractHash, planHash,
      hypothesisHash: plan.hypothesisHash, analystIdentityId: data.analystIdentityId, branchIds,
      runIds: [...runIds].sort(), observationIds: observations.map(row => row.id).sort(), exploratoryObservationIds,
      execution: { runs: runs.length, completed: runs.length - failed.length, failed: failed.length,
        partial: manifests.length - runs.length + failed.filter(row => (row.outputInventory?.length ?? 0) > 0).length, success }, metrics,
      movement: { metric: rule.metric, baseline: rule.baseline, condition: rule.condition, direction: definition.direction,
        estimate, outcome: estimate === null ? 'unmeasured' : estimate > 0 ? 'improved' : estimate < 0 ? 'worsened' : 'unchanged' },
      evidence: { n: pairs.length, minimum, seeds, missingSeeds, underpowered, interval, outcome }, practical: { minimumImprovement: rule.minImprovement, met }, support, diagnostics };
    return validateResearchShape<Analysis>('Analysis', { id: 'analysis-' + await researchRevisionOf(body), ...body });
  } catch (cause) { return cause instanceof ResearchFailure ? { valid: false, issues: [cause.issue] }
    : researchRefuse('TRSH1002', '/analysis', 'Analysis could not reproduce finite registered evidence.', cause); }
}

export async function verifyResearchAnalysis(input: ResearchAnalysisInput, proposed: unknown, statistic: ResearchPairedStatistic): Promise<ResearchOutcome<Analysis>> {
  const expected = await createResearchAnalysis(input, statistic);
  if (!expected.valid) return expected;
  return equalsJson(expected.value, proposed) ? expected : researchRefuse('TRSH1002', '/analysis', 'Analysis differs from independently recomputed registered rows.');
}
