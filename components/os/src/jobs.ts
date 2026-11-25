/**
 * Background work on the desktop: what a host's job queue holds and what its
 * recurring schedules will do, read through one contract, `job_queue`, that a
 * host serves from its own store (Jaren's durable queue and its schedules).
 * The work itself runs in the host's background process, never in the page
 * that shows it; the desktop observes it and the person steers it with the
 * queue's own fenced calls (cancel, requeue, unschedule).
 *
 * What a job carries for its handler (`payload`) and what it answered
 * (`result`) never cross this contract: they are the host's data, often a
 * customer's. A job is its kind, its state, its attempts, its instants and its
 * last error. Every call takes an optional `scope`, the part of a host a
 * desktop asks about (a product); a host that serves one store ignores it or
 * refuses another.
 */
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';

/** The states a job passes through (Jaren JOBS-FORMAT §2, §10). */
export type JobState = 'pending' | 'leased' | 'done' | 'failed' | 'dead' | 'cancelled';
/** One job as the desktop sees it: no payload, no result, no lease internals. */
export type JobItem = {
  id: string, kind: string, state: JobState,
  runAt: number, attempts: number, maxAttempts: number, leaseUntil: number | null,
  lastError: { message: string, code?: string } | null,
  createdAt: number, updatedAt: number,
};
/** How many jobs are in each state; `pendingKinds` counts the waiting ones by kind. */
export type JobCounts = Record<JobState, number> & { pendingKinds: Record<string, number> };
/** A recurring schedule (Jaren JOBS-FORMAT §11): its rule as the document Jaren stored, and where it stands. */
export type JobSchedule = {
  id: string, kind: string,
  series: Record<string, unknown>, zone: string | null, policy: string | null,
  missed: 'skip' | 'once' | { catchUp: number }, latenessMs: number | null,
  state: 'active' | 'unresolved' | 'stalled' | 'ended',
  nextRunAt: number | null, nextRecurrenceId: string | null,
  lastRunAt: number | null, lastRecurrenceId: string | null,
  counts: { fired: number, skipped: number, uncounted?: number },
  stall: Record<string, unknown> | null,
  createdAt: number, updatedAt: number,
};
type Scoped = { scope?: string };
/** One step of one attempt, as the host's runtime recorded it (no payload; a message is at most 500 characters). */
export type JobEvent = { id: string, at: number, event: 'started' | 'completed' | 'failed' | 'lost' | 'cancelled' | 'not-repeated' | 'budget',
  kind?: string, jobId?: string, attempt?: number, durationMs?: number, code?: string, message?: string, simulated?: boolean };
/** A runtime's last heartbeat: when it reported and its worker's counts. */
/** A runtime's last heartbeat; a browser twin also says where it keeps its store and which tab owns it. */
export type JobRuntimeHealth = { runtime: string, at: number, stats: Record<string, number>, storage?: string, owner?: string };
/** A job the host's registry declares: its title, how safe it is to repeat, and its schedule's id when it has one. */
export type RegisteredJob = { kind: string, title: Record<string, string>, description?: Record<string, string>,
  safety: 'safe-read' | 'provider-idempotent' | 'single-send', scheduled: boolean, schedule?: string, owner?: string };

/** What a host's job queue does: the desktop's Jobs app and the assistant's contract call it. */
export type JobQueue = {
  counts(input?: Scoped): Promise<JobCounts>,
  page(input?: Scoped & { state?: JobState, kind?: string, after?: string, limit?: number }): Promise<{ items: JobItem[], next?: string }>,
  get(input: Scoped & { id: string }): Promise<JobItem>,
  schedules(input?: Scoped): Promise<{ schedules: JobSchedule[] }>,
  cancel(input: Scoped & { id: string }): Promise<{ changed: boolean }>,
  requeue(input: Scoped & { id: string }): Promise<{ changed: boolean }>,
  unschedule(input: Scoped & { id: string }): Promise<{ changed: boolean }>,
  events(input: Scoped & { jobId?: string, kind?: string, after?: number, limit?: number }): Promise<{ events: JobEvent[] }>,
  health(input?: Scoped): Promise<{ now: number, runtimes: JobRuntimeHealth[] }>,
  registry(input?: Scoped): Promise<{ jobs: RegisteredJob[] }>,
  run(input: Scoped & { kind: string }): Promise<{ id: string }>,
};

/**
 * Refusals, each a coded error: `OS0190` no job host is configured; `OS0191`
 * no such job or schedule; `OS0192` its state forbids the call (a done job, a
 * live lease on requeue); `OS0193` a claimed job whose lease this host does not
 * hold (another process runs it); `OS0194` a scope this host does not serve; `OS0195` the background
 * runtime is starting or changing tabs (a browser twin between owners), not missing.
 */
export const JOB_CODES = { unconfigured: 'OS0190', unknown: 'OS0191', refused: 'OS0192', held: 'OS0193', scope: 'OS0194', starting: 'OS0195' } as const;

const ID = { type: 'string', minLength: 1, maxLength: 512 } as const;
const SCOPE = { type: 'string', minLength: 1, maxLength: 120 } as const;
const MS = { type: 'number' } as const;
const MS_OR_NULL = { type: ['number', 'null'] } as const;
const TEXT_OR_NULL = { type: ['string', 'null'], maxLength: 200 } as const;
const STATE = { enum: ['pending', 'leased', 'done', 'failed', 'dead', 'cancelled'] } as const;
const COUNT = { type: 'integer', minimum: 0 } as const;
const scoped = (properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ type: 'object', additionalProperties: false, required, properties: { scope: SCOPE, ...properties } });
export const JOB_ITEM_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'state', 'runAt', 'attempts', 'maxAttempts', 'leaseUntil', 'lastError', 'createdAt', 'updatedAt'],
  properties: {
    id: ID, kind: { type: 'string', maxLength: 200 }, state: STATE,
    runAt: MS, attempts: COUNT, maxAttempts: COUNT, leaseUntil: MS_OR_NULL,
    lastError: { oneOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['message'], properties: { message: { type: 'string', maxLength: 2000 }, code: { type: 'string', maxLength: 40 } } }] },
    createdAt: MS, updatedAt: MS,
  },
} as const;
const SCHEDULE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['id', 'kind', 'series', 'zone', 'policy', 'missed', 'latenessMs', 'state', 'nextRunAt', 'nextRecurrenceId', 'lastRunAt', 'lastRecurrenceId', 'counts', 'stall', 'createdAt', 'updatedAt'],
  properties: {
    id: ID, kind: { type: 'string', maxLength: 200 }, series: { type: 'object' },
    zone: TEXT_OR_NULL, policy: TEXT_OR_NULL,
    missed: { oneOf: [{ enum: ['skip', 'once'] }, { type: 'object', additionalProperties: false, required: ['catchUp'], properties: { catchUp: COUNT } }] },
    latenessMs: MS_OR_NULL, state: { enum: ['active', 'unresolved', 'stalled', 'ended'] },
    nextRunAt: MS_OR_NULL, nextRecurrenceId: TEXT_OR_NULL, lastRunAt: MS_OR_NULL, lastRecurrenceId: TEXT_OR_NULL,
    counts: { type: 'object', additionalProperties: false, required: ['fired', 'skipped'], properties: { fired: COUNT, skipped: COUNT, uncounted: COUNT } },
    stall: { type: ['object', 'null'] }, createdAt: MS, updatedAt: MS,
  },
} as const;
const KIND = { type: 'string', minLength: 1, maxLength: 200 } as const;
const TEXTS = { type: 'object', additionalProperties: { type: 'string', maxLength: 2000 } } as const;
const EVENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['id', 'at', 'event'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 600 }, at: MS,
    event: { enum: ['started', 'completed', 'failed', 'lost', 'cancelled', 'not-repeated', 'budget'] },
    kind: KIND, jobId: ID, attempt: COUNT, durationMs: { type: 'number', minimum: 0 },
    code: { type: 'string', maxLength: 40 }, message: { type: 'string', maxLength: 500 }, simulated: { type: 'boolean' },
  },
} as const;
const HEALTH_SCHEMA = { type: 'object', additionalProperties: false, required: ['runtime', 'at', 'stats'], properties: { runtime: { type: 'string', minLength: 1, maxLength: 200 }, at: MS, stats: { type: 'object', additionalProperties: { type: 'number' } }, storage: { type: 'string', maxLength: 40 }, owner: { type: 'string', maxLength: 120 } } } as const;
const REGISTERED_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['kind', 'title', 'safety', 'scheduled'],
  properties: { kind: KIND, title: TEXTS, description: TEXTS, safety: { enum: ['safe-read', 'provider-idempotent', 'single-send'] }, scheduled: { type: 'boolean' }, schedule: ID, owner: { type: 'string', maxLength: 200 } },
} as const;
const CHANGED = { type: 'object', additionalProperties: false, required: ['changed'], properties: { changed: { type: 'boolean' } } } as const;
const ERRORS = { unknown: { status: 404 }, refused: { status: 409 }, held: { status: 423 }, scope: { status: 400 }, starting: { status: 503 } } as const;

/** The provider contract a host serves (over HTTP from its server, or in a worker). */
export const JOB_QUEUE_CONTRACT = {
  $contract: '0.1',
  id: 'job_queue',
  operations: {
    'jobs.counts': { kind: 'read', doc: 'How many jobs are in each state, and how many wait per kind.', input: scoped(),
      output: { type: 'object', additionalProperties: false, required: ['pending', 'leased', 'done', 'failed', 'dead', 'cancelled', 'pendingKinds'],
        properties: { pending: COUNT, leased: COUNT, done: COUNT, failed: COUNT, dead: COUNT, cancelled: COUNT, pendingKinds: { type: 'object', additionalProperties: COUNT } } }, errors: ERRORS },
    'jobs.page': { kind: 'read', doc: 'A page of jobs by id, filtered by state and kind; `next` continues after the last one.',
      input: scoped({ state: STATE, kind: { type: 'string', minLength: 1, maxLength: 200 }, after: ID, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
      output: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: 200, items: JOB_ITEM_SCHEMA }, next: ID } }, errors: ERRORS },
    'jobs.get': { kind: 'read', doc: 'One job: its kind, state, attempts, instants and last error.', input: scoped({ id: ID }, ['id']), output: JOB_ITEM_SCHEMA, errors: ERRORS },
    'jobs.schedules': { kind: 'read', doc: 'Every recurring schedule: its rule, zone, state, next and last run, and how many it fired and skipped.', input: scoped(),
      output: { type: 'object', additionalProperties: false, required: ['schedules'], properties: { schedules: { type: 'array', maxItems: 1000, items: SCHEDULE_SCHEMA } } }, errors: ERRORS },
    'jobs.cancel': { kind: 'command', doc: 'Cancel a waiting job, or a running one this host holds the lease of.', input: scoped({ id: ID }, ['id']), output: CHANGED, errors: ERRORS },
    'jobs.requeue': { kind: 'command', doc: 'Return a failed, dead or cancelled job to the queue; its attempts are kept.', input: scoped({ id: ID }, ['id']), output: CHANGED, errors: ERRORS },
    'jobs.unschedule': { kind: 'command', doc: 'Remove a recurring schedule; the jobs it fired stay.', input: scoped({ id: ID }, ['id']), output: CHANGED, errors: ERRORS },
    'jobs.events': { kind: 'read', doc: 'The attempts the host\'s runtime recorded, newest first: started, completed, failed, lost, cancelled, not repeated, or refused by its budget; filtered by job, kind, and time (`after`, exclusive).',
      input: scoped({ jobId: ID, kind: KIND, after: MS, limit: { type: 'integer', minimum: 1, maximum: 200 } }),
      output: { type: 'object', additionalProperties: false, required: ['events'], properties: { events: { type: 'array', maxItems: 200, items: EVENT_SCHEMA } } }, errors: ERRORS },
    'jobs.health': { kind: 'read', doc: 'When each of the host\'s runtimes last reported, with its worker\'s counts, and the host\'s own time.', input: scoped(),
      output: { type: 'object', additionalProperties: false, required: ['now', 'runtimes'], properties: { now: MS, runtimes: { type: 'array', maxItems: 100, items: HEALTH_SCHEMA } } }, errors: ERRORS },
    'jobs.registry': { kind: 'read', doc: 'The jobs the host\'s registry declares: their titles, how safe each is to repeat, and their schedules.', input: scoped(),
      output: { type: 'object', additionalProperties: false, required: ['jobs'], properties: { jobs: { type: 'array', maxItems: 500, items: REGISTERED_SCHEMA } } }, errors: ERRORS },
    'jobs.run': { kind: 'command', doc: 'Run a registered job now, once; refused while a job of that kind waits or runs.', input: scoped({ kind: KIND }, ['kind']),
      output: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: ID } }, errors: ERRORS },
  },
} as const;

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

/** A queue that answers `OS0190` for everything: a desktop with no job host. */
export const unconfiguredJobQueue = (): JobQueue => {
  const refuse = async (): Promise<never> => { throw coded(JOB_CODES.unconfigured, 'no job host is configured on this desktop'); };
  return { counts: refuse, page: refuse, get: refuse, schedules: refuse, cancel: refuse, requeue: refuse, unschedule: refuse, events: refuse, health: refuse, registry: refuse, run: refuse };
};

let compiled: any = null;
/**
 * The queue a host serves at `baseUrl` (for example `http://127.0.0.1:4700/api/job-queue`). Its declared
 * answers become the codes above; a host that cannot be reached, or answers outside the contract, is
 * `OS0190` marked `unanswered: true`.
 */
export function httpJobQueue(baseUrl: string, options: { fetch?: typeof globalThis.fetch, timeoutMs?: number } = {}): JobQueue {
  compiled ??= compileContract(JOB_QUEUE_CONTRACT as any);
  const client = openHttpClient(compiled, { baseUrl: baseUrl.replace(/\/+$/, ''), timeoutMs: options.timeoutMs ?? 15_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const invoke = async (op: string, input: unknown) => {
    const outcome: any = await client.invoke(op, input ?? {});
    if (outcome.ok) return outcome.value;
    const detail = String(outcome.error?.details?.detail ?? outcome.error?.message ?? outcome.kind);
    const declared = outcome.kind === 'failure' ? (JOB_CODES as Record<string, string>)[outcome.error?.code] : undefined;
    if (declared) throw coded(declared, detail);
    throw Object.assign(coded(JOB_CODES.unconfigured, `the job host at ${baseUrl} did not answer: ${detail}`), { unanswered: true });
  };
  return {
    counts: (input) => invoke('jobs.counts', input), page: (input) => invoke('jobs.page', input),
    get: (input) => invoke('jobs.get', input), schedules: (input) => invoke('jobs.schedules', input),
    cancel: (input) => invoke('jobs.cancel', input), requeue: (input) => invoke('jobs.requeue', input),
    unschedule: (input) => invoke('jobs.unschedule', input),
    events: (input) => invoke('jobs.events', input), health: (input) => invoke('jobs.health', input),
    registry: (input) => invoke('jobs.registry', input), run: (input) => invoke('jobs.run', input),
  };
}
