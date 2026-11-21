/**
 * A document module's form works inside its sandboxed frame: the frame has no
 * form submission (no allow-forms), so the module host turns a submit button
 * and Enter into the form's submit event, which the document handles; nothing
 * navigates and the browser reports no blocked submission.
 */
import { test, expect } from './playwright.mjs';

test('To do adds an item by its button and by Enter, and adds nothing while the field is empty', async ({ page }) => {
  const blocked = [];
  page.on('console', (message) => { if (/Blocked form submission/i.test(message.text())) blocked.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs?.kernel);
  await page.evaluate(() => window.tangleOs.desktop.open('todo'));
  const todo = page.frameLocator('.tos-window[data-module="todo"] iframe');
  const field = todo.getByRole('textbox', { name: 'New item' });
  await expect(field).toBeVisible();
  const before = await todo.locator('li').count();

  await field.fill('Water the plants');
  await todo.getByRole('button', { name: 'Add' }).click();
  await expect(todo.locator('li')).toHaveCount(before + 1);
  await expect(todo.locator('li').last()).toContainText('Water the plants');
  await expect(field).toHaveValue('');

  await field.fill('Call the plumber');
  await field.press('Enter');
  await expect(todo.locator('li')).toHaveCount(before + 2);
  await expect(todo.locator('li').last()).toContainText('Call the plumber');

  // the Add button is disabled while the field is empty: Enter submits nothing either
  await field.press('Enter');
  await expect(todo.locator('li')).toHaveCount(before + 2);
  expect(blocked, 'the browser blocked no form submission').toEqual([]);
});
