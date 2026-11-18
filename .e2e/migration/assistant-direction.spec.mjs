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
    await page.goto('/classic.html');
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

// a reply is Jaren's Markdown in Jaren's stylesheet, which sets logical sides only: in a right-to-left
// reply the list indent, the quote rule and the cells start on the right, and diagram source stays code
test('a right-to-left reply mirrors its lists, quotes and tables', async ({ page }) => {
  const { parseMarkdown, toHtml } = await import('@jarenjs/md');
  const md = readFileSync(new URL('../../node_modules/@jarenjs/md/styles/md.css', import.meta.url), 'utf8');
  const html = toHtml(parseMarkdown('- أولًا\n- ثانيًا\n\n> اقتباس من المصدر\n\n| العمود | القيمة |\n|---|---|\n| أ | ١ |\n'));
  for (const dir of ['ltr', 'rtl']) {
    await page.setContent(`<style>${md}</style><article class="md" dir="${dir}" lang="${dir === 'rtl' ? 'ar' : 'en'}" style="inline-size:600px">${html}</article>`);
    const sides = await page.evaluate(() => {
      const s = (sel) => getComputedStyle(document.querySelector(sel));
      return { listLeft: parseFloat(s('.md ul').paddingLeft), listRight: parseFloat(s('.md ul').paddingRight), quoteLeft: parseFloat(s('.md blockquote').borderLeftWidth), quoteRight: parseFloat(s('.md blockquote').borderRightWidth) };
    });
    const cell = await page.locator('.md td').first().boundingBox(), table = await page.locator('.md table').boundingBox();
    if (dir === 'rtl') {
      expect(sides.listRight).toBeGreaterThan(0); expect(sides.listLeft).toBe(0);
      expect(sides.quoteRight).toBe(3); expect(sides.quoteLeft).toBe(0);
      expect(Math.round(cell.x + cell.width)).toBeGreaterThanOrEqual(Math.round(table.x + table.width) - 1);
    } else {
      expect(sides.listLeft).toBeGreaterThan(0); expect(sides.listRight).toBe(0);
      expect(sides.quoteLeft).toBe(3); expect(sides.quoteRight).toBe(0);
      expect(Math.round(cell.x)).toBeLessThanOrEqual(Math.round(table.x) + 1);
    }
  }
});
