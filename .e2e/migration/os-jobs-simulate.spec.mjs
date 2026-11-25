/**
 * Jobs' "What will happen" on the built Pages desktop with the browser twin
 * (`?twin=1`): the registered schedules are simulated in a worker of their own
 * on a separate copy — a day of the every-minute reminders shows 1,440 runs a
 * day and the daily tidy one — every number plainly simulated, and the twin's
 * own store holds nothing the simulation did.
 */
import { test, expect } from './playwright.mjs';

test.describe.configure({ timeout: 180_000 });

test('a simulated day shows each registered job\'s runs, and the twin\'s own store is untouched', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/?twin=1');
  await page.waitForFunction(() => window.tangleOs?.twin?.on === true);
  const owner = await page.waitForFunction(() => window.tangleOs.twin.owns(), null, { timeout: 20_000 }).then(() => true, () => false);
  test.skip(!owner, 'the browser twin does not run here');
  await page.evaluate(() => window.tangleOs.desktop.open('jobs'));
  const win = page.locator('.tos-window[data-module="jobs"]');
  await expect(win.locator('.tos-jobs-schedules')).toContainText('Calendar reminders', { timeout: 30_000 });
  const panel = win.locator('.tos-jobs-sim');
  await expect(panel).toContainText('What will happen');
  await panel.locator('select').first().selectOption('1');
  await panel.getByRole('button', { name: 'Simulate' }).click();
  await expect(panel.locator('.tos-jobs-sim-table')).toBeVisible({ timeout: 120_000 });
  const reminders = panel.locator('tr[data-kind="calendar.reminders"]');
  await expect(reminders).toContainText('Calendar reminders');
  const counts = await reminders.locator('td .tos-jobs-sim-runs').allTextContents();
  const runs = counts.map(c => Number(c.replace(/\D/g, ''))).reduce((a, b) => a + b, 0);
  expect(runs).toBeGreaterThanOrEqual(1439);   // a day of the every-minute job, split over the dates it touches
  expect(runs).toBeLessThanOrEqual(1441);
  await expect(panel.locator('.tos-jobs-sim-note')).toContainText('nothing ran and nothing was sent');
  await expect(panel.locator('.tos-jobs-sim-total')).toContainText('over 1 days');
  // the twin's own store: no schedule, job or event of the simulation
  const leaked = await page.evaluate(async () => {
    const q = window.tangleOs.kernel.jobQueue();
    const [{ schedules }, { items }, { events }] = await Promise.all([q.schedules(), q.page({ limit: 200 }), q.events({ limit: 200 })]);
    return [...schedules.map(s => s.id), ...items.map(j => j.id), ...events.map(e => e.jobId ?? '')].filter(id => /simulation/.test(id));
  });
  expect(leaked).toEqual([]);
});
