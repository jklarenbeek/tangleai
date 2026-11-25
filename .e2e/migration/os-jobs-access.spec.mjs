/**
 * Background work on the Pages desktop, in a real browser: Settings names a
 * job host on another origin (as the desktop app on this machine would be),
 * refuses an address that is not one, tests it across origins, and the
 * kernel's tangle_os_jobs reads the host's queue through it; removing it
 * brings back "no job host" (OS0190).
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { JOB_QUEUE_CONTRACT } from '../../components/os/src/jobs.ts';

let server, base = '';
test.beforeAll(async () => {
  const dispatcher = serveHttp(compileContract(JOB_QUEUE_CONTRACT), {
    'jobs.counts': async () => ({ pending: 3, leased: 1, done: 40, failed: 0, dead: 2, cancelled: 0, pendingKinds: { mail: 3 } }),
    'jobs.page': async () => ({ items: [] }),
    'jobs.get': async (_input, ctx) => ctx.fail('unknown', {}, { detail: 'no such job' }),
    'jobs.schedules': async () => ({ schedules: [] }),
    'jobs.cancel': async () => ({ changed: true }), 'jobs.requeue': async () => ({ changed: true }), 'jobs.unschedule': async () => ({ changed: true }),
    'jobs.events': async () => ({ events: [] }), 'jobs.health': async () => ({ now: Date.now(), runtimes: [] }), 'jobs.registry': async () => ({ jobs: [] }), 'jobs.run': async () => ({ id: 'run:test:none@now' }),
  }, { validateOutput: 'always' });
  const handle = toNodeHandler(dispatcher);
  // the host admits the desktop's origin, as the desktop app's route does
  server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', request.headers.origin ?? '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-private-network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    handle(request, response);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

test('Settings names a job host on another origin, tests it, and the kernel reads the queue through it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs?.kernel);
  const counts = () => page.evaluate(() => window.tangleOs.kernel.call('assistant', 'tangle_os_jobs', 'jobs.counts', {}));
  expect((await counts()).error.code).toBe('OS0190');

  await page.evaluate(() => window.tangleOs.desktop.openSettings());
  await page.locator('.tos-settings-nav [data-section="jobs"]').click();
  const field = page.locator('#tos-job-queue');
  const status = page.locator('.tos-settings-status[role="status"]');
  await expect(status).toContainText('No job host is set');
  await field.fill('ftp://nowhere.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status).toContainText('Enter an http or https address');
  await field.fill(base);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status).toHaveText('The job host address is saved.');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(status).toHaveText('The job host answers.');

  const read = await counts();
  expect(read.ok).toBe(true);
  expect(read.value).toMatchObject({ source: 'job host', dead: 2, pending: 3 });

  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(status).toContainText('The job host address is removed.');
  expect((await counts()).error.code).toBe('OS0190');
});
