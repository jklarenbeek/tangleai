/**
 * The fixture's combined queue, following the pinned `combinedJobQueue`
 * signature (`@tangleai/os/jobs`) so the desktop's scope handling can be
 * driven before the library half lands: every call is routed by its
 * `scope`; with more than one product a call without one is refused
 * `OS0194`; `scopes()` lists the products.
 */
import { JOB_CODES, type JobQueue, type JobScope } from '@tangleai/os/jobs';

export function fixtureCombinedQueue(entries: { scope: string, title: Record<string, string>, queue: JobQueue }[]): JobQueue & { scopes(): JobScope[] } {
  const pick = (input: any) => {
    const scope = input?.scope;
    if (scope === undefined && entries.length === 1) return { queue: entries[0].queue, rest: input };
    const found = entries.find(e => e.scope === scope);
    if (!found) throw Object.assign(new Error(scope === undefined ? 'this host runs several products: name one' : `this host runs no product '${scope}'`), { code: JOB_CODES.scope });
    const { scope: _drop, ...rest } = input ?? {};
    return { queue: found.queue, rest };
  };
  const route = (op: keyof JobQueue) => async (input?: any) => { const { queue, rest } = pick(input); return (queue as any)[op](rest); };
  return {
    counts: route('counts'), page: route('page'), get: route('get'), schedules: route('schedules'), cancel: route('cancel'),
    requeue: route('requeue'), unschedule: route('unschedule'), events: route('events'), health: route('health'),
    registry: route('registry'), run: route('run'),
    scopes: () => entries.map(e => ({ scope: e.scope, title: e.title })),
  } as JobQueue & { scopes(): JobScope[] };
}
