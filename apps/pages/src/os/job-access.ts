/**
 * Background work on the Pages desktop: a page on GitHub Pages has no store
 * and runs no jobs, so it reads a host's job queue (the Tangle desktop serves
 * its own at {@link JOB_QUEUE_EXAMPLE}) at the address the person set in
 * Settings, Background work. The queue the kernel gets reads that preference
 * on every call, so a new address works at once; with none set it answers
 * `OS0190`. An address follows the web reader's rule, and a reader on this
 * computer needs the browser's local-network permission just the same.
 */
import { httpJobQueue, unconfiguredJobQueue, type JobQueue } from '@tangleai/os/jobs';
import { webReaderAddress } from './web-access.ts';

/** Where a Tangle desktop on this machine serves its job queue. */
export const JOB_QUEUE_EXAMPLE = 'http://127.0.0.1:4700/api/job-queue';

/** A job host address as stored: an http(s) address without a query or fragment, `''` for none, `null` when it is not one. */
export const jobQueueAddress = (value: unknown): string | null => webReaderAddress(value);

/** The desktop's job queue: the one at the address `address()` answers now, or none. */
export function pagesJobQueue(address: () => string, options: { fetch?: typeof globalThis.fetch } = {}): JobQueue {
  let cached: { at: string, queue: JobQueue } | null = null;
  const none = unconfiguredJobQueue();
  const current = () => {
    const at = address();
    if (!at) return none;
    if (cached?.at !== at) cached = { at, queue: httpJobQueue(at, options) };
    return cached.queue;
  };
  return {
    counts: (input) => current().counts(input), page: (input) => current().page(input), get: (input) => current().get(input),
    schedules: (input) => current().schedules(input), cancel: (input) => current().cancel(input),
    requeue: (input) => current().requeue(input), unschedule: (input) => current().unschedule(input),
  };
}

/** Whether a job host answers at `at`: it counts the queue. Any declared answer shows a host is there; silence does not. */
export async function testJobQueue(at: string, options: { fetch?: typeof globalThis.fetch, timeoutMs?: number } = {}): Promise<{ ok: true } | { ok: false, detail: string }> {
  try { await httpJobQueue(at, { ...options, timeoutMs: options.timeoutMs ?? 10_000 }).counts({}); return { ok: true }; }
  catch (error: any) {
    return error?.unanswered === true || !error?.code ? { ok: false, detail: String(error?.message ?? error) } : { ok: true };
  }
}
