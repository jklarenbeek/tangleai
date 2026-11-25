/**
 * Background work on the Pages desktop. With an address in Settings,
 * Background work, the desktop reads that host's job queue (the Tangle
 * desktop serves its own at {@link JOB_QUEUE_EXAMPLE}); without one it runs
 * the browser twin: the jobs run in a worker of an open desktop tab, the tab
 * holding the owner lock serves them to every tab. The queue the kernel gets
 * reads that preference on every call, so a new address works at once and
 * removing it returns to the browser. An address follows the web reader's
 * rule, and a host on this computer needs the browser's local-network
 * permission just the same.
 */
import { httpJobQueue, unconfiguredJobQueue, type JobQueue } from '@tangleai/os/jobs';
import { webReaderAddress } from './web-access.ts';

/** Where a Tangle desktop on this machine serves its job queue. */
export const JOB_QUEUE_EXAMPLE = 'http://127.0.0.1:4700/api/job-queue';

/** A job host address as stored: an http(s) address without a query or fragment, `''` for none, `null` when it is not one. */
export const jobQueueAddress = (value: unknown): string | null => webReaderAddress(value);

/**
 * Whether this page runs the browser twin: yes, unless `?twin=0`; a browser
 * driven by automation (the test suites) runs it only when asked with `?twin=1`,
 * so the desktop's other specs never start a worker and a store.
 */
export function twinWanted(search: string, automated: boolean): boolean {
  const asked = new URLSearchParams(search).get('twin');
  if (asked === '0') return false;
  if (asked === '1') return true;
  return !automated;
}

/** The desktop's job queue: the one at the address `address()` answers now, else the browser twin's, else none. */
export function pagesJobQueue(address: () => string, options: { fetch?: typeof globalThis.fetch, twin?: () => JobQueue | null } = {}): JobQueue {
  let cached: { at: string, queue: JobQueue } | null = null;
  const none = unconfiguredJobQueue();
  const current = () => {
    const at = address();
    if (!at) return options.twin?.() ?? none;
    if (cached?.at !== at) cached = { at, queue: httpJobQueue(at, options) };
    return cached.queue;
  };
  return {
    counts: (input) => current().counts(input), page: (input) => current().page(input), get: (input) => current().get(input),
    schedules: (input) => current().schedules(input), cancel: (input) => current().cancel(input),
    requeue: (input) => current().requeue(input), unschedule: (input) => current().unschedule(input),
    events: (input) => current().events(input), health: (input) => current().health(input),
    registry: (input) => current().registry(input), run: (input) => current().run(input),
  };
}

/** Whether a job host answers at `at`: it counts the queue. Any declared answer shows a host is there; silence does not. */
export async function testJobQueue(at: string, options: { fetch?: typeof globalThis.fetch, timeoutMs?: number } = {}): Promise<{ ok: true } | { ok: false, detail: string }> {
  try { await httpJobQueue(at, { ...options, timeoutMs: options.timeoutMs ?? 10_000 }).counts({}); return { ok: true }; }
  catch (error: any) {
    return error?.unanswered === true || !error?.code ? { ok: false, detail: String(error?.message ?? error) } : { ok: true };
  }
}

/**
 * The queue of a browser twin that could not start: every call answers `OS0190`
 * marked `twin`, so Jobs says the background work could not start here (and
 * why) instead of asking for a host; the desktop itself boots as always.
 */
export function failedTwinQueue(detail: string): JobQueue {
  const refuse = async (): Promise<never> => { throw Object.assign(new Error(detail), { code: 'OS0190', twin: true }); };
  return { counts: refuse, page: refuse, get: refuse, schedules: refuse, cancel: refuse, requeue: refuse, unschedule: refuse, events: refuse, health: refuse, registry: refuse, run: refuse };
}
