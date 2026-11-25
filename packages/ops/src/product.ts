/**
 * A product's background work, run where the product runs: in the product's own server process, on the product's own
 * store. A product enqueues jobs inside its own transactions, from its own code, and fences its pushes with its own
 * effect stores — all of which needs the queue in its store, so the runtime comes to the store, not the other way. The
 * work stays off the request path (a Jaren worker loop) and never runs in a page.
 *
 * `productJobs` starts the runtime on the product's store and serves the store's queue through the `job_queue`
 * contract at the product's own address, `/<scope>/api/job-queue`. A suite's server module calls it in its `start`
 * and answers with its `handle`; because each product's queue has its own path, the host's authorization by path
 * guards one product's jobs from a person without that product's rights. A desktop shows several products through
 * `combinedJobQueue` (`@tangleai/os/jobs`), one `httpJobQueue` per product's address.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { JOB_QUEUE_CONTRACT } from '@tangleai/os/jobs';
import { jobQueueHandlers, jobQueueProvider } from './provider.ts';
import { createOpsRuntime, type OpsContract, type OpsHandler, type OpsRuntime } from './runtime.ts';
import type { JobRegistry } from './registry.ts';

export type ProductJobsOptions = {
  /** The product's id: its registry's schedules are `ops:<registry name>:<kind>`, its queue's address `/<scope>/api/job-queue`. */
  scope: string,
  title: Record<string, string>,
  /** The product's own Jaren store, opened with `jobs: { schedules: jobSchedules() }` and `OPS_EVENTS_COLLECTIONS` in its model. */
  store: any,
  registry: JobRegistry,
  handlers?: Record<string, OpsHandler>,
  contracts?: Record<string, OpsContract>,
  now?: () => number,
  /** The runtime's stable id (its heartbeat row); default `<scope>@product`. */
  id?: string,
};
export type ProductJobs = {
  runtime: OpsRuntime,
  /** The address the product's queue answers at. */
  path: string,
  start(): Promise<void>,
  stop(): Promise<void>,
  /** Answer a request for {@link path} (and below); `false` for any other path, which the caller handles. */
  handle(req: IncomingMessage, res: ServerResponse): boolean,
};

const SCOPE = /^[a-z][a-z0-9-]{0,39}$/;

/** The product's background work on its own store, and its queue served at its own address. */
export function productJobs(options: ProductJobsOptions): ProductJobs {
  if (!SCOPE.test(options.scope)) throw new TypeError(`a scope is a lower-case name of letters, digits and hyphens, not '${options.scope}'`);
  const runtime = createOpsRuntime({
    store: options.store, registry: options.registry,
    ...(options.handlers ? { handlers: options.handlers } : {}), ...(options.contracts ? { contracts: options.contracts } : {}),
    ...(options.now ? { now: options.now } : {}), id: options.id ?? `${options.scope}@product`,
  });
  const path = `/${options.scope}/api/job-queue`;
  const dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any),
    jobQueueHandlers(jobQueueProvider(options.store, { runtime, scope: options.scope })) as any, { validateOutput: 'always' });
  const node = toNodeHandler(dispatcher);
  return {
    runtime, path,
    start: () => runtime.start(),
    async stop() { await runtime.stop(); await dispatcher.close(); },
    handle(req, res) {
      const url = req.url ?? '/';
      const at = url.split('?')[0];
      if (at !== path && !at.startsWith(`${path}/`)) return false;
      // the contract's routes are relative to its base: strip the product's prefix
      req.url = url.slice(path.length) || '/';
      void node(req, res);
      return true;
    },
  };
}
