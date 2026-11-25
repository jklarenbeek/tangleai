/**
 * The attempt history: every attempt of every job the runtime runs, as one
 * event per step in ONE collection of the host's own store (`ops_events`). The
 * host merges `OPS_EVENTS_COLLECTIONS` into its model. Jaren keeps a job's
 * attempt count and last error; this keeps each attempt, until the queue can
 * (asked of Jaren). No event carries a payload or a result: a message is the
 * first 500 characters of an error, nothing more.
 */

export const OPS_EVENTS = 'ops_events';
export type OpsEventName = 'started' | 'completed' | 'failed' | 'lost' | 'cancelled' | 'not-repeated' | 'budget' | 'heartbeat';
export type OpsEvent = {
  id: string, at: number, event: OpsEventName,
  kind?: string, jobId?: string, attempt?: number, day?: string,
  durationMs?: number, code?: string, message?: string, simulated?: boolean,
  runtime?: string, stats?: Record<string, number>,
};

/** The collection the host merges into its model's `collections`. */
export const OPS_EVENTS_COLLECTIONS = {
  [OPS_EVENTS]: {
    schema: {
      type: 'object', required: ['id', 'at', 'event'],
      properties: {
        id: { type: 'string' }, at: { type: 'number' },
        event: { enum: ['started', 'completed', 'failed', 'lost', 'cancelled', 'not-repeated', 'budget', 'heartbeat'] },
        kind: { type: 'string' }, jobId: { type: 'string' }, attempt: { type: 'integer' }, day: { type: 'string' },
        durationMs: { type: 'number' }, code: { type: 'string' }, message: { type: 'string', maxLength: 500 },
        simulated: { type: 'boolean' }, runtime: { type: 'string' }, stats: { type: 'object' },
      },
    },
    key: '/id',
    indexes: [{ name: 'ops_events_by_job', path: '$.jobId' }, { name: 'ops_events_by_at', path: '$.at' }],
  },
} as const;

/** The id of one step of one attempt: replaying a write cannot double it. */
export const eventId = (jobId: string, attempt: number, event: OpsEventName) => `${jobId}#${attempt}:${event}`;

type Collection = { put(doc: unknown): Promise<unknown>, get(key: string): Promise<any>, delete(key: string): Promise<unknown>, execute(query: unknown): Promise<any[]> };
const where = (...clauses: unknown[]) => ({ $for: { it: '$[*]' }, $where: clauses.length === 1 ? clauses[0] : { $and: clauses }, $return: '$it' });
/** The order of an attempt's steps, for events written in the same millisecond. */
const STEP: Record<string, number> = { budget: 0, started: 1, completed: 2, failed: 2, lost: 2, cancelled: 2, 'not-repeated': 3, heartbeat: 4 };
/** A query answers a sequence: nothing, one item, or several. */
const rows = (answer: unknown): any[] => answer === undefined || answer === null ? [] : Array.isArray(answer) ? answer : [answer];

/** Reading and writing the history over a store's `ops_events` collection. */
export function opsEvents(store: { collection(name: string): Collection }) {
  const c = () => store.collection(OPS_EVENTS);
  return {
    write: (event: OpsEvent) => c().put(event),
    get: (id: string) => c().get(id),
    /** Every event of one job, oldest first. */
    async ofJob(jobId: string): Promise<OpsEvent[]> {
      return rows(await c().execute(where({ $eq: ['$it.jobId', jobId] }))).sort((a: OpsEvent, b: OpsEvent) => a.at - b.at || (a.attempt ?? 0) - (b.attempt ?? 0) || STEP[a.event] - STEP[b.event]);
    },
    /** Started attempts of a kind on a day (the budget's count). */
    async startedOn(kind: string, day: string): Promise<number> {
      return rows(await c().execute(where({ $eq: ['$it.kind', kind] }, { $eq: ['$it.event', 'started'] }, { $eq: ['$it.day', day] }))).length;
    },
    /** `started` events with no outcome after them (crashed attempts the queue settled without telling anyone). */
    async orphans(): Promise<OpsEvent[]> {
      const all: OpsEvent[] = rows(await c().execute(where({ $ne: ['$it.event', 'heartbeat'] })));
      const settled = new Set(all.filter(r => r.event !== 'started').map(r => `${r.jobId}#${r.attempt}`));
      return all.filter(r => r.event === 'started' && !settled.has(`${r.jobId}#${r.attempt}`));
    },
    /** Delete history older than `before` (heartbeats are kept: one row per runtime). */
    async prune(before: number): Promise<number> {
      const old: OpsEvent[] = rows(await c().execute(where({ $lt: ['$it.at', before] }, { $ne: ['$it.event', 'heartbeat'] })));
      for (const e of old) await c().delete(e.id);
      return old.length;
    },
    async heartbeats(): Promise<OpsEvent[]> { return rows(await c().execute(where({ $eq: ['$it.event', 'heartbeat'] }))); },
  };
}
