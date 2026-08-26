/** Compiled Bun.WebView lifecycle smoke for targets where a Chrome-family engine is installed. */

import { BunWebViewFetcher, DocumentError } from '@tangleai/documents';

const BunGlobal = (globalThis as any).Bun;
if (BunGlobal === undefined) throw new Error('Bun is required');
if (process.env.TANGLE_EXPECT_STANDALONE === '1' && BunGlobal.isStandaloneExecutable !== true) {
  throw new Error('Expected a standalone executable');
}
const fetcher = new BunWebViewFetcher({ allowUnsafeLocalBrowser: true, concurrency: 1 });
const capability = await fetcher.capability();
if (!capability.available) throw new Error(capability.detail);
const rendered = await fetcher.render('https://example.com', { timeoutMs: 15_000 });
if (!rendered.html.includes('Example Domain')) throw new Error('WebView extraction failed');
const controller = new AbortController();
controller.abort();
let aborted = false;
try {
  await fetcher.render('https://example.com', { signal: controller.signal });
} catch (error) {
  aborted = error instanceof DocumentError && error.code === 'browser-aborted';
}
if (!aborted) throw new Error('WebView abort did not return the expected result');
fetcher.close();
BunGlobal.WebView.closeAll();
console.log(JSON.stringify({ ok: true, standalone: BunGlobal.isStandaloneExecutable, mode: rendered.mode, title: rendered.title, aborted }));
