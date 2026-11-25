/**
 * The desktop's Jobs reads a host's background work through the job_queue
 * contract: the counts per state with failures first, the schedules with
 * their rule in words and their next runs, the queue by state with paging
 * and a job's details, and the person's steering asked once in place —
 * requeue, cancel (a job another process runs is refused, OS0193), remove a
 * schedule. A desktop with no job host says so and offers Settings. Built on
 * the os-host fixture (`?jobs=1`, `?jobs=none`).
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let server, origin;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tangle-os-jobs-'));
  const bun = process.env.BUN ?? 'bun';
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/main.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'main.js')}`], { stdio: 'inherit' });
  execFileSync(bun, ['build', join(repo, 'components/os/styles/os.css'), '--minify', `--outfile=${join(out, 'os.css')}`], { stdio: 'inherit' });
  copyFileSync(join(repo, 'test/fixtures/os-host/index.html'), join(out, 'index.html'));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    let body;
    try { body = readFileSync(join(out, path)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

async function openJobs(page, query) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${origin}/?modules=1&${query}`);
  await page.waitForFunction(() => window.harness);
  await page.evaluate(() => window.harness.desktop.open('jobs'));
  return page.locator('.tos-window[data-module="jobs"]');
}
const calls = (page) => page.evaluate(() => window.harness.jobCalls);

test('Jobs counts the queue with failures first and says each schedule\'s rule and next runs', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  const states = win.getByRole('group', { name: 'Jobs by state' });
  const segments = states.getByRole('button');
  await expect(segments).toHaveCount(6);
  await expect(segments.nth(0)).toHaveText('Failed3');
  await expect(segments.nth(1)).toHaveText('Given up2');
  await expect(segments.nth(0)).toHaveAttribute('data-tone', 'danger');
  await expect(segments.nth(3)).toHaveText('Waiting60');
  await expect(segments.nth(3)).not.toHaveAttribute('data-tone', 'danger');

  const schedules = win.getByRole('list', { name: 'Schedules' });
  const stock = schedules.locator('[data-id="stock"]');
  const full = schedules.locator('[data-id="ops:fixture:stock.full"]');
  await expect(stock.locator('.tos-jobs-rule')).toHaveText('Every 15 minutes');
  await expect(full.locator('.tos-jobs-rule')).toHaveText('Every day at 3:00 AM, Europe/Amsterdam time');
  await expect(stock.locator('.tos-jobs-next li')).toHaveCount(3);
  await expect(full.locator('.tos-jobs-next li')).toHaveCount(3);
  await expect(full.locator('.tos-jobs-next time').first()).toHaveAttribute('datetime', /T0[12]:00:00\.000Z$/);
  // skipped is said only beside what passed while the host was stopped
  await expect(full.locator('.tos-jobs-facts')).toContainText('Skipped: 1; passed while stopped: 2');
  await expect(stock.locator('.tos-jobs-facts')).not.toContainText('Skipped');
  await expect(stock.locator('.tos-jobs-facts')).toContainText('Runs so far: 412');
  await expect(stock.locator('.tos-jobs-badge')).toHaveText('Active');
});

test('the queue opens on the failures, pages the waiting jobs and shows a job\'s details, never its payload', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  await win.locator('.tos-titlebar').getByRole('tab', { name: 'Queue' }).click();
  const list = win.getByRole('list', { name: 'Jobs' });
  await expect(list.locator('.tos-jobs-item')).toHaveCount(3);
  await expect(list.locator('.tos-jobs-item').first()).toContainText('the warehouse answered 503');
  await expect(list.locator('.tos-jobs-item').first()).not.toContainText('retry later');

  await win.getByRole('group', { name: 'Jobs by state' }).getByRole('button', { name: /^Waiting/ }).click();
  await expect(list.locator('.tos-jobs-item')).toHaveCount(50);
  await win.getByRole('button', { name: 'Show more' }).click();
  await expect(list.locator('.tos-jobs-item')).toHaveCount(60);
  await expect(win.getByRole('button', { name: 'Show more' })).toHaveCount(0);

  await win.getByRole('group', { name: 'Jobs by state' }).getByRole('button', { name: /^Failed/ }).click();
  await list.locator('[data-id="push-0001"]').click();
  const detail = win.getByRole('region', { name: 'Job details' });
  await expect(detail).toContainText('orders.push');
  await expect(detail).toContainText('2 / 5');
  await expect(detail.locator('.tos-jobs-error-text')).toHaveText('the warehouse answered 503\nretry later');
  await expect(detail.locator('.tos-jobs-error-text')).toHaveAttribute('data-code', 'HTTP503');
  await expect(win).not.toContainText('payload');
});

test('the person runs a given-up job again and cancels a waiting one, each asked once in place', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  await win.locator('.tos-titlebar').getByRole('tab', { name: 'Queue' }).click();
  const states = win.getByRole('group', { name: 'Jobs by state' });
  await states.getByRole('button', { name: /^Given up/ }).click();
  const list = win.getByRole('list', { name: 'Jobs' });
  await list.locator('[data-id="mail-0001"]').click();
  await win.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'Run again' }).click();
  const ask = win.getByRole('group', { name: 'Put the job mail-0001 back in the queue? Its attempts so far are kept.' });
  // Keep takes it back without a call
  await ask.getByRole('button', { name: 'Keep' }).click();
  expect((await calls(page)).some(c => c.requeue)).toBe(false);
  await list.locator('[data-id="mail-0001"]').click();
  await list.locator('[data-id="mail-0001"]').click();
  await win.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'Run again' }).click();
  await win.getByRole('group', { name: /^Put the job mail-0001/ }).getByRole('button', { name: 'Run again' }).click();
  await expect(win.locator('.tos-jobs-status')).toHaveText('The job mail-0001 is back in the queue.');
  await expect(states.getByRole('button', { name: /^Given up/ })).toHaveText('Given up1');
  expect(await calls(page)).toContainEqual({ requeue: 'mail-0001' });

  await states.getByRole('button', { name: /^Waiting/ }).click();
  await list.locator('[data-id="wait-000"]').click();
  await win.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'Cancel job' }).click();
  await win.getByRole('group', { name: 'Cancel the job wait-000?' }).getByRole('button', { name: 'Cancel job' }).click();
  await expect(win.locator('.tos-jobs-status')).toHaveText('The job wait-000 is cancelled.');
  await expect(states.getByRole('button', { name: /^Cancelled/ })).toHaveText('Cancelled3');
});

test('a job another process runs is refused with OS0193; one this host runs is cancelled', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  await win.locator('.tos-titlebar').getByRole('tab', { name: 'Queue' }).click();
  await win.getByRole('group', { name: 'Jobs by state' }).getByRole('button', { name: /^Running/ }).click();
  const list = win.getByRole('list', { name: 'Jobs' });
  await list.locator('[data-id="sync-held-other"]').click();
  await win.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'Cancel job' }).click();
  await win.getByRole('group', { name: 'Cancel the job sync-held-other?' }).getByRole('button', { name: 'Cancel job' }).click();
  const status = win.locator('.tos-jobs-status');
  await expect(status).toHaveText('Another process is running this job, so it cannot be cancelled from here.');
  await expect(status).toHaveAttribute('data-code', 'OS0193');
  await list.locator('[data-id="sync-held-here"]').click();
  await win.getByRole('region', { name: 'Job details' }).getByRole('button', { name: 'Cancel job' }).click();
  await win.getByRole('group', { name: 'Cancel the job sync-held-here?' }).getByRole('button', { name: 'Cancel job' }).click();
  await expect(status).toHaveText('The job sync-held-here is cancelled.');
});

test('the person removes a schedule; the jobs it ran stay', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  const schedules = win.getByRole('list', { name: 'Schedules' });
  await schedules.locator('[data-id="stock"]').getByRole('button', { name: 'Remove' }).click();
  await win.getByRole('group', { name: 'Remove the schedule stock.sync? The jobs it ran stay.' }).getByRole('button', { name: 'Remove' }).click();
  await expect(win.locator('.tos-jobs-status')).toHaveText('The schedule stock.sync is removed.');
  await expect(schedules.locator('.tos-jobs-schedule')).toHaveCount(2);
  expect(await calls(page)).toContainEqual({ unschedule: 'stock' });
});

test('without a job host, Jobs says so and offers Settings', async ({ page }) => {
  const win = await openJobs(page, 'jobs=none');
  const status = win.locator('.tos-jobs-status');
  await expect(status).toHaveText('No job host is configured on this desktop.');
  await expect(status).toHaveAttribute('data-code', 'OS0190');
  await expect(win.getByRole('button', { name: 'Open Settings' })).toBeVisible();
  await expect(win.locator('.tos-titlebar').getByRole('button', { name: 'Refresh' })).toBeDisabled();
});

test('a registered job shows its title and runs now; one that must never run twice is asked once, and a waiting one is refused', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  const schedules = win.getByRole('list', { name: 'Schedules' });
  const full = schedules.locator('[data-id="ops:fixture:stock.full"]');
  const push = schedules.locator('[data-id="ops:fixture:orders.push"]');
  await expect(full.locator('.tos-jobs-kind')).toHaveText('Read all stock');
  await expect(push.locator('.tos-jobs-kind')).toHaveText('Send the orders');
  // the host's registry owns these schedules: Run now, no Remove; a schedule of its own keeps Remove
  await expect(full.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(schedules.locator('[data-id="stock"]').getByRole('button', { name: 'Run now' })).toHaveCount(0);

  await full.getByRole('button', { name: 'Run now' }).click();
  await expect(win.locator('.tos-jobs-status')).toHaveText('Read all stock will run now.');
  expect(await calls(page)).toContainEqual({ run: 'stock.full' });

  await push.getByRole('button', { name: 'Run now' }).click();
  const ask = win.getByRole('group', { name: 'This sends once; it is not repeated. Run Send the orders now?' });
  await expect(ask).toBeVisible();
  expect(await calls(page)).not.toContainEqual({ run: 'orders.push' });
  await ask.getByRole('button', { name: 'Run now' }).click();
  await expect(win.locator('.tos-jobs-status')).toHaveText('A run of Send the orders is already waiting or under way.');
  await expect(win.locator('.tos-jobs-status')).toHaveAttribute('data-code', 'OS0192');
});

test('a job\'s detail shows its attempts, says plainly a lost one is not repeated, and shows no payload', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  await win.locator('.tos-titlebar').getByRole('tab', { name: 'Queue' }).click();
  const list = win.getByRole('list', { name: 'Jobs' });
  await list.locator('[data-id="push-0001"]').click();
  const detail = win.getByRole('region', { name: 'Job details' });
  const tries = detail.locator('.tos-jobs-attempt');
  await expect(tries).toHaveCount(2);
  await expect(tries.nth(0)).toContainText('Attempt 1');
  await expect(tries.nth(0).locator('.tos-jobs-outcome')).toHaveText('Failed');
  await expect(tries.nth(0)).toContainText('took 1 second');
  await expect(tries.nth(0).locator('.tos-jobs-attempt-error')).toHaveText('the warehouse answered 503');
  await expect(tries.nth(0).locator('.tos-jobs-attempt-error')).toHaveAttribute('data-code', 'HTTP503');
  await expect(tries.nth(1)).toContainText('took 480 milliseconds');

  await win.getByRole('group', { name: 'Jobs by state' }).getByRole('button', { name: /^Given up/ }).click();
  await list.locator('[data-id="mail-0002"]').click();
  const lost = win.getByRole('region', { name: 'Job details' }).locator('.tos-jobs-attempt');
  await expect(lost.locator('.tos-jobs-outcome')).toHaveText('Lost: the process running it stopped');
  await expect(lost).toContainText('Attempt 5');
  await expect(lost.locator('.tos-jobs-attempt-error')).toHaveCount(0);
  await expect(lost.locator('[data-event="not-repeated"]')).toHaveText('Not repeated: it may already have been sent; run it again only if it did not arrive.');
  await expect(win).not.toContainText('payload');
});

test('the runtime\'s heartbeat is a quiet line, and a warning when it has been silent', async ({ page }) => {
  let win = await openJobs(page, 'jobs=1');
  await expect(win.locator('.tos-jobs-pulse')).toHaveText(/^Background runtime seen \d+ seconds ago$/);
  await expect(win.locator('.tos-jobs-pulse')).not.toHaveAttribute('data-tone', 'danger');
  win = await openJobs(page, 'jobs=1&stale=1');
  await expect(win.locator('.tos-jobs-pulse')).toHaveText('The background runtime has not reported for 5 minutes.');
  await expect(win.locator('.tos-jobs-pulse')).toHaveAttribute('data-tone', 'danger');
});


test('the schedules\' own enqueue jobs stay out of the list and are said once in a quiet line', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1');
  await expect(win.locator('.tos-jobs-ticks')).toHaveText('42 schedule ticks so far, kept out of the list');
  await win.getByRole('group', { name: 'Jobs by state' }).getByRole('button', { name: /^Done/ }).click();
  const list = win.locator('.tos-jobs-list');
  await expect(list.locator('.tos-jobs-item')).toHaveCount(6);
  await expect(list).not.toContainText('ops.fire');
});

test('a background runtime in this browser says where it keeps its store and that this tab runs it', async ({ page }) => {
  const win = await openJobs(page, 'jobs=1&twin=1');
  await expect(win.locator('.tos-jobs-pulse')).toHaveText(/^Background runtime seen \d+ seconds ago · kept in this browser · runs in this tab$/);
});

test('a runtime that is starting is said as such, without sending the person to Settings', async ({ page }) => {
  const win = await openJobs(page, 'jobs=starting');
  await expect(win.locator('.tos-jobs-status')).toHaveText('Background work is starting…');
  await expect(win.locator('.tos-jobs-status')).toHaveAttribute('data-code', 'OS0195');
  await expect(win.getByRole('button', { name: 'Open Settings' })).toHaveCount(0);
});

test('a runtime that could not start in this browser says why, and still offers a host in Settings', async ({ page }) => {
  const win = await openJobs(page, 'jobs=twinfail');
  await expect(win.locator('.tos-jobs-status')).toHaveText('Background work could not start in this browser: the worker script could not load');
  await expect(win.locator('.tos-jobs-configure')).toHaveCount(1);
});
