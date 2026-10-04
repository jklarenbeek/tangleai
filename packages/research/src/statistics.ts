/** Aggregation belongs to the suite; the host injects its pinned paired statistic. */
import { mean, stddev, median } from '@jarenjs/core/stats';
import type { MetricObservation, ResearchMetricAggregate, ResearchPairedInterval } from './contracts.gen.ts';
import { researchFail } from './workflow-contract.ts';

export type ResearchPairedStatistic = (pairs: readonly (readonly [number, number])[], options: {
  resamples: number; seed: number; level: number;
}) => ResearchPairedInterval;

export function researchAggregate(condition: string, metric: string, unit: string, rows: readonly MetricObservation[]): ResearchMetricAggregate {
  const values = rows.filter(row => row.condition === condition && row.metric === metric)
    .map(row => ({ seed: row.seed, value: row.value, observationId: row.id })).sort((a, b) => a.seed - b.seed);
  const numbers = values.map(row => row.value);
  const result = { condition, metric, unit, values, mean: mean(numbers) ?? null,
    sampleStddev: stddev(numbers) ?? null, median: median(numbers) ?? null, n: values.length };
  if ([result.mean, result.sampleStddev, result.median].some(value => value !== null && !Number.isFinite(value)))
    researchFail('TRSH1002', '/metrics', 'Registered values overflow the finite aggregate contract.');
  return result;
}

/** Keep point estimates independent of the injected interval implementation. */
export function researchPairedEstimate(pairs: readonly (readonly [number, number])[]): number | null {
  const differences = pairs.map(([a, b]) => b - a), estimate = mean(differences) ?? null;
  if (differences.some(value => !Number.isFinite(value)) || estimate !== null && !Number.isFinite(estimate))
    researchFail('TRSH1002', '/evidence/interval', 'Paired differences overflow the finite statistic contract.');
  return estimate;
}
