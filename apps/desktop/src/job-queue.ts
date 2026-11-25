/**
 * The desktop's background work, served to desktop pages: this app's own
 * page, or the Pages desktop on this machine (through Settings, Background
 * work). The store's queue and its recurring schedules answer through the
 * `job_queue` contract (`@tangleai/os/jobs`), each steering call through
 * Jaren's own fence. This process runs no job worker, so it holds no lease: a
 * running job is refused as held by another process, never stolen.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { JOB_QUEUE_CONTRACT } from '@tangleai/os/jobs';
import { jobQueueHandlers, jobQueueProvider } from '@tangleai/ops';
import type { TangleDb } from '@tangleai/store';
import { admittedRoute } from './web-reader.ts';

/** Where the desktop serves its job queue. */
export const JOB_QUEUE_PATH = '/api/job-queue';

/** The job queue of `db` as a node:http handler for {@link JOB_QUEUE_PATH} and below. */
export function desktopJobRoute(db: TangleDb, options: { origins?: readonly string[] } = {}) {
  const dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any), jobQueueHandlers(jobQueueProvider(db as any)) as any, { validateOutput: 'always' });
  const route = admittedRoute(JOB_QUEUE_PATH, toNodeHandler(dispatcher), { origins: options.origins, refusal: 'this origin may not read the job queue' });
  return Object.assign((req: IncomingMessage, res: ServerResponse) => route(req, res), { close: () => dispatcher.close() });
}
