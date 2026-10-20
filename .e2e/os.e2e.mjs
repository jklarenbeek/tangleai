// Radiant OS (Tangle edition) e2e — boot, the human's verdict, the oracle
// hearing the human, the OS database, a crew project shipped, the board, the
// Library, every game, and a small model playing the crew, in a real browser.
import { createRequire } from 'node:module';
const jarenRequire = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../jarenjs/package.json', import.meta.url));
const { chromium } = jarenRequire('playwright-core');

const base = process.env.PAGES_URL ?? 'http://127.0.0.1:4715';
// a qualified browser outside Playwright's own cache, when the host has one
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const fail = async (msg) => {
  await page.screenshot({ path: new URL('./os-fail.png', import.meta.url).pathname, fullPage: true }).catch(() => {});
  console.error('FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));
const pill = (label) => page.locator('.os-pill', { hasText: label }).locator('.os-pill-value').textContent();

await page.goto(base + '/os/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.os[data-phase="idle"]', { timeout: 10000 }).catch(() => fail('the OS did not boot'));
await page.waitForSelector('.os-stage canvas', { timeout: 4000 }).catch(() => fail('no stage canvas'));
await page.waitForTimeout(1200);
if (!(Number(await pill('tick')) > 5)) await fail('the machine is not running');
if (await pill('oracle') !== 'scripted') await fail(`unexpected oracle seat: ${await pill('oracle')}`);

await page.fill('#os-say-input', 'more symmetry, please');
await page.click('button:has-text("Say")');
await page.click('button:has-text("Convene now")');
await page.waitForSelector('.os[data-phase="veto"]', { timeout: 20000 }).catch(() => fail('no verdict'));
const heard = await page.locator('.os-proposal', { hasText: 'Oracle' }).textContent().catch(() => '');
if (!/You asked for symmetry/.test(heard ?? '')) await fail(`the oracle did not hear the human: ${heard}`);
await page.click('button.os-veto');
await page.waitForSelector('.os-amendment.is-vetoed', { timeout: 8000 }).catch(() => fail('the veto was not recorded'));

await page.click('.os-dock-btn:has-text("Gallery")');
await page.waitForSelector('.os-gallery', { timeout: 4000 });
const storage = await page.locator('.os-gallery .os-hint').first().textContent();
if (!/Storage: (sqlite on OPFS|memory)\./.test(storage ?? '')) await fail(`unexpected storage: ${storage}`);
await page.fill('#os-title-input', 'e2e');
await page.click('button:has-text("Keep")');
await page.waitForSelector('.os-artwork-title:has-text("e2e")', { timeout: 8000 }).catch(() => fail('the artwork was not kept'));

// the studio: a crew project the scripted crew builds (no model seated), shipped by the human
await page.click('.os-dock-btn:has-text("Crew")');
await page.fill('input[placeholder="A habit tracker"]', 'e2e app');
await page.locator('.os-crew input[type=range]').fill('2');
await page.click('button:has-text("Start the project")');
for (const idea of ['a counter for cups of tea', 'a checklist for the shopping']) {
  await page.fill('#os-crew-idea', idea);
  await page.click('button:has-text("Add idea")');
}
await page.click('button:has-text("End my turn")');
const review = page.locator('section[aria-label="Review"] button.os-pass');
await review.first().waitFor({ timeout: 30000 }).catch(() => fail('the crew did not build'));
while (await review.count() > 0) await review.first().click();
await page.waitForSelector('.os-crew-shipped', { timeout: 8000 }).catch(() => fail('the project did not ship'));

// the board, and the library the build collected, asked offline
await page.click('.os-dock-btn:has-text("Board")');
await page.fill('#os-board-input', 'e2e note');
await page.click('button:has-text("Pin it")');
await page.waitForSelector('.os-card:has-text("e2e note")', { timeout: 4000 }).catch(() => fail('the card was not pinned'));
await page.click('.os-dock-btn:has-text("Library")');
await page.waitForSelector('.os-docs button:has-text("Radiant OS field guide")', { timeout: 8000 }).catch(() => fail('the library did not load'));
await page.fill('#os-library-ask', 'how does the crew build');
await page.click('.os-ask button:has-text("Ask")');
await page.waitForSelector('.os-answer-text', { timeout: 8000 }).catch(() => fail('the library did not answer'));

// every game: its title, play, pause, continue and quit
for (const game of ['grove', 'dancers', 'arena']) {
  await page.goto(`${base}/os/?game=${game}`, { waitUntil: 'domcontentloaded' });
  const arcade = `.os-arcade[data-game="${game}"]`;
  await page.waitForSelector(`${arcade}[data-phase="title"]`, { timeout: 10000 }).catch(() => fail(`${game} did not open`));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForSelector(`${arcade}[data-phase="playing"]`, { timeout: 4000 }).catch(() => fail(`${game} did not start`));
  await page.keyboard.press('Escape');
  await page.waitForSelector(`${arcade}[data-phase="paused"]`, { timeout: 4000 }).catch(() => fail(`${game} did not pause`));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForSelector(`${arcade}[data-phase="playing"]`, { timeout: 4000 }).catch(() => fail(`${game} did not continue`));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Quit to the studio', exact: true }).click();
  await page.waitForSelector('.os-arcade', { state: 'detached', timeout: 4000 }).catch(() => fail(`${game} did not quit`));
}

// a small model plays the crew: a scripted endpoint on the OpenAI wire, reached
// through the catalog of three short tools its budget offers
const seated = await browser.newPage({ viewport: { width: 1280, height: 860 } });
seated.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));
await seated.addInitScript(() => localStorage.setItem('tangle-ai', JSON.stringify({ provider: 'custom', baseUrl: 'https://model.invalid/v1', model: 'qwen/qwen3.6-35b-a3b', apiKey: '' })));
const calls = [];
await seated.route('https://model.invalid/**', async (route) => {
  const body = route.request().postDataJSON();
  const tools = (body.tools ?? []).map((t) => t.function.name);
  const user = body.messages.find((m) => m.role === 'user')?.content ?? '';
  const idea = /Idea (\S+):/.exec(user)?.[1];
  const done = body.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls ?? []).length;
  const use = (name, input) => (tools.includes(name) ? { name, args: input } : { name: 'tool_call', args: { name, input } });
  const plan = idea ? [
    ...(tools.includes('tool_list') ? [{ name: 'tool_list', args: {} }] : []),
    use('crew_build', { idea, block: { kind: 'counter', label: 'Cups from the model', step: 1 } }),
    use('crew_say', { idea, text: 'Built by the model.' }),
  ] : [];
  const next = plan[done];
  if (next) calls.push(next.name);
  const message = next
    ? { role: 'assistant', content: null, tool_calls: [{ id: `c${calls.length}`, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] }
    : { role: 'assistant', content: 'Done.' };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'e2e', object: 'chat.completion', choices: [{ index: 0, finish_reason: next ? 'tool_calls' : 'stop', message }] }) });
});
await seated.goto(base + '/os/?app=crew', { waitUntil: 'domcontentloaded' });
await seated.waitForSelector('.os-crew', { timeout: 10000 }).catch(() => fail('the crew app did not open'));
await seated.fill('input[placeholder="A habit tracker"]', 'model app');
await seated.click('button:has-text("Start the project")');
await seated.fill('#os-crew-idea', 'a counter for cups of tea');
await seated.click('button:has-text("Add idea")');
await seated.click('button:has-text("End my turn")');
await seated.waitForSelector('section[aria-label="Review"]:has-text("Cups from the model")', { timeout: 30000 }).catch(() => fail(`the model did not build (calls: ${calls.join(', ')})`));
if (calls.join(',') !== 'tool_list,tool_call,tool_call') await fail(`unexpected tool calls: ${calls.join(', ')}`);

console.log(`os e2e: OK (${storage?.trim()}; the model's crew took ${calls.length} calls)`);
await browser.close();
