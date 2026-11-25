/**
 * The background work in the Calendar, on the built Pages desktop with the
 * browser twin (`?twin=1`): the twin's upcoming runs are a quiet line under the
 * person's own events — the minutely reminders as one count a day, the daily
 * tidy by its title — the menu hides and shows them, and "Export upcoming runs"
 * writes an iCalendar file of titles and times only. Without a job host the
 * Calendar draws no runs and offers no run export.
 */
import { test, expect } from './playwright.mjs';
import { readFile } from 'node:fs/promises';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const EMPTY = JSON.stringify({ $calendar: '0.1', events: [], hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }, seeded: true });

async function calendar(page, query) {
  await page.addInitScript((cal) => { localStorage.setItem('tangle-os-welcomed', '1'); localStorage.setItem('tangle-calendar', cal); }, EMPTY);
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.tangleOs?.kernel);
  if (query.includes('twin=1')) {
    await page.waitForFunction(() => window.tangleOs?.twin?.on === true);
    const owner = await page.waitForFunction(() => window.tangleOs.twin.owns(), null, { timeout: 20_000 }).then(() => true, () => false);
    test.skip(!owner, 'the browser twin does not run in this build');
    // wait until the twin answers its schedules before the Calendar reads them
    await page.waitForFunction(async () => { try { return (await window.tangleOs.kernel.jobQueue().schedules()).schedules.length >= 2; } catch { return false; } }, null, { timeout: 45_000, polling: 1000 });
  }
  await page.evaluate(() => window.tangleOs.desktop.open('calendar'));
  return page.locator('.tos-window[data-module="calendar"]');
}

test('the twin\'s upcoming runs are a quiet line in the month and a list for the day, and the menu hides and shows them', async ({ page }) => {
  const cal = await calendar(page, '?twin=1');
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); const two = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; });
  const cell = cal.locator(`.cal-day[data-date="${tomorrow}"]`);
  await expect(cell.locator('.cal-runs')).toHaveAttribute('aria-label', '2 in the background', { timeout: 30_000 });
  await expect(cell.locator('.cal-runs')).toHaveText('↻ 2');
  await cell.click();
  const day = cal.locator('.cal-runs-day');
  await expect(day).toContainText('Background work');
  await expect(day).toContainText(/Calendar reminders: 1,(380|440|500) runs/);
  await expect(day).toContainText('Inbox tidy count');
  await expect(day).toContainText('never count as busy time');
  // the person's own events stay the month's focus: no run is a chip
  expect(await cal.locator('.cal-chip').count()).toBe(0);
  await cal.getByRole('button', { name: 'Calendar menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show background work' }).click();
  await expect(cal.locator('.cal-runs')).toHaveCount(0);
  await expect(cal.locator('.cal-runs-day')).toHaveCount(0);
  await cal.getByRole('button', { name: 'Calendar menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show background work' }).click();
  await expect(cell.locator('.cal-runs')).toHaveAttribute('aria-label', '2 in the background');
});

test('Export upcoming runs writes titles, UTC starts and run identities only', async ({ page }) => {
  const cal = await calendar(page, '?twin=1');
  const downloading = page.waitForEvent('download');
  await cal.getByRole('button', { name: 'Calendar menu' }).click();
  await page.getByRole('menuitem', { name: 'Export upcoming runs (.ics)' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('tangle-background-work.ics');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('SUMMARY:Inbox tidy count');
  expect(text).toMatch(/SUMMARY:Calendar reminders: 1\\?,\d{3} runs/);
  expect(text).toMatch(/UID:ops:pages:desktop\.tidy@\d{4}-\d{2}-\d{2}T03:00:00/);
  expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  for (const forbidden of ['DESCRIPTION', 'LOCATION', 'ops.fire', 'payload']) expect(text).not.toContain(forbidden);
  const events = text.split('BEGIN:VEVENT').length - 1;
  expect(events).toBeGreaterThanOrEqual(58);   // 30 days: a count a day and a tidy run a day
  expect(events).toBeLessThanOrEqual(62);
});

test('without a job host the Calendar draws no runs and offers no run export', async ({ page }) => {
  const cal = await calendar(page, '?twin=0');
  await page.waitForTimeout(1500);
  await expect(cal.locator('.cal-runs')).toHaveCount(0);
  await cal.getByRole('button', { name: 'Calendar menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export .ics' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Export upcoming runs (.ics)' })).toHaveCount(0);
});
