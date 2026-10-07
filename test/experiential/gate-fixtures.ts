/** Recorded-value conformance inputs; no candidate or model was measured by this fixture. */
import { EXPERIENTIAL_EVALUATION_ROWS, EXPERIENTIAL_RETENTION_LANES } from '@tangleai/experiential';
import type { ExperientialGatePolicy, ExperientialEvaluationMetrics } from '@tangleai/experiential';

export function passingGateMetrics(policy: ExperientialGatePolicy, artifactBytes = 1024): ExperientialEvaluationMetrics {
  return { scope: policy.scope, gatePolicyId: policy.id, migrationExperiment: false,
    rows: EXPERIENTIAL_EVALUATION_ROWS.map(rowId => ({ rowId, status: 'run', cgc: rowId === 'candidate-no-retrieval' ? 0.75 : 0.5,
      retention: 1, failures: 0, cost: null, identityId: 'd'.repeat(64), samples: 32 })),
    interval: policy.controls.map(control => ({ control, low: 0.125, high: 0.375, resamples: policy.interval.resamples,
      seed: policy.interval.seed, level: policy.interval.level, pairs: 32 })),
    retention: EXPERIENTIAL_RETENTION_LANES.map(lane => ({ lane, status: 'run', drop: 0 })),
    security: policy.security.fixtures.map(fixtureId => ({ fixtureId, outcome: 'unchanged' })),
    operations: { status: 'run', artifactBytes, trainingMs: 1, inferenceP95Ms: 1, failureRate: 0, cost: 0, runtimeProvider: 'fixture' }, cost: null };
}
