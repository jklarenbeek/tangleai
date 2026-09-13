/** Immutable experiment controls; independent of corpus and answerer module initialization. */
export const TEMPORAL_ROWS = ['legacy-default', 'timestamp-context-only', 'matched-pool-lane-off',
  'observed-session-filter', 'validity-asof-on', 'full-kernel', 'oracle-evidence', 'oracle-window'] as const;
export type TemporalRow = typeof TEMPORAL_ROWS[number];
export const TEMPORAL_CONTROLS = {
  seed: 17753, developmentFraction: 0.2, profiles: ['provided-history', 'strict-as-of'],
  candidatePool: 100, outputK: 10, minScore: 0, embedder: { model: 'hash-trigram-512', dims: 512 },
  roles: ['user', 'assistant'], normalization: 'synthetic-UTC-minute', rows: TEMPORAL_ROWS,
  bootstrap: { resamples: 10000, seed: 17753, confidence: 0.95, quantile: 'nearest-rank' },
  gate: { temporalLowerBoundExclusive: 0, regressionLowerBound: -0.05, coldCostRatio: 3,
    amortizedCostRatio: 2, amortizationQueries: 100, warmP95Ratio: 2, default: 'off' },
} as const;
