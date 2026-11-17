/**
 * The desktop Calendar in a real browser: an event made in the editor shows in
 * the month and the day, a repeating one fills the weeks, one day of it can be
 * skipped, a monthly series says which months it skips, "find a time" offers
 * free hours, the assistant books through the
 * `calendar` contract, and the calendar downloads as iCalendar.
 */
import { test, expect } from './playwright.mjs';
import { readFile } from 'node:fs/promises';

async function calendar(page) {
  await page.addInitScript(() => { localStorage.setItem('tangle-os-welcomed', '1'); localStorage.setItem('tangle-calendar', JSON.stringify({ $calendar: '0.1', events: [], hours: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }, seeded: true })); });
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs);
  await page.evaluate(() => window.tangleOs.desktop.open('calendar'));
  return page.locator('.tos-window[data-module="calendar"]');
}

test('an event made in the editor repeats, skips a day, and is booked and read through the contract', async ({ page }) => {
  const cal = await calendar(page);
  const day = await cal.locator('.cal-day:not(.is-outside)').nth(9).getAttribute('data-date');
  await cal.locator(`[data-date="${day}"]`).click();
  await cal.getByRole('button', { name: 'New event' }).click();
  await cal.getByLabel('Title').fill('Team sync');
  await cal.getByLabel('Starts').fill('10:00');
  await cal.getByLabel('Ends').fill('10:30');
  await cal.getByLabel('Repeat').selectOption('weekly');
  await cal.locator('.cal-editor').getByRole('button', { name: 'Save' }).click();
  await expect(cal.locator(`[data-date="${day}"] .cal-chip`, { hasText: 'Team sync' })).toBeVisible();
  expect(await cal.locator('.cal-chip', { hasText: 'Team sync' }).count()).toBeGreaterThanOrEqual(3);
  await expect(cal.locator('.cal-item', { hasText: 'Team sync' })).toContainText('Every week');

  // skip this one day of the series
  const before = await cal.locator('.cal-chip', { hasText: 'Team sync' }).count();
  await cal.locator('.cal-item', { hasText: 'Team sync' }).getByRole('button', { name: 'Skip this day' }).click();
  await expect(cal.locator(`[data-date="${day}"] .cal-chip`, { hasText: 'Team sync' })).toHaveCount(0);
  await expect(cal.locator('.cal-chip', { hasText: 'Team sync' })).toHaveCount(before - 1);

  // the assistant's view: the calendar is a contract like any other service
  const tools = await page.evaluate(() => window.tangleOs.kernel.tools().list().map(t => t.name).filter(n => n.startsWith('calendar')).sort());
  expect(tools).toEqual(['calendar__calendar_add', 'calendar__calendar_agenda', 'calendar__calendar_free']);
  const booked = await page.evaluate((date) => window.tangleOs.kernel.call('assistant', 'calendar', 'calendar.add', { title: 'Dentist', date, start: '15:00', end: '15:45' }), day);
  expect(booked.ok).toBe(true);
  await expect(cal.locator(`[data-date="${day}"] .cal-chip`, { hasText: 'Dentist' })).toBeVisible();
  const refused = await page.evaluate(() => window.tangleOs.kernel.call('assistant', 'calendar', 'calendar.add', { title: 'x', date: 'tomorrow' }));
  expect(refused.ok).toBe(false);
  const agenda = await page.evaluate((date) => window.tangleOs.kernel.call('assistant', 'calendar', 'calendar.agenda', { from: date, days: 1 }), day);
  expect(agenda.value.map(e => e.title)).toEqual(['Dentist']);
});

test('find a time offers free hours, and a slot opens the editor filled in', async ({ page }) => {
  const cal = await calendar(page);
  await cal.locator('.cal-segment').getByRole('radio', { name: '30 min' }).click();
  await cal.locator('.cal-find').getByRole('button', { name: 'Search' }).click();
  const slots = cal.locator('.cal-slot');
  await expect(slots.first()).toBeVisible();
  await slots.first().click();
  await expect(cal.locator('.cal-editor')).toBeVisible();
  const [start, end] = await Promise.all([cal.getByLabel('Starts').inputValue(), cal.getByLabel('Ends').inputValue()]);
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  expect(minutes(end) - minutes(start)).toBe(30);
  expect(start >= '09:00' && end <= '17:00').toBe(true);
});

test('the calendar downloads as iCalendar', async ({ page }) => {
  const cal = await calendar(page);
  await page.evaluate(() => window.tangleOs.kernel.call('assistant', 'calendar', 'calendar.add', { title: 'Weekly review', date: '2026-11-20', start: '16:00', end: '16:30', repeat: 'weekly' }));
  const downloading = page.waitForEvent('download');
  // Export lives in the calendar's menu in the window's header bar
  await cal.getByRole('button', { name: 'Calendar menu' }).click();
  await page.getByRole('menuitem', { name: 'Export .ics' }).click();
  const text = await readFile(await (await downloading).path(), 'utf8');
  expect(text).toContain('BEGIN:VCALENDAR');
  expect(text).toContain('SUMMARY:Weekly review');
  expect(text).toContain('RRULE:FREQ=WEEKLY');
});

test('a monthly series on the 31st says which months it skips', async ({ page }) => {
  const cal = await calendar(page);
  await cal.getByRole('button', { name: 'New event' }).click();
  await cal.getByLabel('Title').fill('Rent');
  await cal.getByLabel('Date').fill('2027-01-31');
  const hint = cal.locator('.cal-hint');
  await expect(hint).toBeHidden();
  await cal.getByLabel('Repeat').selectOption('monthly');
  await expect(hint).toHaveText('Months without a 31st are skipped.');
  await cal.locator('.cal-editor').getByRole('button', { name: 'Save' }).click();
  const march = await page.evaluate(() => window.tangleOs.kernel.call('assistant', 'calendar', 'calendar.agenda', { from: '2027-02-01', days: 59 }));
  expect(march.value.map(e => e.date)).toEqual(['2027-03-31']);
});
