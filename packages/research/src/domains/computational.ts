/** Authored policy for the existing clustering and retrieval experiments. */
import type { ExperimentPlan, ResearchContract, ResearchDomainProfile, ResearchIssue } from '../contracts.gen.ts';
import { researchArtifacts } from '../domain.ts';
import { RESEARCH_EXECUTOR_CONTRACT } from '../execution/executor.ts';
import { immutableResearchJson, researchRevisionOf } from '../identity.ts';
import { researchIssue } from '../errors.ts';
import { sealDomainProfile } from './profile.ts';

export const COMPUTATIONAL_DOMAIN_ID = 'computational';
export const COMPUTATIONAL_RUBRIC = immutableResearchJson({ id: 'research-computational-rubric', version: '1',
  requirements: ['Preregister metrics, units, directions and baselines.', 'Evaluate retained raw output independently.',
    'Report every seed, failed experiment and negative result.', 'Only the registered statistical rule supports a success claim.'] });
export const COMPUTATIONAL_PLAN_POLICY = immutableResearchJson({ id: 'research-computational-plan', version: '1',
  datasets: 'preregistered', baselines: 'required', inputPaths: 'no-hidden-evaluation-input', statistics: 'declared-replicates' });
export const RESEARCH_MARKDOWN_EXPORT_POLICY = immutableResearchJson({ id: 'research-markdown', version: '1',
  format: 'verified-research-bundle', metrics: 'registered-units', renderer: 'renderMarkdownBundle' });

export function validateComputationalPlan(contract: ResearchContract, plan: ExperimentPlan): ResearchIssue[] {
  const issues: ResearchIssue[] = [];
  if (plan.inputPaths.some(path => path.split(/[\\/]/).includes('hidden')))
    issues.push(researchIssue('TRSH1005', '/plan/inputPaths', 'Evaluation-only data cannot enter program inputs.'));
  if (plan.conditions.some(row => !contract.datasets.some(dataset => dataset.id === row.datasetId)))
    issues.push(researchIssue('TRSH1009', '/plan/conditions', 'Every experiment condition needs its preregistered dataset.'));
  if (contract.requiredBaselines.some(baseline => !plan.conditions.some(row => row.id === baseline.condition && row.programId === baseline.programId)))
    issues.push(researchIssue('TRSH1009', '/plan/conditions', 'Every required baseline must retain its declared program.'));
  if (new Set(contract.replicatePolicy.seeds).size !== contract.replicatePolicy.seeds.length
    || contract.replicatePolicy.seeds.length < contract.replicatePolicy.minimum)
    issues.push(researchIssue('TRSH1009', '/contract/replicatePolicy', 'Distinct preregistered seeds must meet the replicate minimum.'));
  return issues;
}

/** Alternate authored fixtures supply their evaluator identity and units as data. */
export async function computationalDomainProfile(options: {
  evaluator?: { id: string; version: string };
  units?: ResearchDomainProfile['units'];
  resources?: ResearchDomainProfile['runnerManifestTemplate']['resources'];
} = {}) {
  const input = immutableResearchJson(options), evaluator = input.evaluator ?? { id: 'fixture-evaluator', version: '1' };
  const prompts = researchArtifacts.prompts.filter(row => row.id.startsWith('research-'));
  return sealDomainProfile({ id: COMPUTATIONAL_DOMAIN_ID, promptPackIds: prompts.map(row => row.id),
    planValidatorIds: [COMPUTATIONAL_PLAN_POLICY.id],
    runnerManifestTemplate: { mode: 'fixture', executorContractHash: await researchRevisionOf(RESEARCH_EXECUTOR_CONTRACT),
      resources: input.resources ?? { cpu: 1, memoryBytes: 67108864, pids: 16, wallMs: 1000, outputBytes: 65536 },
      maxSeeds: 5, maxConditions: 2, network: { setup: 'off', measured: 'off' },
      bindings: { imageDigest: 'host-image-digest', dependencyLockHash: 'host-dependency-lock',
        datasetPaths: 'preregistered-inputs', codeFiles: 'admitted-code-slots' } },
    evaluatorId: evaluator.id, evaluatorVersion: evaluator.version,
    units: input.units ?? [{ metricId: 'inertia', unit: 'squared-distance', direction: 'minimize' },
      { metricId: 'recall-at-5', unit: 'fraction', direction: 'maximize' }],
    rubricId: COMPUTATIONAL_RUBRIC.id, exportTemplateId: RESEARCH_MARKDOWN_EXPORT_POLICY.id,
    licence: { spdx: 'MIT', manifestPath: 'benchmark/fixtures/research/manifest.json' },
    taskFamilies: ['clustering', 'lexical-retrieval', 'embedding-retrieval'],
    bindingRevisions: [...prompts.map(row => ({ id: row.id, kind: 'prompt' as const, revision: row.revision })),
      { id: COMPUTATIONAL_PLAN_POLICY.id, kind: 'plan-validator', revision: await researchRevisionOf(COMPUTATIONAL_PLAN_POLICY) },
      { id: evaluator.id, kind: 'evaluator', revision: await researchRevisionOf(evaluator) },
      { id: COMPUTATIONAL_RUBRIC.id, kind: 'rubric', revision: await researchRevisionOf(COMPUTATIONAL_RUBRIC) },
      { id: RESEARCH_MARKDOWN_EXPORT_POLICY.id, kind: 'exporter', revision: await researchRevisionOf(RESEARCH_MARKDOWN_EXPORT_POLICY) }],
  });
}
