/**
 * Tangle's operations runtime: background work a host runs and the desktop
 * shows. A host's job registry (`./registry`) runs in a Jaren worker
 * (`./runtime`), every attempt kept as history (`./events`); the store's queue
 * and schedules are served through the `job_queue` contract (`./provider`).
 */
export { jobQueueProvider, jobQueueHandlers } from './provider.ts';
export type { JobStore, JobLease, JobQueueProviderOptions } from './provider.ts';
export { checkRegistry, seriesOf, maxAttemptsOf, FIRE_KIND } from './registry.ts';
export type { JobRegistry, RegistryJob, RegistrySchedule, JobSafety, RegistryProblem } from './registry.ts';
export { createOpsRuntime } from './runtime.ts';
export type { OpsRuntime, OpsRuntimeOptions, OpsContract, OpsHandler } from './runtime.ts';
export { OPS_EVENTS, OPS_EVENTS_COLLECTIONS, opsEvents, eventId } from './events.ts';
export type { OpsEvent, OpsEventName } from './events.ts';
