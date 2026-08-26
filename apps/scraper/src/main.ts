/** Optional localhost Playwright renderer. Run it inside the pinned distrobox/container. */

import { chromium, type Browser } from 'playwright-core';
import { assertPublicUrl, DocumentError } from '@tangleai/documents';

const BunGlobal = (globalThis as any).Bun;
if (BunGlobal === undefined) throw new Error('The optional scraper must run under Bun 1.4+');
const [bunMajor, bunMinor] = String(BunGlobal.version).split('.').map(Number);
if (bunMajor < 1 || (bunMajor === 1 && bunMinor < 4)) throw new Error(`Bun 1.4+ is required; found ${BunGlobal.version}`);

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

const port = boundedInteger(process.env.TANGLE_SCRAPER_PORT, 4720, 1, 65_535);
const hostname = process.env.TANGLE_SCRAPER_HOST ?? '127.0.0.1';
const token = process.env.TANGLE_SCRAPER_TOKEN?.trim() || undefined;
const maximumJobs = boundedInteger(process.env.TANGLE_SCRAPER_CONCURRENCY, 2, 1, 16);
const maximumQueuedJobs = boundedInteger(process.env.TANGLE_SCRAPER_QUEUE, 16, 0, 256);
const maximumBytes = boundedInteger(process.env.TANGLE_SCRAPER_MAX_BYTES, 24 * 1024 * 1024, 1024, 512 * 1024 * 1024);
const executablePath = process.env.TANGLE_CHROME_PATH;

if (!['127.0.0.1', 'localhost', '::1'].includes(hostname) && token === undefined) {
  throw new Error('TANGLE_SCRAPER_TOKEN is required when the renderer binds a non-loopback address');
}

let browserPromise: Promise<Browser> | undefined;
let active = 0;
const waiting: Array<() => void> = [];

async function browser(): Promise<Browser> {
  browserPromise ??= chromium.launch({ executablePath, headless: true }).catch((error) => {
    browserPromise = undefined;
    throw error;
  });
  return browserPromise;
}

async function queued<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (active >= maximumJobs) {
    if (waiting.length >= maximumQueuedJobs) throw new DocumentError('browser-busy', 'Renderer queue is full');
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DocumentError('browser-aborted', 'Browser request was aborted while queued'));
        return;
      }
      const resume = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const index = waiting.indexOf(resume);
        if (index >= 0) waiting.splice(index, 1);
        reject(new DocumentError('browser-aborted', 'Browser request was aborted while queued'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiting.push(resume);
    });
  }
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function authorized(request: Request): boolean {
  return token === undefined || request.headers.get('authorization') === `Bearer ${token}`;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

async function render(urlInput: string, timeoutMs: number, requestSignal?: AbortSignal): Promise<Record<string, unknown>> {
  const url = await assertPublicUrl(urlInput);
  return queued(async () => {
    const instance = await browser();
    const context = await instance.newContext({
      acceptDownloads: false,
      serviceWorkers: 'block',
      userAgent: 'TangleAI-Renderer/0.1',
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    let transferred = 0;
    let budgetExceeded = false;
    let timedOut = false;
    let clientAborted = false;
    const abort = new AbortController();
    const effectiveTimeout = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(timeoutMs, 60_000)) : 20_000;
    const timeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, effectiveTimeout);
    const onClientAbort = (): void => {
      clientAborted = true;
      abort.abort();
    };
    requestSignal?.addEventListener('abort', onClientAbort, { once: true });
    try {
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (['image', 'media', 'font'].includes(request.resourceType())) {
          await route.abort('blockedbyclient');
          return;
        }
        try {
          const target = new URL(request.url());
          if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            if (target.protocol === 'data:' || target.protocol === 'blob:') await route.continue();
            else await route.abort('blockedbyclient');
            return;
          }
          await assertPublicUrl(target.toString());
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      cdp.on('Network.dataReceived', (event: { encodedDataLength?: number; dataLength: number }) => {
        transferred += event.encodedDataLength ?? event.dataLength;
        if (transferred > maximumBytes) {
          budgetExceeded = true;
          abort.abort();
        }
      });
      abort.signal.addEventListener('abort', () => void page.close().catch(() => {}), { once: true });
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: effectiveTimeout });
      } catch (error) {
        if (budgetExceeded) throw new DocumentError('browser-budget', 'Browser transfer budget exceeded');
        if (clientAborted) throw new DocumentError('browser-aborted', 'Browser render was aborted');
        if (timedOut) throw new DocumentError('browser-budget', 'Browser render timed out');
        throw error;
      }
      await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => {});
      if (budgetExceeded) throw new DocumentError('browser-budget', 'Browser transfer budget exceeded');
      if (clientAborted) throw new DocumentError('browser-aborted', 'Browser render was aborted');
      if (timedOut) throw new DocumentError('browser-budget', 'Browser render timed out');
      const html = await page.content();
      if (Buffer.byteLength(html) > maximumBytes) throw new DocumentError('browser-budget', 'Rendered HTML exceeds the document byte budget');
      const finalUrl = await assertPublicUrl(page.url());
      return { html, finalUrl, title: await page.title() };
    } finally {
      clearTimeout(timeout);
      requestSignal?.removeEventListener('abort', onClientAbort);
      await cdp.detach().catch(() => {});
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    }
  }, requestSignal);
}

async function jsonBody(request: Request, limit = 16 * 1024): Promise<unknown> {
  if (request.body === null) throw new DocumentError('bad-request', 'JSON body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > limit) {
        await reader.cancel('renderer request body too large');
        throw new DocumentError('bad-request', 'Renderer request body is too large');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    throw new DocumentError('bad-request', 'Renderer request body is not valid JSON');
  }
}

const server = BunGlobal.serve({
  hostname,
  port,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!authorized(request)) return json({ code: 'unauthorized', error: 'Invalid renderer token' }, 401);
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, runtime: `bun/${BunGlobal.version}`, playwright: '1.62.1', active });
    }
    if (request.method !== 'POST' || url.pathname !== '/render') return json({ code: 'not-found', error: 'Not found' }, 404);
    try {
      const body = await jsonBody(request) as any;
      if (typeof body.url !== 'string') return json({ code: 'bad-request', error: 'url is required' }, 400);
      return json(await render(body.url, Number(body.timeoutMs ?? 20_000), request.signal));
    } catch (error) {
      const code = error instanceof DocumentError ? error.code : 'browser-failed';
      const status = code === 'bad-request' ? 400 : code === 'browser-busy' ? 429 : code.startsWith('blocked') ? 403 : 502;
      return json({ code, error: error instanceof Error ? error.message : String(error) }, status);
    }
  },
});

console.log(`Tangle renderer listening on http://${hostname}:${server.port}`);

async function close(): Promise<void> {
  server.stop();
  const pending = browserPromise;
  browserPromise = undefined;
  if (pending !== undefined) {
    try {
      await (await pending).close();
    } catch {
      // A failed launch has no process to close.
    }
  }
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
