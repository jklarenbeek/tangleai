import { test, expect } from './playwright.mjs';
import { readFile } from 'node:fs/promises';

/** What a person runs in the old origin's console: it reads only the named slots and refuses credentials. */
const OLD_ORIGIN_EXPORT = String.raw`const selected = ['transcript', 'ledger', 'game', 'projects'];
const keys = { transcript: 'jaren-ai-chat', ledger: 'jaren-ai-ledger',
  game: 'jaren-game', projects: 'jaren-ide' };
const data = {};
for (const member of selected) {
  if (!Object.hasOwn(keys, member)) throw Error('Unknown selected member');
  const raw = localStorage.getItem(keys[member]);
  if (raw !== null) data[member] = member === 'game' ? raw : JSON.parse(raw);
}
const key = JSON.parse(localStorage.getItem('jaren-ai') ?? 'null')?.apiKey;
function inspect(value) {
  if (typeof value === 'string' && key && value.includes(key))
    throw Error('A configured credential appears in the selected data');
  if (value && typeof value === 'object') for (const [name, child] of Object.entries(value)) {
    if (/^(?:api[-_]?key|authorization|access[-_]?token|password|secret|__proto__|constructor|prototype)$/i.test(name))
      throw Error('A private or unsafe field appears in the selected data: ' + name);
    inspect(child);
  }
}
inspect(data);
const file = JSON.stringify({ format: 'tangle-browser-data', version: 1, data }, null, 2);
const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }));
const link = document.createElement('a'); link.href = url;
link.download = 'jaren-browser-data.json'; document.body.append(link);
link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);`;
test('explicit old-origin export imports once and a second import makes no writes', async ({ page }) => {
  await page.goto('/classic.html');
  await page.evaluate(() => {
    localStorage.setItem('jaren-ai', JSON.stringify({ apiKey: 'never-export-this-fixture-key', model: 'not-exported' }));
    localStorage.setItem('jaren-ai-chat', JSON.stringify({ messages: [{ role: 'assistant', content: '**Transferred** transcript' }] }));
    localStorage.setItem('jaren-ai-ledger', JSON.stringify({ 'ai/state/memory/m000001': { id: 'm000001', text: 'same id', evidence: 'original receipt', at: '2026-09-09T00:00:00Z' }, 'ai/counters/memory': 2 }));
    localStorage.setItem('jaren-game', '{"nameForm":{"name":"Original pirate"}}');
  });
  const downloading = page.waitForEvent('download'); await page.evaluate(OLD_ORIGIN_EXPORT);
  const download = await downloading, bytes = await readFile(await download.path());
  expect(bytes.toString()).not.toContain('never-export-this-fixture-key'); expect(bytes.toString()).not.toContain('apiKey');
  const old = await page.evaluate(() => Object.fromEntries(['jaren-ai', 'jaren-ai-chat', 'jaren-ai-ledger', 'jaren-game'].map(k => [k, localStorage.getItem(k)])));
  await page.locator('.demo-transfer summary').click();
  const file = page.getByLabel('Import browser data');
  await file.setInputFiles({ name: 'old-browser-data.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('#data-transfer-controls [role="status"]')).toContainText('Imported 3 slots');
  const first = await page.evaluate(() => ({ chat: localStorage.getItem('tangle-ai-chat'), ledger: localStorage.getItem('tangle-ai-ledger'), game: localStorage.getItem('tangle-game') }));
  await page.evaluate(() => { window.transferWrites = 0; const set = Storage.prototype.setItem; Storage.prototype.setItem = function(...args) { window.transferWrites++; return set.apply(this, args); }; });
  await file.setInputFiles({ name: 'old-browser-data.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('#data-transfer-controls [role="status"]')).toContainText('Imported 0 slots; 3 already matched');
  const second = await page.evaluate(() => ({ chat: localStorage.getItem('tangle-ai-chat'), ledger: localStorage.getItem('tangle-ai-ledger'), game: localStorage.getItem('tangle-game') }));
  expect(second).toEqual(first); expect(await page.evaluate(() => window.transferWrites)).toBe(0);
  expect(await page.evaluate(() => Object.fromEntries(['jaren-ai', 'jaren-ai-chat', 'jaren-ai-ledger', 'jaren-game'].map(k => [k, localStorage.getItem(k)])))).toEqual(old);
  await page.getByRole('button', { name: 'Resume Tangle' }).click();
  await page.locator('.ai-launch').click(); await expect(page.locator('.ai-msg.assistant strong')).toHaveText('Transferred');
});
