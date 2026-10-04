/** The suite owns paired sampling; all research intervals use this pinned adapter. */
import { pairedBootstrap } from '@jarenjs/core/stats';
import type { ResearchPairedStatistic } from '@tangleai/research';

export const researchPairedStatistic: ResearchPairedStatistic = (pairs, options) => pairedBootstrap(pairs, {
  ...options, quantile: 'nearest-rank', maxWork: 1_000_000,
});
