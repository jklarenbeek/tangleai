import { test, expect } from './playwright.mjs';
test('scripted structured NPC dialogue, failure and route disposal preserve keyless play', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tangle-ai', JSON.stringify({ provider: 'openrouter', baseUrl: 'https://fixture.invalid/v1', model: 'scripted', apiKey: 'scripted-fixture' }));
    const original = window.fetch;
    window.fakeNpcMode = 'reply'; window.npcRequests = [];
    window.fetch = (url, init) => {
      if (!String(url).startsWith('https://fixture.invalid/')) return original(url, init);
      window.npcRequests.push(JSON.parse(init.body)); window.npcSignal = init.signal;
      const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ line: 'A receipt is a sandwich with evidence.', mood: 'wry' }) } }] }), { headers: { 'content-type': 'application/json' } });
      if (window.fakeNpcMode === 'fail') return Promise.resolve(new Response('{"error":{"message":"scripted failure"}}', { status: 400 }));
      if (window.fakeNpcMode === 'pending') return new Promise(resolve => { window.releaseNpc = () => resolve(reply()); });
      return Promise.resolve(reply());
    };
  });
  await page.goto('/#/game');
  await page.getByRole('button', { name: /Set sail/ }).click();
  await page.getByRole('button', { name: 'Talk to', exact: true }).click();
  await page.getByRole('button', { name: /Gullbert/ }).click();
  const ask = async () => { await page.getByPlaceholder('Ask them anything…').fill('What is a receipt?'); await page.getByRole('button', { name: /^Ask/ }).click(); };
  await ask(); await expect(page.locator('.game-log')).toContainText('A receipt is a sandwich with evidence.');
  expect(await page.evaluate(() => window.npcRequests[0].response_format.json_schema.name)).toBe('npc_line');
  await page.evaluate(() => { window.fakeNpcMode = 'fail'; }); await ask();
  await expect(page.locator('.game-log')).toContainText('briefly speechless');
  await page.evaluate(() => { window.fakeNpcMode = 'pending'; }); await ask();
  await expect.poll(() => page.evaluate(() => Boolean(window.releaseNpc))).toBe(true);
  await page.evaluate(() => window.tanglePages.navigate('#/flow'));
  expect(await page.evaluate(() => window.npcSignal.aborted)).toBe(true);
  await page.evaluate(() => { window.releaseNpc(); window.tanglePages.navigate('#/game'); });
  await expect(page.getByRole('button', { name: /^Ask/ })).toBeEnabled();
  expect(await page.evaluate(() => window.tanglePages.game().read().log.filter(line => line.text.includes('A receipt is a sandwich')).length)).toBe(1);
  await page.getByTitle('End conversation', { exact: true }).click();
  await page.getByRole('button', { name: /The Salty Spoon/ }).click(); await expect(page.locator('.game-scene h2')).toContainText('The Salty Spoon');
});
