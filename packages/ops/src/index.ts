/**
 * Tangle's operations runtime: background work a host runs and the desktop
 * shows. This first part serves a Jaren store's queue and schedules through
 * the `job_queue` contract (`@tangleai/os/jobs`).
 */
export { jobQueueProvider, jobQueueHandlers } from './provider.ts';
export type { JobStore, JobLease, JobQueueProviderOptions } from './provider.ts';
