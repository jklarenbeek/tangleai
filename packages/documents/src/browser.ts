import { DocumentError, type FetchMode } from './contracts.ts';
import { assertPublicUrl, normalizeUrl, type UrlPolicyOptions } from './url-policy.ts';

export interface RenderedDocument {
  html: string;
  finalUrl: string;
  title: string | null;
  mode: Exclude<FetchMode, 'static'>;
}

export interface BrowserCapability {
  mode: 'unavailable' | 'bun-webview' | 'remote-playwright';
  available: boolean;
  safeForUntrusted: boolean;
  detail: string;
}

export interface BrowserFetcher {
  capability(): Promise<BrowserCapability>;
  render(url: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<RenderedDocument>;
  close?(): Promise<void> | void;
}

export class UnavailableBrowserFetcher implements BrowserFetcher {
  private readonly detail: string;

  constructor(detail = 'No dynamic renderer is configured') {
    this.detail = detail;
  }

  async capability(): Promise<BrowserCapability> {
    return { mode: 'unavailable', available: false, safeForUntrusted: false, detail: this.detail };
  }

  async render(): Promise<RenderedDocument> {
    throw new DocumentError('dynamic-unavailable', this.detail);
  }
}

class Queue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly maximum: number;

  constructor(maximum: number) {
    this.maximum = maximum;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

function bunAtLeast14(): boolean {
  const version = process.versions.bun;
  if (version === undefined) return false;
  const [major, minor] = version.split('.').map(Number);
  return major > 1 || (major === 1 && minor >= 4);
}

export interface BunWebViewOptions extends UrlPolicyOptions {
  /** WebView cannot preflight every subresource. It stays opt-in for trusted pages. */
  allowUnsafeLocalBrowser?: boolean;
  concurrency?: number;
  chromePath?: string;
}

/** Optional compiled-desktop adapter. Every job gets an ephemeral, always-closed view. */
export class BunWebViewFetcher implements BrowserFetcher {
  private readonly options: BunWebViewOptions;
  private readonly queue: Queue;
  private readonly views = new Set<any>();

  constructor(options: BunWebViewOptions = {}) {
    this.options = options;
    this.queue = new Queue(Math.max(1, options.concurrency ?? 2));
  }

  async capability(): Promise<BrowserCapability> {
    const BunGlobal = (globalThis as any).Bun;
    if (!bunAtLeast14() || typeof BunGlobal?.WebView !== 'function') {
      return { mode: 'bun-webview', available: false, safeForUntrusted: false, detail: 'Bun 1.4+ WebView is not available in this runtime' };
    }
    if (this.options.allowUnsafeLocalBrowser !== true) {
      return { mode: 'bun-webview', available: false, safeForUntrusted: false, detail: 'Local WebView is disabled because subresource network policy cannot be guaranteed' };
    }
    return { mode: 'bun-webview', available: true, safeForUntrusted: false, detail: 'Experimental Bun WebView available for explicitly trusted pages' };
  }

  async render(urlInput: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RenderedDocument> {
    if (options.signal?.aborted) throw new DocumentError('browser-aborted', 'Dynamic rendering was aborted');
    const capability = await this.capability();
    if (!capability.available) throw new DocumentError('dynamic-unavailable', capability.detail);
    const url = await assertPublicUrl(urlInput, this.options);
    return this.queue.run(async () => {
      const BunGlobal = (globalThis as any).Bun;
      const backend = this.options.chromePath === undefined
        ? 'chrome'
        : { type: 'chrome', path: this.options.chromePath, url: false, argv: [], stdout: 'ignore', stderr: 'ignore' };
      const view = new BunGlobal.WebView({ backend, headless: true, dataStore: 'ephemeral', width: 1280, height: 800 });
      this.views.add(view);
      const timeoutMs = options.timeoutMs ?? 20_000;
      const timeout = setTimeout(() => view.close(), timeoutMs);
      const abort = (): void => view.close();
      options.signal?.addEventListener('abort', abort, { once: true });
      try {
        await view.navigate(url);
        const finalUrl = normalizeUrl(String(view.url));
        await assertPublicUrl(finalUrl, this.options);
        const html = await view.evaluate('document.documentElement.outerHTML');
        if (typeof html !== 'string') throw new DocumentError('browser-extract-failed', 'WebView did not return document HTML');
        return { html, finalUrl, title: typeof view.title === 'string' && view.title !== '' ? view.title : null, mode: 'bun-webview' };
      } catch (error) {
        if (options.signal?.aborted) throw new DocumentError('browser-aborted', 'Dynamic rendering was aborted');
        if (error instanceof DocumentError) throw error;
        throw new DocumentError('browser-failed', error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
        view.close();
        this.views.delete(view);
      }
    });
  }

  close(): void {
    for (const view of this.views) view.close();
    this.views.clear();
  }
}

export interface RemoteBrowserOptions extends UrlPolicyOptions {
  endpoint: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
}

export class RemoteBrowserFetcher implements BrowserFetcher {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly options: RemoteBrowserOptions;

  constructor(options: RemoteBrowserOptions) {
    this.options = options;
    this.endpoint = new URL('/render', options.endpoint).toString();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async capability(): Promise<BrowserCapability> {
    try {
      const response = await this.fetchImpl(new URL('/health', this.options.endpoint), {
        headers: this.options.token === undefined ? {} : { authorization: `Bearer ${this.options.token}` },
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok
        ? { mode: 'remote-playwright', available: true, safeForUntrusted: true, detail: 'Isolated Playwright renderer reachable' }
        : { mode: 'remote-playwright', available: false, safeForUntrusted: true, detail: `Renderer health returned HTTP ${response.status}` };
    } catch (error) {
      return { mode: 'remote-playwright', available: false, safeForUntrusted: true, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async render(urlInput: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RenderedDocument> {
    const url = await assertPublicUrl(urlInput, this.options);
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.options.token === undefined ? {} : { authorization: `Bearer ${this.options.token}` }),
      },
      body: JSON.stringify({ url, timeoutMs: options.timeoutMs ?? 20_000 }),
      signal: options.signal,
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new DocumentError(payload.code ?? 'browser-failed', payload.error ?? `Renderer returned HTTP ${response.status}`);
    if (typeof payload.html !== 'string' || typeof payload.finalUrl !== 'string') {
      throw new DocumentError('browser-failed', 'Renderer returned an invalid payload');
    }
    const finalUrl = await assertPublicUrl(payload.finalUrl, this.options);
    return {
      html: payload.html,
      finalUrl: normalizeUrl(finalUrl),
      title: typeof payload.title === 'string' ? payload.title : null,
      mode: 'remote-playwright',
    };
  }
}

export function likelyDynamicShell(html: string, usefulChars: number, minimum = 160): boolean {
  if (usefulChars >= minimum) return false;
  const scripts = (html.match(/<script\b/gi) ?? []).length;
  const markers = /(?:__next|__nuxt|data-reactroot|ng-version|id=["'](?:app|root)["'])/i.test(html);
  return scripts >= 2 || markers;
}
