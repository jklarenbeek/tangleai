// tangle desktop browser e2e — run inside the ubuntu-playwright distrobox.
// Uses the jarenjs repo's playwright install via NODE_PATH.
// Usage: start the target server on the host, then run inside the
// playwright distrobox:
//   distrobox enter ubuntu-playwright -- bash -c 'export PATH=$HOME/.nvm/versions/node/v24.20.0/bin:$PATH; cd ~/projects/jp/tangleai && node .e2e/desktop.e2e.mjs'
// The Skills page reads whatever the database holds: to exercise its detail
// branch rather than its empty state, seed a run into the server's --data
// directory first (drive a mode into a `createTrace2SkillDbStore` over that
// database and activate the candidate); with nothing seeded the page must
// still render its empty state, and this script accepts either.
// Playwright is borrowed from the jarenjs repo via createRequire.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const jarenRequire = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../jarenjs/package.json', import.meta.url));
const { chromium, webkit } = jarenRequire('playwright-core');

const base = process.env.TANGLE_URL ?? 'http://127.0.0.1:4714';
const shots = process.env.TANGLE_SHOTS ?? new URL('.', import.meta.url).pathname;
const engine = process.env.TANGLE_ENGINE === 'webkit' ? webkit : chromium;

const browser = await engine.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const fail = async (msg) => {
  await page.screenshot({ path: `${shots}/fail.png`, fullPage: true }).catch(() => {});
  console.error('FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.brand', { timeout: 8000 }).catch(() => fail('header never rendered'));

// settings: preset folder made it into the draft
await page.click('.tabs button:has-text("Settings")');
const folderValue = await page.inputValue('.group input[placeholder="/path/to/your/notes"]');
if (!folderValue.includes('tangle-e2e')) await fail(`folder draft wrong: '${folderValue}'`);

await page.fill('input[placeholder="provider default"]', '256');
await page.locator('select').filter({ has: page.locator('option[value="max_completion_tokens"]') }).selectOption('max_completion_tokens');
await page.click('button.send:has-text("save")');
await page.waitForSelector('span.saved:has-text("saved ✓")');
const persisted = await page.evaluate(async () => (await fetch('/api/settings')).json());
if (persisted.chat.maxTokens !== 256 || persisted.chat.maxTokensField !== 'max_completion_tokens') await fail('token controls did not persist');
// The settings contract is exercised without enabling a paid provider.

// profile selection: choosing the shipped profile on a host holding no
// key for its candidate's provider must REFUSE, visibly and fixably —
// that is the honest thing for a keyless gate to prove, and a fallback
// to the projection would be the defect this control exists to prevent.
await page.locator('.group.profile select').selectOption('desktop-default');
await page.waitForSelector('.group.profile .preview .error-inline', { timeout: 8000 })
  .catch(() => fail('the selected profile rendered no refusal'));
const previewText = await page.locator('.group.profile .preview').innerText();
for (const marker of ['TCFG1015', '/roles/chat/capability', 'openrouter-primary']) {
  if (!previewText.includes(marker)) await fail(`the preview did not render ${marker}: ${previewText.slice(0, 200)}`);
}
await page.click('button.send:has-text("save")');
// the save is asynchronous; the stale "saved ✓" badge is not the receipt
await page.waitForFunction(async () => (await (await fetch('/api/settings')).json()).profile === 'desktop-default',
  null, { timeout: 8000, polling: 100 }).catch(() => fail('the selection did not persist'));
const refusedConfig = await page.evaluate(async () => (await fetch('/api/config')).json());
if (refusedConfig.request.kind !== 'profile') await fail('a saved selection is still asking as the projection');
if (refusedConfig.resolution.state !== 'refused') await fail(`a selection with no bound key resolved ${refusedConfig.resolution.state}`);
if (refusedConfig.identity !== null) await fail('a refused selection produced an identity');
const refusedCodes = refusedConfig.resolution.issues.map((issue) => `${issue.code} ${issue.path}`).join(', ');
if (refusedCodes !== 'TCFG1015 /roles/chat/capability') await fail(`unexpected refusal: ${refusedCodes}`);
console.log(`profile selection refused as ${refusedCodes}`);

// back to no selection, so the rest of the script runs the host's own projection
await page.locator('.group.profile select').selectOption('');
await page.click('button.send:has-text("save")');
await page.waitForFunction(async () => (await (await fetch('/api/settings')).json()).profile === null,
  null, { timeout: 8000, polling: 100 }).catch(() => fail('the selection was not cleared'));
const cleared = await page.evaluate(async () => (await fetch('/api/config')).json());
if (cleared.request.kind !== 'legacy' || cleared.resolution.state !== 'ready') {
  await fail(`clearing the selection did not restore the projection: ${JSON.stringify(cleared.resolution)}`);
}
// loom: sync, watch the DAG light up, run history appears
await page.click('.tabs button:has-text("Loom")');
await page.waitForSelector('.dag-svg svg', { timeout: 8000 }).catch(() => fail('mermaid svg missing'));
// The host watches the folder, so the server's start scan may already
// have taken this corpus in and the click can legitimately answer
// sync-busy or find nothing to do. What is asserted is the OUTCOME: a
// file appearing in the watched folder must light the loom up with no
// click at all.
await page.click('button:has-text("sync folder")');
await page.waitForSelector('tr.run', { timeout: 8000 }).catch(() => fail('no run row'));
// the content carries the run's own stamp, so a rerun against the same
// fixture folder is a new hash and a real pass rather than a hash-skip
await writeFile(join(persisted.folder, 'e2e-watched.md'),
  `The watcher takes a file the operator dropped into the folder at ${new Date().toISOString()}\n\nA second statement long enough to become its own unit`);
// the write is debounced, so the pass it causes is waited for, never assumed
await page.waitForFunction(async () => {
  const state = await (await fetch('/api/folder/watch')).json();
  return state.scans.change >= 1;
}, null, { timeout: 20000, polling: 250 }).catch(() => fail('the file write ran no pass'));
await page.waitForFunction(() => document.querySelectorAll('.node.ok').length >= 5, null, { timeout: 20000 })
  .catch(() => fail('the watched pass never lit five nodes'));
const watchState = await page.evaluate(async () => (await fetch('/api/folder/watch')).json());
if (watchState.mode !== 'recursive') await fail(`watch mode ${JSON.stringify(watchState.mode)}`);
if (!(watchState.scans.start >= 1)) await fail(`no start scan: ${JSON.stringify(watchState.scans)}`);
if (watchState.overflows !== 0) await fail(`unexpected overflow: ${JSON.stringify(watchState)}`);
await page.waitForFunction(async () => {
  const window_ = await (await fetch('/api/runs/live?limit=5')).json();
  return window_.rows?.[0]?.status !== 'running';
}, null, { timeout: 15000 }).catch(() => fail('the newest run never reached a terminal state'));
await page.click('tr.run');
await page.waitForSelector('.run-detail table.events tr', { timeout: 8000 }).catch(() => fail('no run detail events'));
// the detail states which configuration produced the run it shows
const identityLine = await page.locator('.run-detail .run-identity').innerText().catch(() => '');
if (!identityLine.includes('requested legacy')) await fail(`the run detail states no configuration: '${identityLine}'`);
// the run window is a live subscription; read without the event-stream
// accept header it answers its snapshot, and the sync is the run it names
const runWindow = await page.evaluate(async () => (await fetch('/api/runs/live?limit=5')).json());
if (runWindow.rows?.[0]?.kind !== 'sync') await fail(`the run window does not name the sync: ${JSON.stringify(runWindow).slice(0, 160)}`);
const watched = await page.evaluate(async (id) => (await fetch(`/api/runs/live/frames?runId=${id}`)).json(), runWindow.rows[0].id);
if (!watched.rows?.every((row) => row.runId === runWindow.rows[0].id)) await fail('a run stream carried another run\'s frame');
if (watched.rows.at(-1)?.kind !== 'status') await fail('the run has no terminal frame');
if (!watched.rows.some((row) => row.kind === 'sync')) await fail('the pass recorded no counted frame');
await page.waitForSelector('.watch-line', { timeout: 4000 }).catch(() => fail('the loom shows no watcher line'));
await page.screenshot({ path: `${shots}/loom.png`, fullPage: true });

// skills: the read-only surface renders whatever the store holds
await page.click('.tabs button:has-text("Skills")');
await page.waitForSelector('.page.skills', { timeout: 8000 }).catch(() => fail('skills page never rendered'));
const skillRuns = await page.locator('tr.skill-run').count();
if (skillRuns === 0) {
  await page.waitForSelector('.skills-empty', { timeout: 4000 }).catch(() => fail('no runs and no empty state'));
} else {
  await page.click('tr.skill-run');
  await page.waitForSelector('.skill-detail', { timeout: 8000 }).catch(() => fail('no skill run detail'));
  const counts = await page.locator('.skill-counts').innerText();
  if (!/\d+ rollouts/.test(counts)) await fail(`skill counts unreadable: ${counts}`);
  await page.waitForSelector('.skill-merges .merge-node', { timeout: 4000 }).catch(() => fail('no merge tree'));
  await page.waitForSelector('.skill-diff', { timeout: 4000 }).catch(() => fail('no candidate diff'));
  await page.waitForSelector('.skill-verdict', { timeout: 4000 }).catch(() => fail('no evaluation verdict'));
}
const skillsApi = await page.evaluate(async () => (await fetch('/api/skills/runs')).status);
if (skillsApi !== 200) await fail(`skills.runs.list answered ${skillsApi}`);
await page.screenshot({ path: `${shots}/skills.png`, fullPage: true });

// memory: units are listed
await page.click('.tabs button:has-text("Memory")');
await page.waitForSelector('.unit', { timeout: 8000 }).catch(() => fail('no memory units'));

// chat: grounded offline answer with citations
await page.click('.tabs button:has-text("Chat")');
await page.fill('.chat-input', 'what port does the demo service listen on?');
await page.click('button.send');
// the reply settles when the run's own stream reaches the page, and engines
// do not flush a stream's trailing events at the same moment: measured over
// the same run, Chromium had settled by two seconds while WebKit was still
// pending at ten and settled by twenty, with an identical frame sequence and
// an identical terminal state on the server in both. The bound belongs to
// the slower engine, not to the faster one.
await page.waitForSelector('.msg.assistant:not(.pending)', { timeout: 40000 }).catch(() => fail('no assistant reply'));
const reply = await page.locator('.msg.assistant:not(.pending)').last().innerText();
if (!reply.includes('9090')) await fail(`reply not grounded: ${reply.slice(0, 200)}`);
await page.waitForSelector('.citation', { timeout: 8000 }).catch(() => fail('no citations'));
await page.screenshot({ path: `${shots}/chat.png`, fullPage: true });

// feedback: a thumb opens the form and records nothing; only a verdict
// carrying a reason and a named source is recorded, and the row then
// shows what was stored
const answered = page.locator('.msg.assistant:not(.pending)').last();
await answered.locator('button.thumb.up').click();
await page.waitForSelector('.feedback-form .feedback-submit', { timeout: 8000 }).catch(() => fail('the verdict form never opened'));
if (await page.locator('.feedback-recorded').count() !== 0) await fail('a thumb recorded a verdict on its own');
if (!await page.locator('.feedback-submit').isDisabled()) await fail('the submit control was enabled with no reason and no evidence');
await page.fill('.feedback-reason', 'this named the port the demo service listens on');
await page.locator('.feedback-evidence .evidence-option input').first().check();
await page.click('.feedback-submit');
await page.waitForSelector('.feedback-recorded', { timeout: 8000 }).catch(() => fail('the recorded verdict never rendered'));
const recorded = await page.locator('.feedback-recorded').first().innerText();
if (!recorded.includes('recorded: success')) await fail(`the recorded verdict is wrong: ${recorded}`);
await page.screenshot({ path: `${shots}/feedback.png`, fullPage: true });

// reports: what this host registered, one real keyless measurement, and
// the stored document re-verified against the identity it is filed under
await page.click('.tabs button:has-text("Reports")');
await page.waitForSelector('.page.reports', { timeout: 8000 }).catch(() => fail('reports page never rendered'));
const registered = await page.locator('.instruments li').count();
let reportLine = 'no instrument registered on this host';
if (registered === 0) {
  const empty = await page.locator('.page.reports').innerText();
  if (!empty.includes('registers no instrument')) await fail('an empty registry said nothing about itself');
} else {
  await page.locator('.instruments li', { hasText: 'Config conformance' }).locator('button.send').click();
  await page.waitForSelector('.stored-reports table tr', { timeout: 120000 }).catch(() => fail('no report was stored'));
  reportLine = await page.locator('.receipt').innerText();
  if (!/exit 0/.test(reportLine)) await fail(`the report run did not exit zero: ${reportLine}`);
  await page.locator('.stored-reports table tr').first().click();
  await page.waitForSelector('.report-document', { timeout: 8000 }).catch(() => fail('the stored document never rendered'));
  const verdict = await page.locator('.run-detail .hint').first().innerText();
  if (!verdict.includes('identity verified against the stored bytes')) await fail(`the stored identity was not verified: ${verdict}`);
}
await page.screenshot({ path: `${shots}/reports.png`, fullPage: true });

const counts = await page.locator('.meta').innerText();
console.log('PASS —', counts, '| reply:', reply.split('\n')[0].slice(0, 80), '| feedback:', recorded.replace(/\n/g, ' ').slice(0, 80),
  '| report:', reportLine.replace(/\n/g, ' ').slice(0, 80));
await browser.close();
process.exit(0);
