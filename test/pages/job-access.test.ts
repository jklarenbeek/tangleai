/**
 * Background work on the Pages desktop: the job host address is a plain
 * preference (the web reader's address rule), the queue the kernel gets
 * follows it on every call without a reload, and Test tells a live host from
 * silence. The Settings section itself is driven in a browser
 * (.e2e/migration/os-jobs-access.spec.mjs).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { createKernel } from '@tangleai/os';
import { JOB_QUEUE_CONTRACT } from '@tangleai/os/jobs';
import { pagesJobQueue, testJobQueue, jobQueueAddress, JOB_QUEUE_EXAMPLE } from '../../apps/pages/src/os/job-access.ts';
import { createPreferences } from '../../apps/pages/src/os/preferences.ts';

const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, String(v)); }, removeItem: (k: string) => { map.delete(k); } }; };
const fakeWindow = () => ({ localStorage: storage(), sessionStorage: storage(), matchMedia: () => ({ matches: false }) }) as any;

let server: Server, dispatcher: any, base = '';
before(async () => {
  dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT as any), {
    'jobs.counts': async () => ({ pending: 2, leased: 0, done: 5, failed: 0, dead: 1, cancelled: 0, pendingKinds: { mail: 2 } }),
    'jobs.page': async () => ({ items: [] }),
    'jobs.get': async (_i: any, ctx: any) => ctx.fail('unknown', {}, { detail: 'no such job' }),
    'jobs.schedules': async () => ({ schedules: [] }),
    'jobs.cancel': async () => ({ changed: true }), 'jobs.requeue': async () => ({ changed: true }), 'jobs.unschedule': async () => ({ changed: true }),
  } as any, { validateOutput: 'always' });
  server = createServer(toNodeHandler(dispatcher));
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { server.close(); await dispatcher.close(); });

describe('the job host address', () => {
  it('follows the web reader\'s rule: http(s), no query, loopback allowed; empty is none', () => {
    assert.equal(jobQueueAddress(` ${JOB_QUEUE_EXAMPLE}/ `), JOB_QUEUE_EXAMPLE);
    assert.equal(jobQueueAddress(''), '');
    for (const bad of ['ftp://x.example', 'javascript:alert(1)', 'https://x.example/?a=1', 42]) assert.equal(jobQueueAddress(bad), null, String(bad));
  });

  it('is kept in the desktop preferences, and a stored value that is not an address reads as none', () => {
    const win = fakeWindow();
    assert.equal(createPreferences(win).desktop().jobQueue, '');
    createPreferences(win).writeDesktop({ jobQueue: JOB_QUEUE_EXAMPLE });
    assert.equal(createPreferences(win).desktop().jobQueue, JOB_QUEUE_EXAMPLE);
    win.localStorage.setItem('tangle-os', JSON.stringify({ jobQueue: 'javascript:alert(1)' }));
    assert.equal(createPreferences(win).desktop().jobQueue, '');
  });
});

describe('the queue the kernel gets', () => {
  it('answers OS0190 with no address, and follows a new address at once', async () => {
    let address = '';
    const kernel = createKernel({ assistantGrants: 'all', jobs: pagesJobQueue(() => address) });
    const counts = () => kernel.call('assistant', 'tangle_os_jobs', 'jobs.counts', {});
    assert.equal(((await counts()) as any).error.code, 'OS0190');
    address = base;
    assert.equal(((await counts()) as any).value.dead, 1);
    assert.equal(((await kernel.call('assistant', 'tangle_os_jobs', 'jobs.get', { id: 'x' })) as any).error.code, 'OS0191');
  });

  it('Test tells a job host from silence', async () => {
    assert.deepEqual(await testJobQueue(base), { ok: true });
    const silent = await testJobQueue('http://127.0.0.1:9', { timeoutMs: 2000 });
    assert.equal(silent.ok, false);
  });
});
