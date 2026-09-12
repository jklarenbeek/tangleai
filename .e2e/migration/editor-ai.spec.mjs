import { test, expect } from './playwright.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodeShare } from '@jarenjs/app';
import { projectTemplate } from '../../apps/pages/src/demos/playground/projectTemplates.ts';
let bundle;
test.beforeAll(() => { bundle = execFileSync('bun', ['build', fileURLToPath(new URL('./host-fixture.ts', import.meta.url)), '--target=browser'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); });
async function api(page) {
  await page.route('**/host-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.evaluate(async () => { window.hostApi = await import('/host-fixture.js'); });
}
test('Data proposals preserve dirty edits, publish buffers without recreating storage and release workers on route exit', async ({ page }) => {
  await page.goto('/#/data'); await api(page);
  await expect(page.locator('.data-vfs')).not.toHaveText('—', { timeout: 30000 });
  expect(await page.evaluate(() => window.tanglePages.data().ready)).toMatchObject({ ok: true });
  await page.evaluate(() => {
    const editor = window.tanglePages.data(), { createDataAdapter } = window.hostApi;
    window.dataIdentity = editor;
    window.proposedQuery = [{ $for: { row: '$[*]' }, $where: { $gt: ['$row.points', 100000] }, $return: '$row' }];
    const client = { endpoint: { provider: 'openrouter' }, complete: () => new Promise(resolve => { window.resolveProposal = () => resolve({ message: { content: JSON.stringify(window.proposedQuery) } }); }) };
    window.dataAdapter = createDataAdapter({ editor, client }); window.proposal = window.dataAdapter.propose({ member: 'query', prompt: 'Match no rows.' });
  });
  await page.locator('.data-query textarea.editor').fill('{unfinished');
  await page.locator('.data-query textarea.editor').blur();
  await expect.poll(() => page.evaluate(() => window.dataIdentity.read().buffers.queryText)).toBe('{unfinished');
  const refused = await page.evaluate(async () => { const before = window.dataIdentity.read(); window.resolveProposal(); const proposal = await window.proposal;
    return { proposal, before, receipt: await window.dataAdapter.accept(proposal), after: window.dataIdentity.read(), unchanged: JSON.stringify(before) === JSON.stringify(window.dataIdentity.read()) }; });
  expect(refused.receipt.conflict, JSON.stringify(refused)).toBe(true); expect(refused.unchanged).toBe(true);
  await page.evaluate(() => window.tanglePages.navigate('#/flow'));
  await expect.poll(() => page.workers().length).toBe(0);
  expect(await page.evaluate(() => window.dataIdentity.run())).toMatchObject({ ok: false });
  await page.evaluate(() => window.tanglePages.navigate('#/data'));
  await expect(page.locator('.data-vfs')).not.toHaveText('—', { timeout: 30000 });
  expect(await page.evaluate(() => window.tanglePages.data().ready)).toMatchObject({ ok: true });
  expect(await page.evaluate(() => window.tanglePages.data() === window.dataIdentity)).toBe(true);
  await expect(page.locator('.data-query textarea.editor')).toHaveValue('{unfinished');
  const accepted = await page.evaluate(async () => {
    const editor = window.tanglePages.data(), before = editor.read();
    const write = await window.dataAdapter.write({ ...before.document, query: window.proposedQuery }, { expectedRevision: before.revision });
    return { write, run: await window.dataAdapter.run() };
  });
  expect(accepted.write.ok).toBe(true); expect(accepted.run.ok).toBe(true); expect(accepted.run.result).toEqual([]); expect(accepted.run.explain.sql).toContain('SELECT');
  await expect(page.locator('.data-rows')).toContainText('important');
  await page.evaluate(() => window.tanglePages.dispose()); await expect.poll(() => page.workers().length).toBe(0);
});
test('Flow AI and manual edits use one history and compiler; stale proposals retain human work', async ({ page }) => {
  await page.goto('/#/flow'); await api(page);
  await page.locator('article', { hasText: 'Blank machine' }).locator('button').click();
  await page.evaluate(() => {
    const editor = window.tanglePages.flow(); window.flowBefore = editor.read();
    window.flowCandidate = { $fsm: '0.1', initial: 'a', states: ['a', 'b'], transitions: [{ from: 'a', event: 'go', to: 'b' }] };
    window.flowAdapter = window.hostApi.createFlowAdapter({ editor, client: { endpoint: { provider: 'openrouter' }, complete: () => new Promise(resolve => { window.resolveFlow = () => resolve({ message: { content: JSON.stringify(window.flowCandidate) } }); }) } });
    window.flowProposal = window.flowAdapter.propose({ prompt: 'Build a two-state machine.' });
  });
  await page.getByRole('button', { name: 'Add state', exact: true }).click();
  const result = await page.evaluate(async () => { const before = window.tanglePages.flow().read(); window.resolveFlow(); const p = await window.flowProposal;
    const refusal = await window.flowAdapter.accept(p); return { refusal, unchanged: JSON.stringify(before) === JSON.stringify(window.tanglePages.flow().read()), accepted: await window.flowAdapter.write(window.flowCandidate, { kind: 'fsm', expectedRevision: before.revision }) }; });
  expect(result.refusal.conflict).toBe(true); expect(result.unchanged).toBe(true); expect(result.accepted.ok).toBe(true);
  await page.getByRole('button', { name: 'Run machine', exact: true }).click();
  await page.locator('.flow-run-buttons').getByRole('button', { name: 'go', exact: true }).click();
  await expect(page.locator('.flow-run-current')).toContainText('b');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.tanglePages.flow().read().document.states)).toContain('s2');
});
test('the Pages authoring tool runs a scripted provider through the real project editor', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => localStorage.setItem('tangle-ai', JSON.stringify({ provider: 'openrouter', baseUrl: 'https://fixture.invalid/v1', model: 'scripted', apiKey: 'scripted-fixture' })));
  await page.route('https://fixture.invalid/v1/chat/completions', route => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ title: 'Authored in Tangle', note: 'scripted result' }) } }] }) });
  });
  await page.goto('/#/project?s=' + encodeShare({ e: 'project', i: { project: projectTemplate('split-app') } }));
  await expect(page.locator('.js-stage-mount h1')).toHaveText('Hello from the studio');
  const result = await page.evaluate(() => window.tanglePages.toolbox.execute('jaren_project_author', { name: 'app.state', prompt: 'Set the title to Authored in Tangle.' }));
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(requests.length).toBe(1);
  await expect(page.locator('.js-stage-mount h1')).toHaveText('Authored in Tangle');
  expect(await page.evaluate(() => window.tanglePages.page())).toBe('project');
});

test('Studio tool state patches preserve local input and structural patches replace the stage', async ({ page }) => {
  await page.goto('/#/project');
  const initial = await page.evaluate(async () => {
    const doc = { state: { label: 'first' }, view: [{ match: '$', body: ['div', {}, ['input', { id: 'local-draft' }], ['p', { id: 'published-label' }, '$.label']] }] };
    return tanglePages.toolbox.execute('jaren_studio_write', { doc });
  });
  expect(initial.ok).toBe(true); expect(typeof initial.revision).toBe('number');
  const draft = page.locator('#local-draft'); await draft.fill('Keep my work');
  await draft.evaluate(node => { window.originalDraft = node; node.setSelectionRange(3, 7); });
  const changed = await page.evaluate(() => tanglePages.toolbox.execute('jaren_studio_patch', { patch: [{ op: 'replace', path: '/state/label', value: 'updated' }] }));
  expect(changed.ok).toBe(true); expect(changed.revision).toBe(initial.revision);
  await expect(page.locator('#published-label')).toHaveText('updated');
  await expect(draft).toHaveValue('Keep my work'); await expect(draft).toBeFocused();
  expect(await draft.evaluate(node => ({ same: node === window.originalDraft, start: node.selectionStart, end: node.selectionEnd }))).toEqual({ same: true, start: 3, end: 7 });
  const structural = await page.evaluate(() => tanglePages.toolbox.execute('jaren_studio_patch', { patch: [{ op: 'add', path: '/view/0/body/-', value: ['p', {}, 'New view'] }] }));
  expect(structural.ok).toBe(true); expect(structural.revision).toBe(initial.revision + 1);
  expect(await draft.evaluate(node => node === window.originalDraft)).toBe(false);
});
