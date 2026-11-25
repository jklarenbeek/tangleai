/**
 * The Pages desktop's side of the browser twin: when it runs (not under
 * automation unless asked), which queue the desktop reads (a host's address,
 * else the twin, else none), a twin that could not start said as such, and
 * the page's tasks — one reminder per calendar occurrence, never two, and a
 * tidy count that deletes nothing. The worker itself is driven in a browser
 * (`.e2e/migration/os-twin.spec.mjs`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKernel } from '@tangleai/os';
import { unconfiguredJobQueue } from '@tangleai/os/jobs';
import { checkRegistry } from '@tangleai/ops';
import { twinWanted, pagesJobQueue, failedTwinQueue } from '../../apps/pages/src/os/job-access.ts';
import { desktopTasks, upcoming } from '../../apps/pages/src/os/ops-tasks.ts';
import { localRegistry, TWIN } from '../../apps/pages/src/os/ops-twin.ts';
import { emptyCalendar } from '../../apps/pages/src/os/calendar-model.ts';

const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, String(v)); }, removeItem: (k: string) => { map.delete(k); }, map } as any; };
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e: any) { return e.code; } };
const local = (y: number, mo: number, d: number, h: number, m: number) => new Date(y, mo - 1, d, h, m);
const event = (uid: string, date: string, start: string, extra: Record<string, unknown> = {}) => ({ uid, title: `Meeting ${uid}`, date, start, end: '23:59', allDay: false, repeat: 'none', colour: 'teal', exdates: [], ...extra });

describe('when the browser twin runs', () => {
  it('runs for a person, not under automation unless a spec asks, and never with ?twin=0', () => {
    assert.equal(twinWanted('', false), true);
    assert.equal(twinWanted('', true), false);
    assert.equal(twinWanted('?twin=1', true), true);
    assert.equal(twinWanted('?twin=0', false), false);
  });

  it('reads a host at the address the person set, else the twin, else none', async () => {
    let address = '';
    const twin = { ...unconfiguredJobQueue(), counts: async () => ({ pending: 7 }) } as any;
    const withTwin = pagesJobQueue(() => address, { twin: () => twin });
    assert.equal((await withTwin.counts() as any).pending, 7);
    assert.equal(await code(pagesJobQueue(() => '').counts()), 'OS0190');
    address = 'http://127.0.0.1:9/api/job-queue';
    assert.equal(await code(withTwin.counts()), 'OS0190', 'an address is the host, not the twin (nothing answers there)');
  });

  it('says that a twin could not start, and why, on every call', async () => {
    const failed = failedTwinQueue('the worker script could not load');
    await assert.rejects(failed.schedules(), (e: any) => e.code === 'OS0190' && e.twin === true && /could not load/.test(e.message));
  });

  it('keeps its showcase registry runnable, in the browser\'s own zone', () => {
    const doc = JSON.parse(readFileSync(new URL('../../apps/pages/src/os/ops-registry.json', import.meta.url), 'utf8'));
    assert.equal(checkRegistry(doc).ok, true);
    assert.deepEqual(doc.jobs.map((j: any) => j.kind), ['calendar.reminders', 'desktop.tidy']);
    for (const job of doc.jobs) assert.equal(Object.keys(job.title).length, 12, `${job.kind} has a title in every language`);
    assert.equal(localRegistry(doc, 'Europe/Amsterdam').zone, 'Europe/Amsterdam');
    assert.notEqual(TWIN.lock as string, TWIN.channel as string);
  });
});

describe('the page\'s tasks', () => {
  it('finds the occurrences that start within 15 minutes, not all-day ones and not ones that began', () => {
    const doc = { ...emptyCalendar(), events: [event('a', '2027-03-01', '10:10'), event('b', '2027-03-01', '10:20'), event('c', '2027-03-01', '09:55'), event('d', '2027-03-01', '10:05', { allDay: true })] } as any;
    const soon = upcoming(doc, local(2027, 3, 1, 10, 0));
    assert.deepEqual(soon.map(e => e.title), ['Meeting a']);
    assert.match(soon[0].key, /^a@/);
  });

  it('files one inbox message per occurrence, never two, even when another tab runs the next minute', async () => {
    const store = storage();
    store.setItem('tangle-calendar', JSON.stringify({ ...emptyCalendar(), events: [event('a', '2027-03-01', '10:10'), event('b', '2027-03-01', '10:12')] }));
    let clock = local(2027, 3, 1, 10, 0).getTime();
    const first = createKernel({});
    const tasks = desktopTasks({ kernel: first, storage: store, now: () => clock });
    assert.deepEqual(await tasks['reminders.notify']({}), { sent: 2, upcoming: 2 });
    clock += 60_000;
    assert.deepEqual(await tasks['reminders.notify']({}), { sent: 0, upcoming: 2 });
    const other = createKernel({});   // a takeover: another tab, the same browser storage
    assert.deepEqual(await desktopTasks({ kernel: other, storage: store, now: () => clock })['reminders.notify']({}), { sent: 0, upcoming: 2 });
    assert.equal(first.mail().filter(m => m.from === 'calendar').length, 2);
    assert.equal(other.mail().length, 0);
  });

  it('counts the read messages older than 30 days and deletes nothing', async () => {
    const kernel = createKernel({});
    kernel.sendMail('calendar', { subject: 'old' });
    const [mine] = kernel.mail(); kernel.markRead(mine.id);
    const tasks = desktopTasks({ kernel, storage: storage(), now: () => Date.now() + 31 * 86_400_000 });
    assert.deepEqual(await tasks['tidy.count']({}), { old: 1 });
    assert.equal(kernel.mail().length, 1);
  });
});
