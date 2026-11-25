/**
 * The browser twin on the built Pages desktop: with no Background work address,
 * the desktop's background work runs in a worker of this tab (`?twin=1` — the
 * twin is off under automation otherwise). Jobs shows the twin's schedules by
 * their titles and a heartbeat that says where the store is kept and that this
 * tab runs it; a calendar event starting within 15 minutes gets one reminder in
 * the inbox, and only one over two minutes of runs; Forget everything deletes
 * the twin's store.
 *
 * Until `@tangleai/ops/browser` is merged into the desktop the twin cannot start
 * and these tests skip themselves.
 */
import { test, expect } from './playwright.mjs';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

async function bootTwin(page) {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/?twin=1');
  await page.waitForFunction(() => window.tangleOs?.twin?.on === true);
  const owner = await page.waitForFunction(() => window.tangleOs.twin.owns(), null, { timeout: 20_000 }).then(() => true, () => false);
  test.skip(!owner, 'the browser twin (@tangleai/ops/browser) does not run in this build yet');
}

test('Jobs shows the twin\'s schedules by title, and a heartbeat that says the store is kept here and this tab runs it', async ({ page }) => {
  await bootTwin(page);
  await page.evaluate(() => window.tangleOs.desktop.open('jobs'));
  const win = page.locator('.tos-window[data-module="jobs"]');
  const schedules = win.locator('.tos-jobs-schedules');
  await expect(schedules).toContainText('Calendar reminders', { timeout: 30_000 });
  await expect(schedules).toContainText('Inbox tidy count');
  await expect(win.locator('.tos-jobs-pulse')).toContainText(/kept in this browser|not kept/, { timeout: 45_000 });
  await expect(win.locator('.tos-jobs-pulse')).toContainText('runs in this tab');
});

test('an event starting within 15 minutes gets one reminder in the inbox, and only one over two minutes', async ({ page }) => {
  await bootTwin(page);
  await page.evaluate(() => {
    const at = new Date(Date.now() + 5 * 60_000);
    const two = (n) => String(n).padStart(2, '0');
    const date = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`, start = `${two(at.getHours())}:${two(at.getMinutes())}`;
    localStorage.setItem('tangle-calendar', JSON.stringify({ $calendar: '0.1', hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }, seeded: true,
      events: [{ uid: 'twin-spec', title: 'Twin spec review', date, start, end: '23:59', allDay: false, repeat: 'none', colour: 'teal', exdates: [] }] }));
  });
  const reminders = () => page.evaluate(() => window.tangleOs.kernel.mail().filter(m => m.from === 'calendar' && /Twin spec review/.test(m.subject)).length);
  await expect.poll(reminders, { timeout: 90_000, intervals: [2_000] }).toBe(1);
  await page.waitForTimeout(125_000);   // two more runs of the minutely job
  expect(await reminders()).toBe(1);
});

test('Forget everything deletes the background work kept in this browser', async ({ page }) => {
  await bootTwin(page);
  await page.evaluate(() => { window.tangleOs.desktop.openSettings(); return window.tangleOs.kernel.call('shell', 'tangle_os_settings', 'settings.show', { section: 'privacy' }); });
  const settings = page.locator('.tos-window[data-module="settings"]');
  await expect(settings).toContainText('Forget everything deletes it too.');
  const forget = settings.getByRole('button', { name: 'Forget everything' });
  await forget.click();
  await settings.getByRole('button', { name: 'Click again to forget everything' }).click();
  await expect(settings.locator('[role="status"]')).toContainText('The background work kept in this browser is deleted too.', { timeout: 20_000 });
});
