/** Independent fixture metrics over retained raw output; digests are provenance, not authentication. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { dotProduct } from '@jarenjs/core/vector';
import { mean, pairedBootstrap } from '@jarenjs/core/stats';
import { researchObservationSignature } from '@tangleai/research';
export { researchObservationSignature } from '@tangleai/research';
import { researchShape } from './research-validation.ts';
import { researchProgramInput } from './research-programs.ts';
import type { ResearchDataset, ResearchHiddenLabels, ResearchFixtureTopic, ExperimentRun,
  MetricObservation, ResearchIssue, ResearchDecision } from './research.types.ts';

export const RESEARCH_EVALUATOR = { id: 'fixture-evaluator', version: '1' } as const;
export async function researchExecutionHash(topic: ResearchFixtureTopic, condition: string, seed: number, inputHash: string): Promise<string> {
  return canonicalSha256({ contractHash: topic.contract.contractHash, planHash: topic.plan.planHash,
    condition, seed, inputHash, evaluator: topic.plan.evaluator });
}
export async function evaluateResearchRun(topic: ResearchFixtureTopic, dataset: ResearchDataset, hidden: ResearchHiddenLabels,
  run: ExperimentRun): Promise<{ valid: true; observation: MetricObservation } | { valid: false; issues: ResearchIssue[] }> {
  const refuse = (code: string, path: string, detail: string) => ({ valid: false as const, issues: [{ code, path, detail }] });
  const issues = researchShape('ExperimentRun', run);
  if (issues.length) return { valid: false, issues };
  const condition = topic.plan.conditions.find(condition => condition.id === run.condition);
  if (!condition || run.programId !== condition.programId) return refuse('TRSH1003', '/condition', 'Unregistered experiment condition or program.');
  if (run.status !== 'ok' || !run.output) return refuse('TRSH1008', '/error', run.error?.detail ?? 'Program produced no successful raw output.');
  if (run.output.kind === 'files') return refuse('TRSH1005', '/output/files', 'Program-written metric files are raw artifacts, not evaluator observations.');
  if (run.projectId !== topic.contract.projectId || hidden.topicId !== topic.id) return refuse('TRSH1003', '/projectId', 'Evaluator input belongs to another project or topic.');
  if (topic.plan.evaluator.id !== RESEARCH_EVALUATOR.id || topic.plan.evaluator.version !== RESEARCH_EVALUATOR.version)
    return refuse('TRSH1007', '/evaluator', 'Evaluator identity differs from the frozen plan.');
  if (run.inputHash !== await canonicalSha256(researchProgramInput(dataset))) return refuse('TRSH1002', '/inputHash', 'Program feature input hash differs.');
  if (run.executionManifestHash !== await researchExecutionHash(topic, condition.id, run.seed, run.inputHash))
    return refuse('TRSH1002', '/executionManifestHash', 'Execution identity does not bind the frozen contract and plan.');
  if (run.rawArtifactHash !== await canonicalSha256(run.output)) return refuse('TRSH1002', '/rawArtifactHash', 'Raw output digest differs.');
  const measured = researchMetricValues(topic, dataset, hidden, run);
  if (!measured.valid) return measured;
  const { metric, value, unit } = measured.values[0];
  const signed = { evaluatorId: RESEARCH_EVALUATOR.id, evaluatorVersion: RESEARCH_EVALUATOR.version,
    runArtifactHash: run.rawArtifactHash!, condition: run.condition, metric, value, unit, seed: run.seed };
  const registrySignature = await researchObservationSignature(signed);
  return { valid: true, observation: { id: 'metric-' + registrySignature, projectId: run.projectId,
    experimentRunId: run.id, ...signed, registrySignature } };
}
/** The same independent arithmetic serves legacy receipts and the full manifest registry. */
export function researchMetricValues(topic: Pick<ResearchFixtureTopic, 'id' | 'contract' | 'plan'>,
  dataset: ResearchDataset, hidden: ResearchHiddenLabels, run: Pick<ExperimentRun, 'condition' | 'output'>):
  { valid: true; values: Array<{ metric: string; value: number; unit: string }> } | { valid: false; issues: ResearchIssue[] } {
  const refuse = (code: string, path: string, detail: string) => ({ valid: false as const, issues: [{ code, path, detail }] });
  const condition = topic.plan.conditions.find(row => row.id === run.condition);
  if (!condition || hidden.topicId !== topic.id) return refuse('TRSH1003', '/condition', 'Evaluator inputs do not belong to this topic and condition.');
  if (!run.output) return refuse('TRSH1008', '/output', 'Experiment has no raw output.');
  const metric = topic.contract.metrics.find(metric => metric.id === topic.contract.successRule.metric);
  if (!metric) return refuse('TRSH1003', '/metric', 'Unregistered primary metric.');
  let value: number;
  if (dataset.kind === 'blobs' && run.output.kind === 'clusters') {
    const { centroids, assignments } = run.output;
    if (centroids.length !== condition.params.k || assignments.length !== dataset.points.length
      || centroids.some(centroid => centroid.length !== 2) || assignments.some(index => index >= centroids.length))
      return refuse('TRSH1005', '/output', 'Cluster output does not cover the registered feature rows and dimensions.');
    value = dataset.points.reduce((sum, point, index) => {
      const residual = point.vector.map((coordinate, dimension) => coordinate - centroids[assignments[index]][dimension]);
      return sum + dotProduct(residual, residual);
    }, 0);
  } else if (dataset.kind === 'corpus' && run.output.kind === 'rankings') {
    const { rankings } = run.output, documents = new Set(dataset.documents.map(document => document.id));
    if (JSON.stringify(rankings.map(row => row.queryId)) !== JSON.stringify(dataset.queries.map(query => query.id)))
      return refuse('TRSH1005', '/output/rankings', 'Rankings must preserve every registered query, including misses.');
    const recalls: number[] = [];
    for (const row of rankings) {
      const gold = hidden.queryGold.find(gold => gold.queryId === row.queryId);
      if (!gold || gold.relevantIds.some(id => !documents.has(id))) return refuse('TRSH1003', '/hidden/queryGold', 'Query labels do not resolve to corpus documents.');
      if (row.hits.length > (condition.params.limit ?? 5) || new Set(row.hits.map(hit => hit.id)).size !== row.hits.length
        || row.hits.some(hit => !documents.has(hit.id))) return refuse('TRSH1005', '/output/rankings', 'Ranking exceeds the registered top-k or invents a document.');
      recalls.push(gold.relevantIds.filter(id => row.hits.some(hit => hit.id === id)).length / gold.relevantIds.length);
    }
    value = mean(recalls)!;
  } else return refuse('TRSH1005', '/output/kind', 'Raw output kind differs from the registered dataset.');
  return { valid: true, values: [{ metric: metric.id, value, unit: metric.unit }] };
}
export function researchComparison(topic: Pick<ResearchFixtureTopic, 'contract'>, observations: readonly MetricObservation[]) {
  const rule = topic.contract.successRule, metric = topic.contract.metrics.find(metric => metric.id === rule.metric)!;
  const pairs = topic.contract.replicatePolicy.seeds.map(seed => {
    const baseline = observations.find(value => value.condition === rule.baseline && value.seed === seed && value.metric === rule.metric);
    const candidate = observations.find(value => value.condition === rule.condition && value.seed === seed && value.metric === rule.metric);
    if (!baseline || !candidate) throw new Error('Incomplete registered seed pairs.');
    return [baseline.value, candidate.value] as [number, number];
  });
  const favorable = pairs.map(([baseline, candidate]): [number, number] => metric.direction === 'minimize'
    ? [candidate, baseline] : [baseline, candidate]);
  const interval = pairedBootstrap(favorable, { resamples: topic.contract.replicatePolicy.resamples,
    seed: topic.contract.replicatePolicy.bootstrapSeed, level: rule.confidenceLevel, quantile: 'nearest-rank', maxWork: 100000 });
  const saturated = metric.direction === 'maximize' && pairs.every(([baseline, candidate]) => baseline === 1 && candidate === 1);
  const result = saturated ? 'SATURATED' : interval.lower > rule.minImprovement ? 'improvement'
    : interval.estimate > rule.minImprovement ? 'inconclusive' : 'no-improvement';
  return { result, interval, pairs, baselineMean: mean(pairs.map(pair => pair[0]))!, candidateMean: mean(pairs.map(pair => pair[1]))!,
    wins: favorable.filter(([baseline, candidate]) => candidate > baseline).length,
    losses: favorable.filter(([baseline, candidate]) => candidate < baseline).length,
    ties: favorable.filter(([baseline, candidate]) => candidate === baseline).length } as const;
}
export function researchMechanicalDecision(topic: ResearchFixtureTopic, observations: readonly MetricObservation[]): ResearchDecision {
  const comparison = researchComparison(topic, observations);
  return { id: topic.id + '-decision', projectId: topic.contract.projectId, contractHash: topic.contract.contractHash,
    kind: comparison.result === 'improvement' ? 'Proceed' : 'Stop',
    reason: comparison.result, observationIds: observations.map(observation => observation.id), exploratory: false };
}
