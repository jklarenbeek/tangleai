/**
 * The desktop's job watcher: background work that needs a person reaches them.
 * A job that dies is in the inbox on the watcher's next look (≤ one interval,
 * 30 s by default) — against "until someone opens a settings page" before;
 * one item per job however often it is seen; Run again requeues exactly once,
 * Dismiss calls nothing and is remembered; a runtime that stops reporting is
 * one item, taken back when it reports; the notice waits for working hours
 * and comes again when they begin.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, watchJobs, withinHours, type JobQueue, type JobItem, type JobEvent, type WorkingHours } from '@tangleai/os';

const MON_1000 = Date.parse('2027-03-01T10:00:00Z'), SAT_1000 = Date.parse('2027-03-06T10:00:00Z'), MON_0905 = Date.parse('2027-03-08T09:05:00Z');
const HOURS: WorkingHours = { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' };

function fakeQueue(clock: { t: number }) {
  const jobs = new Map<string, JobItem>();
  const events: JobEvent[] = [];
  const runtimes = [{ runtime: 'shop@host', at: clock.t, stats: {} as Record<string, number> }];
  const requeued: string[] = [];
  const job = (id: string, state: JobItem['state'], attempts = 5, message = 'the courier refused the parcel'): JobItem =>
    ({ id, kind: 'orders.push', state, runAt: clock.t, attempts, maxAttempts: 5, leaseUntil: null, lastError: { message }, createdAt: clock.t, updatedAt: clock.t });
  const queue: JobQueue = {
    counts: async () => ({ pending: 0, leased: 0, done: 0, failed: 0, dead: 0, cancelled: 0, pendingKinds: {} }),
    page: async ({ state } = {}) => ({ items: [...jobs.values()].filter(j => !state || j.state === state) }),
    get: async ({ id }) => { const j = jobs.get(id); if (!j) throw Object.assign(new Error('unknown'), { code: 'OS0191' }); return j; },
    schedules: async () => ({ schedules: [] }),
    cancel: async () => ({ changed: true }),
    requeue: async ({ id }) => { requeued.push(id); jobs.set(id, { ...jobs.get(id)!, state: 'pending' }); return { changed: true }; },
    unschedule: async () => ({ changed: true }),
    events: async ({ after } = {}) => ({ events: events.filter(e => after === undefined || e.at > after).sort((a, b) => b.at - a.at) }),
    health: async () => ({ now: clock.t, runtimes: runtimes.map(r => ({ ...r })) }),
    registry: async () => ({ jobs: [{ kind: 'orders.push', title: { en: 'Send the orders', nl: 'De orders verzenden' }, safety: 'single-send' as const, scheduled: true, owner: 'warehouse' }] }),
    run: async () => ({ id: 'x' }),
  };
  return { queue, jobs, events, runtimes, requeued, job };
}

function setup(start: number, hours: WorkingHours | null = HOURS, memory?: { load(): Record<string, number>, save(d: Record<string, number>): void }) {
  const clock = { t: start };
  const fake = fakeQueue(clock);
  const kernel = createKernel({ jobs: fake.queue, now: () => clock.t } as any);
  const timers: (() => void)[] = [];
  const watch = watchJobs({ kernel: kernel as any, queue: fake.queue, now: () => clock.t, hours: () => hours ?? undefined, zone: 'UTC', remember: memory,
    setTimer: (run) => { timers.push(run); return timers.length; }, clearTimer: () => {} });
  const items = (kind = 'job.failed') => kernel.mail().filter(m => m.from === 'desktop' && m.proposal?.kind === kind);
  return { clock, fake, kernel, watch, items, timers };
}

describe('the desktop\'s job watcher', () => {
  it('reads working hours in a zone, and never counts unknown hours as working time', () => {
    assert.equal(withinHours(MON_1000, HOURS, 'UTC'), true);
    assert.equal(withinHours(SAT_1000, HOURS, 'UTC'), false);
    assert.equal(withinHours(Date.parse('2027-03-01T17:00:00Z'), HOURS, 'UTC'), false, 'the end is exclusive');
    assert.equal(withinHours(MON_1000, undefined, 'UTC'), false);
    assert.equal(withinHours(Date.parse('2027-03-01T08:30:00Z'), HOURS, 'Europe/Amsterdam'), true, '09:30 in Amsterdam');
  });

  it('files a job that dies on its next look (one interval), once however often it is seen, with the registry\'s title and owner', async () => {
    const { fake, watch, items, timers } = setup(MON_1000);
    await watch.tick();
    assert.equal(items().length, 0);
    fake.jobs.set('push-1', fake.job('push-1', 'dead'));
    timers[0]();   // the interval fires
    await watch.tick();
    for (let i = 0; i < 4; i++) await watch.tick();
    assert.equal(items().length, 1);
    const [item] = items();
    assert.equal(item.attention, true, 'noticed: it is working time');
    assert.deepEqual({ ...(item.proposal!.payload as any), note: undefined }, { jobId: 'push-1', kind: 'orders.push', reason: 'dead', attempts: 5, titles: { en: 'Send the orders', nl: 'De orders verzenden' }, owner: 'warehouse', lastError: 'the courier refused the parcel', untrusted: true, note: undefined });
  });

  it('Run again requeues exactly once; a job that changed meanwhile stays pending with OS0112', async () => {
    const { fake, kernel, watch, items } = setup(MON_1000);
    fake.jobs.set('push-1', fake.job('push-1', 'dead'));
    fake.jobs.set('push-2', fake.job('push-2', 'dead'));
    await watch.tick();
    const [one, two] = items();
    assert.equal((await kernel.decide(one.id, 'accept')).ok, true);
    assert.deepEqual(fake.requeued, ['push-1']);
    await watch.tick();
    assert.deepEqual(fake.requeued, ['push-1'], 'not again');
    fake.jobs.set('push-2', { ...fake.jobs.get('push-2')!, state: 'done' });
    const stale: any = await kernel.decide(two.id, 'accept');
    assert.equal(stale.error.code, 'OS0112');
    assert.equal(items().find(m => m.id === two.id)!.proposal!.status, 'pending');
    assert.deepEqual(fake.requeued, ['push-1']);
  });

  it('Dismiss calls nothing and is remembered across a reload, until the job fails anew', async () => {
    let saved: Record<string, number> = {};
    const memory = { load: () => saved, save: (d: Record<string, number>) => { saved = { ...d }; } };
    const first = setup(MON_1000, HOURS, memory);
    first.fake.jobs.set('push-1', first.fake.job('push-1', 'dead'));
    await first.watch.tick();
    await first.kernel.decide(first.items()[0].id, 'reject');
    await first.watch.tick();
    assert.deepEqual(first.fake.requeued, []);
    assert.deepEqual(saved, { 'push-1': 5 });
    const reload = setup(MON_1000, HOURS, memory);
    reload.fake.jobs.set('push-1', reload.fake.job('push-1', 'dead'));
    await reload.watch.tick();
    assert.equal(reload.items().length, 0, 'the dismissed failure is not filed again');
    reload.fake.jobs.set('push-1', reload.fake.job('push-1', 'dead', 6));
    await reload.watch.tick();
    assert.equal(reload.items().length, 1, 'a new failure is');
  });

  it('says why: a single-send job a crash cut off, and a job on its third failed attempt', async () => {
    const { fake, watch, items, clock } = setup(MON_1000);
    fake.jobs.set('push-1', fake.job('push-1', 'dead', 1));
    fake.events.push({ id: 'push-1#1:not-repeated', at: clock.t - 1000, event: 'not-repeated', kind: 'orders.push', jobId: 'push-1', attempt: 1 });
    fake.jobs.set('push-2', fake.job('push-2', 'failed', 3, 'timed out'));
    fake.events.push({ id: 'push-2#3:failed', at: clock.t - 500, event: 'failed', kind: 'orders.push', jobId: 'push-2', attempt: 3, message: 'timed out' });
    await watch.tick();
    const reasons = Object.fromEntries(items().map(m => [(m.proposal!.payload as any).jobId, (m.proposal!.payload as any).reason]));
    assert.deepEqual(reasons, { 'push-1': 'not-repeated', 'push-2': 'failing' });
  });

  it('files a runtime that stopped reporting once, and takes it back when it reports again', async () => {
    const { fake, watch, items, clock } = setup(MON_1000);
    fake.runtimes[0].at = clock.t - 200_000;
    await watch.tick(); await watch.tick();
    assert.equal(items('runtime.silent').length, 1);
    fake.runtimes[0].at = clock.t;
    await watch.tick();
    assert.equal(items('runtime.silent').length, 0);
  });

  it('files outside working hours without a notice, and gives it when the next working period begins', async () => {
    const { fake, watch, items, clock } = setup(SAT_1000);
    fake.jobs.set('push-1', fake.job('push-1', 'dead'));
    await watch.tick();
    assert.equal(items().length, 1, 'filed at once');
    assert.equal(items()[0].attention, false, 'but not noticed on a Saturday');
    clock.t = MON_0905;
    await watch.tick();
    assert.equal(items()[0].attention, true, 'noticed when Monday\'s hours begin');
    assert.equal(items()[0].read, false);
  });

  it('never notices when the working hours are unknown, and files all the same', async () => {
    const { fake, watch, items } = setup(MON_1000, null);
    fake.jobs.set('push-1', fake.job('push-1', 'dead'));
    await watch.tick();
    assert.equal(items().length, 1);
    assert.equal(items()[0].attention, false);
  });

  it('is quiet while there is no job host or the runtime is starting', async () => {
    const kernel = createKernel({});
    const refuse = (code: string) => async () => { throw Object.assign(new Error('no'), { code }); };
    for (const code of ['OS0190', 'OS0195']) {
      const q: any = new Proxy({}, { get: () => refuse(code) });
      const watch = watchJobs({ kernel: kernel as any, queue: q, setTimer: () => 0, clearTimer: () => {} });
      await watch.tick();
    }
    assert.equal(kernel.mail().length, 0);
  });
});
