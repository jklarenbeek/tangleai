import { test, expect } from './playwright.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// the shipped stylesheet sets no physical side: the root's dir alone decides
// which edge the launcher and the panel sit on
const css = readFileSync(new URL('../../components/assistant/styles/assistant.css', import.meta.url), 'utf8');
let bundle;
test.beforeAll(() => { bundle = execFileSync('bun', ['build', fileURLToPath(new URL('./host-fixture.ts', import.meta.url)), '--target=browser'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); });

for (const dir of ['ltr', 'rtl']) {
  test(`a ${dir} view puts its launcher and panel at the inline end`, async ({ page }) => {
    await page.route('**/host-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
    await page.goto('/');
    await page.evaluate(async () => { await window.tanglePages.dispose(); window.hostApi = await import('/host-fixture.js'); });
    await page.addStyleTag({ content: css });
    await page.evaluate(dir => {
      const node = document.createElement('div'); node.id = 'direction-host'; document.body.append(node);
      window.directionView = window.hostApi.mountAssistantView(node, {
        dir, lang: dir === 'rtl' ? 'ar' : 'en', messages: dir === 'rtl' ? window.hostApi.ar : undefined,
        transport: { start: () => 'run', cancel: () => {} }, state: { status: 'idle', messages: [] },
      });
    }, dir);
    const width = page.viewportSize().width;
    const centre = async selector => { const box = await page.locator(`#direction-host ${selector}`).boundingBox(); return box.x + box.width / 2; };
    const atEnd = x => (dir === 'rtl' ? x < width / 2 : x > width / 2);
    expect(atEnd(await centre('.ai-launch'))).toBe(true);
    await page.locator('#direction-host .ai-launch').click();
    expect(atEnd(await centre('.ai-panel'))).toBe(true);
    if (dir === 'rtl') await expect(page.locator('#direction-host .ai-status')).toHaveText('جاهز لمهمة جديدة.');
    await page.evaluate(() => window.directionView.dispose());
  });
}
