/**
 * The Pages desktop in every language it speaks. A sentinel pack renders every
 * key of the chrome and of the Pages applications as `⟦key⟧`, and finds no
 * other sentence in the windows the Pages desktop draws itself; then each of
 * the eleven packs draws those windows with no English sentence left, the
 * shell, Settings and the assistant in the same language, and Arabic mirrored.
 */
import { test, expect } from './playwright.mjs';
import { pagesMessagesEn } from '../../apps/pages/src/os/messages.ts';

/** Windows the Pages desktop draws itself (Jaren's applications bring their own catalogues). */
const OWN = ['welcome', 'settings', 'about', 'todo', 'calendar', 'loop'];

/** The day and month names `Intl` writes in a language: the browser's, never a catalogue's. */
const intlNames = (page, lang) => page.evaluate((lang) => {
  const out = [];
  for (const weekday of ['short', 'long', 'narrow']) for (let d = 0; d < 7; d++) out.push(new Intl.DateTimeFormat(lang, { weekday }).format(new Date(2026, 10, 16 + d)));
  for (const month of ['short', 'long']) for (let m = 0; m < 12; m++) out.push(new Intl.DateTimeFormat(lang, { month }).format(new Date(2026, m, 1)));
  return out;
}, lang);

/** Bring Settings to the front and show one of its sections. */
async function section(page, id) {
  await page.evaluate(() => window.tangleOs.desktop.focus(window.tangleOs.desktop.state().windows.find(w => w.module === 'settings').id));
  await page.locator(`.tos-settings-nav [data-section="${id}"]`).click();
}

async function desktop(page, query) {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => window.tangleOs?.kernel);
  for (const id of OWN) await page.evaluate((id) => window.tangleOs.desktop.open(id), id);
  await expect(page.locator('.tos-window')).toHaveCount(OWN.length);
}

/** The text of the desktop's chrome and of its own windows, visible now, attributes included. */
const texts = (page) => page.evaluate((own) => {
  const out = new Set();
  const mine = (el) => { const w = el.closest('.tos-window'); return !w || own.includes(w.dataset.module); };
  const walker = document.createTreeWalker(document.getElementById('desktop'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (text && mine(n.parentElement) && n.parentElement.checkVisibility?.() !== false) out.add(text);
  }
  for (const el of document.querySelectorAll('#desktop [aria-label], #desktop [title], #desktop [placeholder]'))
    if (mine(el)) for (const a of ['aria-label', 'title', 'placeholder']) { const v = el.getAttribute(a)?.trim(); if (v) out.add(v); }
  return [...out];
}, OWN);

test('every sentence of the Pages desktop comes from a catalogue: a sentinel pack finds no other', async ({ page }) => {
  await desktop(page, 'lang=sentinel');
  // every Settings section, one after the other
  for (const id of await page.locator('.tos-settings-nav button').evaluateAll(bs => bs.map(b => b.dataset.section))) {
    await section(page, id);
    const found = await texts(page);
    // named owners: product and application names, numbers, dates and times `Intl` wrote, model and provider names
    const owned = new Set([
      ...await page.evaluate(() => window.tangleOs.kernel.modules().map(m => m.title.en)),
      // a section's title is a localized text whose English half stays English under the sentinel
      ...Object.entries(pagesMessagesEn).filter(([k, v]) => typeof v === 'string' && k.endsWith('/title')).map(([, v]) => v),
      ...await intlNames(page, 'en'),
    ]);
    const stray = found.filter(t => !t.includes('⟦') && !owned.has(t) && !/\d/.test(t) && !/^(Tangle( OS)?|Jaren|OpenRouter|Venice|Ollama|LM Studio|Anthropic|[•·×—–\-+/:,.()✓✕★☆…]+)$/.test(t));
    expect.soft(stray, `section ${id}`).toEqual([]);
  }
});

for (const lang of ['ar', 'de', 'es', 'fr', 'ja', 'ko', 'nl', 'pt', 'ru', 'tr', 'zh-TW']) {
  test(`the Pages desktop in ${lang}: its own windows, the shell and Settings in that language${lang === 'ar' ? ', mirrored' : ''}`, async ({ page }) => {
    const file = lang === 'zh-TW' ? 'zh-tw' : lang;
    const pack = Object.values(await import(`../../apps/pages/src/os/messages/${file}.ts`))[0];
    const chrome = Object.values(await import(`../../components/os/src/messages/${file}.ts`))[0];
    await desktop(page, `lang=${lang}`);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('#desktop')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    await expect(page.locator('.tos-dock')).toHaveAttribute('aria-label', chrome['dock/label']);
    // a word the pack itself writes as English does (a term such as Recall, a name) is the language's own
    const own = new Set(Object.values(pack).filter(v => typeof v === 'string').map(v => v.trim()));
    const english = Object.entries(pagesMessagesEn).filter(([k, v]) => typeof v === 'string' && pack[k] !== v && !v.includes('{') && v.trim().length > 3 && !own.has(v.trim())).map(([, v]) => v.trim());
    for (const id of await page.locator('.tos-settings-nav button').evaluateAll(bs => bs.map(b => b.dataset.section))) {
      await section(page, id);
      const found = new Set(await texts(page));
      expect.soft(english.filter(v => found.has(v)), `section ${id}`).toEqual([]);
    }
  });
}
