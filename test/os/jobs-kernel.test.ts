/**
 * The assistant's way into background work: tangle_os_jobs reads the host's
 * queue and schedules under grants, every call in the ledger, and changes
 * nothing itself — jobs.suggest files a desktop proposal the person decides,
 * carried out once on accept, only if the job has not moved since.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, JOBS_CONTRACT } from '@tangleai/os';
import { JOB_CODES, type JobQueue, type JobItem, type JobState } from '@tangleai/os/jobs';

function fakeQueue() {
  const calls: string[] = [];
  const jobs = new Map<string, JobItem>();
  const item = (id: string, state: JobState): JobItem => ({ id, kind: 'push', state, runAt: 1, attempts: 1, maxAttempts: 5, leaseUntil: null, lastError: state === 'dead' ? { message: 'refused by the courier' } : null, createdAt: 1, updatedAt: 1 });
  jobs.set('dead-1', item('dead-1', 'dead'));
  jobs.set('wait-1', item('wait-1', 'pending'));
  let scheduleUpdated = 100;
  const schedules = () => [{ id: 'daily', kind: 'stock', series: { kind: 'recurrence', rrule: { FREQ: 'DAILY' } }, zone: 'Europe/Amsterdam', policy: 'rfc5545', missed: 'skip' as const, latenessMs: null, state: 'active' as const, nextRunAt: 2, nextRecurrenceId: 'x', lastRunAt: null, lastRecurrenceId: null, counts: { fired: 0, skipped: 0 }, stall: null, createdAt: 1, updatedAt: scheduleUpdated }];
  const known = (id: string) => { const j = jobs.get(id); if (!j) throw Object.assign(new Error(`no job ${id}`), { code: JOB_CODES.unknown }); return j; };
  const queue: JobQueue = {
    async counts() { calls.push('counts'); return { pending: 1, leased: 0, done: 0, failed: 0, dead: 1, cancelled: 0, pendingKinds: { push: 1 } }; },
    async page() { calls.push('page'); return { items: [...jobs.values()] }; },
    async get({ id }) { calls.push(`get ${id}`); return known(id); },
    async schedules() { calls.push('schedules'); return { schedules: schedules() }; },
    async cancel({ id }) { calls.push(`cancel ${id}`); jobs.set(id, { ...known(id), state: 'cancelled' }); return { changed: true }; },
    async requeue({ id }) { calls.push(`requeue ${id}`); jobs.set(id, { ...known(id), state: 'pending' }); return { changed: true }; },
    async unschedule({ id }) { calls.push(`unschedule ${id}`); return { changed: true }; },
  };
  return { queue, calls, jobs, touchSchedule: () => { scheduleUpdated++; } };
}
const failed = (outcome: any) => outcome.ok ? 'ok' : outcome.error.code;
const proposals = (kernel: ReturnType<typeof createKernel>) => kernel.mail().filter(m => m.from === 'desktop' && m.proposal?.kind === 'job.change');

describe('tangle_os_jobs', () => {
  it('reads the host\'s queue and schedules under grants, each call in the ledger', async () => {
    const { queue } = fakeQueue();
    const none = createKernel({ jobs: queue });
    assert.equal(failed(await none.call('assistant', 'tangle_os_jobs', 'jobs.counts', {})), 'OS0101');
    const kernel = createKernel({ jobs: queue, assistantGrants: 'all' });
    const counts: any = await kernel.call('assistant', 'tangle_os_jobs', 'jobs.counts', {});
    assert.equal(counts.value.source, 'job host');
    assert.equal(counts.value.dead, 1);
    const job: any = await kernel.call('assistant', 'tangle_os_jobs', 'jobs.get', { id: 'dead-1' });
    assert.match(job.value.job.lastError.message, /courier/);
    assert.equal(failed(await kernel.call('assistant', 'tangle_os_jobs', 'jobs.get', { id: 'nope' })), JOB_CODES.unknown);
    assert.equal(((await kernel.call('assistant', 'tangle_os_jobs', 'jobs.schedules', {})) as any).value.schedules[0].id, 'daily');
    assert.deepEqual(kernel.ledger().filter(e => e.contract === 'tangle_os_jobs').map(e => `${e.op}${e.ok ? '' : ` ${e.code}`}`), ['jobs.counts', 'jobs.get', 'jobs.get OS0191', 'jobs.schedules']);
    assert.deepEqual(kernel.operations().filter(o => o.contract === JOBS_CONTRACT.id).map(o => o.op), ['jobs.counts', 'jobs.page', 'jobs.get', 'jobs.schedules', 'jobs.suggest']);
  });

  it('answers OS0190 everywhere without a job host, and gives the person\'s app the queue itself', async () => {
    const kernel = createKernel({ assistantGrants: 'all' });
    assert.equal(failed(await kernel.call('assistant', 'tangle_os_jobs', 'jobs.counts', {})), JOB_CODES.unconfigured);
    await assert.rejects(kernel.jobQueue().counts(), { code: JOB_CODES.unconfigured });
    const { queue } = fakeQueue();
    assert.equal(createKernel({ jobs: queue }).jobQueue(), queue);
  });

  it('only proposes: the change waits in the inbox and happens once when the person accepts', async () => {
    const { queue, calls } = fakeQueue();
    const kernel = createKernel({ jobs: queue, assistantGrants: 'all' });
    const filed: any = await kernel.call('assistant', 'tangle_os_jobs', 'jobs.suggest', { action: 'requeue', id: 'dead-1', reason: 'the courier is back' });
    assert.equal(filed.ok, true);
    assert.equal(calls.includes('requeue dead-1'), false, 'nothing happened yet');
    // a second proposal of the same change replaces the first
    await kernel.call('assistant', 'tangle_os_jobs', 'jobs.suggest', { action: 'requeue', id: 'dead-1', reason: 'the courier is back, really' });
    const [mail] = proposals(kernel);
    assert.equal(proposals(kernel).length, 1);
    assert.deepEqual({ ...(mail.proposal!.payload as any) }, { action: 'requeue', id: 'dead-1', reason: 'the courier is back, really', by: 'assistant', seen: 'dead' });
    const decided: any = await kernel.decide(mail.id, 'accept');
    assert.equal(decided.ok, true);
    assert.equal(calls.filter(c => c === 'requeue dead-1').length, 1);
    assert.equal(proposals(kernel)[0].proposal!.status, 'accepted');
  });

  it('leaves a stale proposal pending (OS0112), and a rejected one calls nothing', async () => {
    const { queue, calls, jobs, touchSchedule } = fakeQueue();
    const kernel = createKernel({ jobs: queue, assistantGrants: 'all' });
    await kernel.call('assistant', 'tangle_os_jobs', 'jobs.suggest', { action: 'cancel', id: 'wait-1', reason: 'not needed' });
    jobs.set('wait-1', { ...jobs.get('wait-1')!, state: 'leased' });
    const stale: any = await kernel.decide(proposals(kernel)[0].id, 'accept');
    assert.equal(failed(stale), 'OS0112');
    assert.equal(proposals(kernel)[0].proposal!.status, 'pending');
    assert.equal(calls.includes('cancel wait-1'), false);

    await kernel.call('assistant', 'tangle_os_jobs', 'jobs.suggest', { action: 'unschedule', id: 'daily', reason: 'replaced' });
    const schedule = proposals(kernel).find(m => (m.proposal!.payload as any).action === 'unschedule')!;
    touchSchedule();
    assert.equal(failed(await kernel.decide(schedule.id, 'accept')), 'OS0112');
    const rejected: any = await kernel.decide(schedule.id, 'reject');
    assert.equal(rejected.ok, true);
    assert.equal(calls.includes('unschedule daily'), false);
    assert.equal(failed(await kernel.call('assistant', 'tangle_os_jobs', 'jobs.suggest', { action: 'unschedule', id: 'nope', reason: 'x' })), JOB_CODES.unknown);
  });
});
