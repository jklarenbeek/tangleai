/**
 * The desktop's background work, served to desktop pages: this app's own
 * page, or the Pages desktop on this machine (through Settings, Background
 * work). Two queues answer through the one `job_queue` contract
 * (`@tangleai/os/jobs`), told apart by the call's `scope`:
 *
 *   - `ops` — the runtime this app supervises in a worker thread, when a host
 *     module names its jobs (`--ops <module>`); with several host modules
 *     (`--ops a.ts,b.ts`) each runtime is the scope its module names. Steering
 *     reaches the worker, where the leases live, so a running job can be cancelled;
 *   - `desktop` — the desktop store's own queue (its pipeline's jobs), read
 *     here; this process runs no worker for it, so a running job there is
 *     refused as held, never stolen.
 *
 * A call without a scope reads the (first) runtime when there is one, else the
 * desktop store.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { JOB_CODES, JOB_QUEUE_CONTRACT, type JobQueue } from '@tangleai/os/jobs';
import { jobQueueHandlers, jobQueueProvider } from '@tangleai/ops';
import type { TangleDb } from '@tangleai/store';
import { admittedRoute } from './web-reader.ts';

/** Where the desktop serves its job queue. */
export const JOB_QUEUE_PATH = '/api/job-queue';

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
const METHODS = ['counts', 'page', 'get', 'schedules', 'cancel', 'requeue', 'unschedule', 'events', 'health', 'registry', 'run'] as const;

/** One queue over several by `scope`: a named scope reaches its queue, none the default, another is refused (`OS0194`). */
export function scopedJobQueue(queues: Record<string, JobQueue>, fallback: string): JobQueue {
  const pick = (input: { scope?: string } | undefined) => {
    const scope = input?.scope ?? fallback;
    const queue = queues[scope];
    if (!queue) throw coded(JOB_CODES.scope, `this desktop serves the scopes ${Object.keys(queues).join(', ')}, not ${scope}`);
    const { scope: _, ...rest } = (input ?? {}) as Record<string, unknown>;
    return { queue, input: rest };
  };
  return Object.fromEntries(METHODS.map(m => [m, async (input: any) => { const { queue, input: rest } = pick(input); return (queue as any)[m](rest); }])) as unknown as JobQueue;
}

/**
 * The job queue as a node:http handler for {@link JOB_QUEUE_PATH} and below: the desktop store's queue, and the
 * supervised runtime's (`runtime`) when there is one.
 */
export function desktopJobRoute(db: TangleDb, options: { origins?: readonly string[], runtime?: JobQueue, runtimes?: Record<string, JobQueue> } = {}) {
  // `runtime` is one runtime under the scope `ops`; `runtimes` several, each under its own scope (the first answers a call without one)
  const runtimes: Record<string, JobQueue> = { ...(options.runtime ? { ops: options.runtime } : {}), ...(options.runtimes ?? {}) };
  if ('desktop' in runtimes) throw new TypeError("the scope 'desktop' is the desktop store's own");
  const queues: Record<string, JobQueue> = { desktop: jobQueueProvider(db as any), ...runtimes };
  const fallback = Object.keys(runtimes)[0] ?? 'desktop';
  const dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any), jobQueueHandlers(scopedJobQueue(queues, fallback)) as any, { validateOutput: 'always' });
  const route = admittedRoute(JOB_QUEUE_PATH, toNodeHandler(dispatcher), { origins: options.origins, refusal: 'this origin may not read the job queue' });
  return Object.assign((req: IncomingMessage, res: ServerResponse) => route(req, res), { close: () => dispatcher.close() });
}
