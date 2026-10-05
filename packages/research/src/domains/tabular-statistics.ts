/** Sample evidence is reproduced from immutable CSV inputs before the registry signs it. */
import { drawDistinct, mulberry32 } from '@jarenjs/core/random';
import { equalsJson } from '@jarenjs/core/object';
import type { GmplPromptArtifact } from '@tangleai/gmpl';
import profile from '../../artifacts/tabular-statistics.profile.json' with { type: 'json' };
import context from '../../artifacts/tabular-context.json' with { type: 'json' };
import type { ResearchDomainProfile, RawTabularOutput, ResearchContract, ExperimentPlan, TabularSample } from '../contracts.gen.ts';
import type { ResearchEvaluator } from '../execution/registry.ts';
import type { ResearchFixtureProgram } from '../execution/fixture-executor.ts';
import { researchExecutionOutcome } from '../execution/manifest.ts';
import { immutableResearchJson, researchArtifactIdOf } from '../identity.ts';
import { researchRefuse } from '../errors.ts';
import { researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { TABULAR_EVALUATOR, TABULAR_PROGRAM_IDS, validateTabularPlan } from './tabular-definition.ts';
import { parseTabularSamples, tabularStatistics } from './tabular-data.ts';

export const TABULAR_STATISTICS_PROFILE = immutableResearchJson(profile) as ResearchDomainProfile;
export const TABULAR_CONTEXT_PROMPT = immutableResearchJson(context) as GmplPromptArtifact;

/** The null control sets A equal to its paired B; it never writes a metric. */
function transformedRows(rows: readonly TabularSample[], nullControl: boolean): TabularSample[] {
  const b = new Map(rows.filter(row => row.group === 'B').map(row => [row.pairId, row.value]));
  return rows.map(row => ({ ...row, value: nullControl && row.group === 'A' ? b.get(row.pairId)! : row.value }));
}
export function tabularStatisticsPrograms(): Readonly<Record<string, ResearchFixtureProgram>> {
  const program = (nullControl: boolean): ResearchFixtureProgram => async ({ bytes, seed }) => {
    const captured = new Uint8Array(bytes);
    const rows = transformedRows(researchValue(parseTabularSamples(new TextDecoder('utf-8', { fatal: true }).decode(captured))), nullControl);
    return { kind: 'tabular', datasetSha256: (await researchArtifactIdOf(captured)).slice(4),
      rows: drawDistinct(mulberry32(seed), rows.length, rows.length).map(index => rows[index]) };
  };
  return Object.freeze({ [TABULAR_PROGRAM_IDS.observed]: program(false), [TABULAR_PROGRAM_IDS.null]: program(true) });
}

export function createTabularStatisticsEvaluator(options: { datasets: Readonly<Record<string, string>> }): ResearchEvaluator<null> {
  const datasets = immutableResearchJson(options.datasets);
  if (Object.values(datasets).some(csv => typeof csv !== 'string')) throw new TypeError('The evaluator needs immutable CSV strings by dataset id.');
  return Object.freeze({ ...TABULAR_EVALUATOR, evaluate: supplied => researchExecutionOutcome(async () => {
    const input = immutableResearchJson(supplied);
    const contract = researchValue(validateResearchShape<ResearchContract>('ResearchContract', input.contract));
    const plan = researchValue(validateResearchShape<ExperimentPlan>('ExperimentPlan', input.plan));
    const issues = validateTabularPlan(contract, plan); if (issues.length) return researchValue({ valid: false, issues });
    if (input.rawOutput.kind !== 'tabular') return researchValue(researchRefuse('TRSH1005', '/rawOutput', 'Only complete raw paired samples can enter this evaluator.'));
    const raw = researchValue(validateResearchShape<RawTabularOutput>('RawTabularOutput', input.rawOutput));
    const condition = plan.conditions.find(row => row.id === input.manifest.condition);
    const registered = contract.datasets.find(row => row.id === input.manifest.datasetId);
    if (!condition || condition.datasetId !== registered?.id || condition.programId !== input.manifest.programId
      || !equalsJson(condition.params, input.manifest.params) || !Object.hasOwn(datasets, registered.id))
      return researchValue(researchRefuse('TRSH1003', '/manifest', 'The evaluator needs the exact registered dataset, condition and program.'));
    const csv = datasets[registered.id], digest = (await researchArtifactIdOf(new TextEncoder().encode(csv))).slice(4);
    if (digest !== registered.sha256 || raw.datasetSha256 !== digest)
      return researchValue(researchRefuse('TRSH1002', '/datasetSha256', 'Source CSV bytes do not reproduce the preregistered dataset hash.'));
    const source = researchValue(parseTabularSamples(csv));
    const expected = transformedRows(source, condition.programId === TABULAR_PROGRAM_IDS.null);
    const byId = new Map(expected.map(row => [row.id, row]));
    if (raw.rows.some(row => row.unit !== 'points'))
      return researchValue(researchRefuse('TRSH1006', '/rawOutput/rows/unit', 'Raw samples must retain the declared points unit.'));
    if (raw.rows.length !== expected.length || new Set(raw.rows.map(row => row.id)).size !== expected.length
      || raw.rows.some(row => !equalsJson(row, byId.get(row.id))))
      return researchValue(researchRefuse('TRSH1002', '/rawOutput/rows', 'Raw values must reproduce every declared sample and its registered transform; asserted numbers are refused.'));
    const summary = researchValue(tabularStatistics(raw.rows, contract.replicatePolicy.bootstrapSeed));
    return [{ metric: 'meanDifference', value: summary.meanDifference, unit: 'points', direction: 'maximize' as const }];
  }) } satisfies ResearchEvaluator<null>);
}
