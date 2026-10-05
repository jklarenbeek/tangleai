/** Group-difference policy is data; the shared lifecycle never selects a domain by name. */
import type { GmplPromptArtifact } from '@tangleai/gmpl';
import { equalsJson } from '@jarenjs/core/object';
import type { ExperimentPlan, ResearchContract, ResearchIssue } from '../contracts.gen.ts';
import { RESEARCH_EXECUTOR_CONTRACT } from '../execution/executor.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { sealDomainProfile } from './profile.ts';
import { RESEARCH_MARKDOWN_EXPORT_POLICY } from './computational.ts';

export const TABULAR_DOMAIN_ID = 'tabular-statistics';
export const TABULAR_EVALUATOR = Object.freeze({ id: 'tabular-statistics/v1', version: '1' });
export const TABULAR_UNITS = immutableResearchJson([{ metricId: 'meanDifference', unit: 'points', direction: 'maximize' as const }]);
export const TABULAR_PROGRAM_IDS = Object.freeze({ observed: 'tabular-observed', null: 'tabular-null' });
export const TABULAR_PLAN_POLICY = immutableResearchJson({ id: 'tabular-group-plan', version: '1',
  statistic: 'mean(A)-mean(B)', seeds: [1, 2, 3], resamples: 2000, baseline: 'paired-null-boundary',
  comparison: 'greater-than-preregistered-delta', input: 'complete-paired-csv', maxPairs: 1024 });
export const TABULAR_RUBRIC = immutableResearchJson({ id: 'tabular-group-rubric', version: '1',
  metric: 'meanDifference', unit: 'points', direction: 'maximize', variance: 'sample; n-1',
  interval: 'paired percentile bootstrap over input pairs; 2000 resamples; 95%; nearest-rank',
  requirements: ['Every output value must reproduce from a declared input pair and its registered transform.',
    'A metric scalar or program-written summary is not raw sample evidence.',
    'Compare the observed mean difference with the preregistered delta and retain negative results.',
    'Seed reordering checks reproducibility; repeated identical effects are not independent population observations.',
    'Population uncertainty uses the interval over input pairs, never the interval over identical replay seeds.'] });

export function validateTabularPlan(contract: ResearchContract, plan: ExperimentPlan): ResearchIssue[] {
  const issues: ResearchIssue[] = [];
  const refuse = (path: string, detail: string) => issues.push(researchIssue('TRSH1009', path, detail));
  if (!equalsJson(contract.metrics, [{ id: 'meanDifference', unit: 'points', direction: 'maximize' }]))
    refuse('/contract/metrics', 'The profile registers exactly meanDifference in points, maximizing.');
  if (!equalsJson(plan.evaluator, TABULAR_EVALUATOR)) refuse('/plan/evaluator', 'The group evaluator identity is fixed.');
  if (!equalsJson(contract.replicatePolicy.seeds, TABULAR_PLAN_POLICY.seeds) || contract.replicatePolicy.minimum !== 3
    || contract.replicatePolicy.resamples !== TABULAR_PLAN_POLICY.resamples)
    refuse('/contract/replicatePolicy', 'Use all three registered replay seeds and 2000 paired bootstrap resamples.');
  const baseline = plan.conditions.find(row => row.id === contract.successRule.baseline);
  const candidate = plan.conditions.find(row => row.id === contract.successRule.condition);
  if (plan.conditions.length !== 2 || baseline?.programId !== TABULAR_PROGRAM_IDS.null || candidate?.programId !== TABULAR_PROGRAM_IDS.observed
    || contract.requiredBaselines.length !== 1 || contract.requiredBaselines[0].programId !== TABULAR_PROGRAM_IDS.null
    || contract.requiredBaselines[0].condition !== baseline?.id)
    refuse('/plan/conditions', 'Compare the declared observed sample with its registered paired null control.');
  if (contract.datasets.length !== 1 || plan.inputPaths.length !== 1 || !plan.inputPaths[0].endsWith('.csv')
    || plan.conditions.some(row => row.datasetId !== contract.datasets[0]?.id))
    refuse('/plan/inputPaths', 'Both conditions consume the same complete preregistered CSV.');
  if (plan.conditions.some(row => !equalsJson(Object.keys(row.params), ['delta']) || row.params.delta !== contract.successRule.minImprovement)
    || contract.successRule.minImprovement < 0 || contract.successRule.metric !== 'meanDifference')
    refuse('/plan/conditions/params/delta', 'The declared delta must match the frozen success rule in both conditions.');
  return issues;
}

export async function tabularDomainProfile(prompts: readonly GmplPromptArtifact[]) {
  const packs = immutableResearchJson(prompts);
  return sealDomainProfile({ id: TABULAR_DOMAIN_ID, promptPackIds: packs.map(row => row.id), planValidatorIds: [TABULAR_PLAN_POLICY.id],
    runnerManifestTemplate: { mode: 'fixture', executorContractHash: await researchRevisionOf(RESEARCH_EXECUTOR_CONTRACT),
      resources: { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 }, maxSeeds: 3, maxConditions: 2,
      network: { setup: 'off', measured: 'off' }, bindings: { imageDigest: 'host-image-digest', dependencyLockHash: 'host-dependency-lock',
        datasetPaths: 'preregistered-inputs', codeFiles: 'admitted-code-slots' } },
    evaluatorId: TABULAR_EVALUATOR.id, evaluatorVersion: TABULAR_EVALUATOR.version, units: TABULAR_UNITS,
    rubricId: TABULAR_RUBRIC.id, exportTemplateId: RESEARCH_MARKDOWN_EXPORT_POLICY.id,
    licence: { spdx: 'MIT', manifestPath: 'benchmark/fixtures/research/domains/tabular-statistics/manifest.json' },
    taskFamilies: ['group-difference'], bindingRevisions: [
      ...packs.map(row => ({ id: row.id, kind: 'prompt' as const, revision: row.revision })),
      { id: TABULAR_PLAN_POLICY.id, kind: 'plan-validator', revision: await researchRevisionOf(TABULAR_PLAN_POLICY) },
      { id: TABULAR_EVALUATOR.id, kind: 'evaluator', revision: await researchRevisionOf({ ...TABULAR_EVALUATOR, policy: TABULAR_PLAN_POLICY, rubric: TABULAR_RUBRIC }) },
      { id: TABULAR_RUBRIC.id, kind: 'rubric', revision: await researchRevisionOf(TABULAR_RUBRIC) },
      { id: RESEARCH_MARKDOWN_EXPORT_POLICY.id, kind: 'exporter', revision: await researchRevisionOf(RESEARCH_MARKDOWN_EXPORT_POLICY) },
    ] });
}
