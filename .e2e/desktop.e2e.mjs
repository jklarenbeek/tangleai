// tangle desktop browser e2e — run inside the ubuntu-playwright distrobox.
// Uses the jarenjs repo's playwright install via NODE_PATH.
// Usage: start the target server on the host, then run inside the
// playwright distrobox:
//   distrobox enter ubuntu-playwright -- bash -c 'export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; cd ~/projects/jp/tangleai && node .e2e/desktop.e2e.mjs'
// Playwright is borrowed from the jarenjs repo via createRequire.
import { createRequire } from 'node:module';
const jarenRequire = createRequire('/home/joham/projects/jp/jarenjs/package.json');
const { chromium, webkit } = jarenRequire('playwright-core');

const base = process.env.TANGLE_URL ?? 'http://127.0.0.1:4714';
const shots = process.env.TANGLE_SHOTS ?? '/home/joham/projects/jp/tangleai/.e2e';
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

// loom: sync, watch the DAG light up, run history appears
await page.click('.tabs button:has-text("Loom")');
await page.waitForSelector('.dag-svg svg', { timeout: 8000 }).catch(() => fail('mermaid svg missing'));
await page.click('button:has-text("sync folder")');
await page.waitForSelector('.node.ok', { timeout: 10000 }).catch(() => fail('no node turned ok'));
await page.waitForSelector('tr.run', { timeout: 8000 }).catch(() => fail('no run row'));
const okNodes = await page.locator('.node.ok').count();
if (okNodes < 5) await fail(`only ${okNodes} ok nodes`);
await page.click('tr.run');
await page.waitForSelector('.run-detail table.events tr', { timeout: 8000 }).catch(() => fail('no run detail events'));
await page.screenshot({ path: `${shots}/loom.png`, fullPage: true });

// memory: units are listed
await page.click('.tabs button:has-text("Memory")');
await page.waitForSelector('.unit', { timeout: 8000 }).catch(() => fail('no memory units'));

// chat: grounded offline answer with citations
await page.click('.tabs button:has-text("Chat")');
await page.fill('.chat-input', 'what port does the demo service listen on?');
await page.click('button.send');
await page.waitForSelector('.msg.assistant:not(.pending)', { timeout: 10000 }).catch(() => fail('no assistant reply'));
const reply = await page.locator('.msg.assistant:not(.pending)').last().innerText();
if (!reply.includes('9090')) await fail(`reply not grounded: ${reply.slice(0, 200)}`);
await page.waitForSelector('.citation', { timeout: 4000 }).catch(() => fail('no citations'));
await page.screenshot({ path: `${shots}/chat.png`, fullPage: true });

const counts = await page.locator('.meta').innerText();
console.log('PASS —', counts, '| reply:', reply.split('\n')[0].slice(0, 80));
await browser.close();
process.exit(0);
