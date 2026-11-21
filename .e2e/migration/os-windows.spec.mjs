/**
 * A window resizes from every edge and corner, by pointer, in a real browser:
 * the dragged edges follow the pointer and the opposite ones stay where they
 * were, the same on screen in a left-to-right and a right-to-left desktop.
 */
import { test, expect } from './playwright.mjs';

async function desktop(page, query = '') {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.tangleOs?.kernel);
  await page.evaluate(() => window.tangleOs.desktop.open('todo'));
  return page.locator('.tos-window[data-module="todo"]');
}
const box = (win) => win.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
/** Drag the window's handle for an edge by (dx, dy), from the handle's middle. */
async function dragEdge(page, win, edge, dx, dy) {
  const handle = win.locator(`.tos-resize[data-edge="${edge}"]`);
  const r = await handle.boundingBox();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2);
  await page.mouse.move(x + dx, y + dy);
  await page.mouse.up();
}
const near = (a, b) => Math.abs(a - b) <= 2;

test('a window resizes from its sides and corners, the opposite edges staying put', async ({ page }) => {
  const win = await desktop(page);
  await expect(win.locator('.tos-resize')).toHaveCount(8);
  const before = await box(win);
  await dragEdge(page, win, 'w', -80, 0);
  let now = await box(win);
  expect(near(now.left, before.left - 80) && near(now.right, before.right), `west: ${JSON.stringify(now)}`).toBe(true);
  await dragEdge(page, win, 's', 0, 60);
  const tall = await box(win);
  expect(near(tall.bottom, now.bottom + 60) && near(tall.top, now.top), `south: ${JSON.stringify(tall)}`).toBe(true);
  await dragEdge(page, win, 'ne', 40, 30);
  now = await box(win);
  expect(near(now.right, tall.right + 40) && near(now.top, tall.top + 30) && near(now.left, tall.left) && near(now.bottom, tall.bottom), `north-east: ${JSON.stringify(now)}`).toBe(true);
});

test('in a right-to-left desktop the edges are the same on screen: the right edge grows the right side', async ({ page }) => {
  const win = await desktop(page, '?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const before = await box(win);
  await dragEdge(page, win, 'e', 70, 0);
  const now = await box(win);
  expect(near(now.right, before.right + 70) && near(now.left, before.left), `east in rtl: ${JSON.stringify(now)}`).toBe(true);
});
