/** One admission owner: evaluator values are reproduced independently before registration. */
import { equalsJson } from '@jarenjs/core/object';
import type { MetricObservation, ResearchContract, ExperimentPlan, ExecutionManifest, ResearchRawOutput } from '../contracts.gen.ts';
import { copyResearchBytes, immutableResearchJson, researchRevisionOf } from '../identity.ts';
import type { ResearchOutcome } from '../errors.ts';
import { validateResearchShape } from '../schema.ts';
import { researchFail, researchValue } from '../workflow-contract.ts';
import { captureResearchWorkspace, researchExecutionOutcome, type ResearchWorkspace } from './manifest.ts';
import { validateResearchExecutionResult, type ResearchExecutionResult } from './executor.ts';

export interface ResearchMetricValue { metric: string; value: number; unit: string; direction?: 'maximize' | 'minimize' }
export interface ResearchEvaluator<Labels> {
  id: string;
  version: string;
  evaluate(input: { rawOutput: ResearchRawOutput; hiddenLabels: Labels; contract: ResearchContract;
    plan: ExperimentPlan; manifest: ExecutionManifest }): Promise<ResearchOutcome<ResearchMetricValue[]>>;
}
export interface ResearchEvaluationInput<Labels> {
  result: ResearchExecutionResult;
  manifest: ExecutionManifest;
  workspace: ResearchWorkspace;
  contract: ResearchContract;
  plan: ExperimentPlan;
  hiddenLabels: Labels;
}
/** This digest proves provenance, not authentication; value reproduction remains mandatory. */
export async function researchObservationSignature(value: Pick<MetricObservation,
  'evaluatorId' | 'evaluatorVersion' | 'runArtifactHash' | 'condition' | 'metric' | 'value' | 'unit' | 'seed' | 'direction'>): Promise<string> {
  const { evaluatorId, evaluatorVersion, runArtifactHash, condition, metric, value: observed, unit, seed, direction } = value;
  return researchRevisionOf({ evaluatorId, evaluatorVersion, runArtifactHash, condition, metric, value: observed, unit, seed,
    ...(direction === undefined ? {} : { direction }) });
}
async function observationId(experimentRunId: string, registrySignature: string): Promise<string> {
  return 'metric-' + await researchRevisionOf({ experimentRunId, registrySignature });
}
function captureInput<Labels>(input: ResearchEvaluationInput<Labels>): ResearchEvaluationInput<Labels> {
  return { ...immutableResearchJson({ manifest: input.manifest, contract: input.contract, plan: input.plan, hiddenLabels: input.hiddenLabels }),
    workspace: captureResearchWorkspace(input.workspace), result: { run: immutableResearchJson(input.result.run),
      artifacts: input.result.artifacts.map(row => ({ artifactId: row.artifactId, bytes: copyResearchBytes(row.bytes) })) } };
}
export function createEvaluationRegistry<Labels>(evaluators: readonly ResearchEvaluator<Labels>[]) {
  const registered = new Map<string, ResearchEvaluator<Labels>>();
  const key = (id: string, version: string) => JSON.stringify([id, version]);
  for (const row of evaluators) {
    if (!row.id || !row.version || registered.has(key(row.id, row.version)) || typeof row.evaluate !== 'function')
      throw new TypeError('Evaluator identities must be nonempty, unique and callable.');
    registered.set(key(row.id, row.version), { id: row.id, version: row.version, evaluate: row.evaluate });
  }
  async function evaluate(input: ResearchEvaluationInput<Labels>): Promise<MetricObservation[]> {
    const { result: supplied, workspace: suppliedWorkspace, ...rest } = captureInput(input);
    const value = immutableResearchJson(rest), workspace = captureResearchWorkspace(suppliedWorkspace);
    const result = researchValue(await validateResearchExecutionResult(supplied, value.manifest, workspace, value));
    const evaluator = registered.get(key(value.manifest.evaluator.id, value.manifest.evaluator.version));
    if (!evaluator) researchFail('TRSH1003', '/evaluator', 'The manifest evaluator is not pinned in this registry.');
    const { run } = result;
    if (run.status !== 'ok' || run.stopReason !== 'completed' || run.exitStatus !== 0 || !run.output || !run.rawArtifactHash)
      researchFail('TRSH1008', '/run', 'Failed or partial experiments cannot register observations.');
    if (run.output.kind === 'files' || run.outputInventory!.some(row => /(?:^|\/)(?:metrics?|observations?)(?:[._-]|$)/i.test(row.path)))
      researchFail('TRSH1005', '/output', 'Program-written metrics remain raw artifacts and cannot enter the registry.');
    const values = immutableResearchJson(researchValue(await evaluator.evaluate({ rawOutput: run.output,
      hiddenLabels: value.hiddenLabels, contract: value.contract, plan: value.plan, manifest: value.manifest })));
    if (values.length !== value.contract.metrics.length || new Set(values.map(row => row.metric)).size !== values.length)
      researchFail('TRSH1006', '/metrics', 'The evaluator must return every registered metric exactly once.');
    const observations: MetricObservation[] = [];
    for (const metric of values) {
      const declared = value.contract.metrics.find(row => row.id === metric.metric);
      if (!declared || declared.unit !== metric.unit || metric.direction !== undefined && metric.direction !== declared.direction || !Number.isFinite(metric.value))
        researchFail('TRSH1006', '/metrics', 'Evaluator output differs from the preregistered metrics, units or finite-value policy.');
      const signed = { evaluatorId: evaluator.id, evaluatorVersion: evaluator.version, runArtifactHash: run.rawArtifactHash,
        condition: run.condition, metric: metric.metric, value: metric.value, unit: metric.unit, seed: run.seed,
        ...(metric.direction === undefined ? {} : { direction: metric.direction }) };
      const registrySignature = await researchObservationSignature(signed);
      observations.push(researchValue(validateResearchShape<MetricObservation>('MetricObservation', {
        ...signed, registrySignature, projectId: run.projectId, experimentRunId: run.id, id: await observationId(run.id, registrySignature),
      })));
    }
    return observations.sort((a, b) => a.metric.localeCompare(b.metric));
  }
  return Object.freeze({
    evaluate: (input: ResearchEvaluationInput<Labels>) => researchExecutionOutcome(() => evaluate(input)),
    registerObservations: (input: ResearchEvaluationInput<Labels>, proposed: readonly MetricObservation[]) => researchExecutionOutcome(async () => {
      // Snapshot proposals before the asynchronous independent evaluation.
      const rows = immutableResearchJson(proposed), captured = captureInput(input), { contract, manifest } = captured;
      for (const row of rows) {
        researchValue(validateResearchShape('MetricObservation', row));
        if (row.condition !== manifest.condition) researchFail('TRSH1003', '/condition', 'Observation condition is not this execution condition.');
        const metric = contract.metrics.find(value => value.id === row.metric);
        if (!metric || metric.unit !== row.unit || row.direction !== undefined && metric.direction !== row.direction)
          researchFail('TRSH1006', '/unit', 'Observation metric, unit or direction is not preregistered.');
        if (row.evaluatorId !== manifest.evaluator.id || row.evaluatorVersion !== manifest.evaluator.version)
          researchFail('TRSH1003', '/evaluator', 'Observation evaluator is not pinned in the manifest.');
        if (row.registrySignature !== await researchObservationSignature(row)) researchFail('TRSH1002', '/registrySignature', 'Observation signature does not recompute.');
      }
      const expected = await evaluate(captured);
      const sorted = [...rows].sort((a, b) => a.metric.localeCompare(b.metric));
      if (!equalsJson(sorted, expected)) researchFail('TRSH1006', '/observations', 'Proposed observations do not reproduce from the retained raw output.');
      return expected;
    }),
  });
}
