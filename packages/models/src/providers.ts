/**
 * Provider endpoint resolution for OpenAI-compatible chat APIs.
 *
 * The bring-your-own-key reality of browser-side AI is three shapes:
 * a cloud aggregator key (OpenRouter) or a local runtime URL (Ollama,
 * LM Studio). All of them — and every other OpenAI-compatible server —
 * speak the same `/chat/completions` wire format, so one small client
 * covers the lot; the only per-provider knowledge needed is the base
 * URL convention, which lives here.
 *
 * No key ever leaves the caller's hands: resolution turns
 * `{ provider, baseUrl, apiKey, model }` into a base, the chat URL and
 * headers, and hands them back to whoever passed the key. A client keeps
 * those headers in its closure and exposes only the credential-free
 * identity `{ provider, base, url, model, hasKey }`, so a log line, an
 * error report or a debugger dump of a client never carries the key. A
 * base URL carrying credentials of its own is refused, never kept. The
 * base is resolved ONCE and returned, so every sibling endpoint of the
 * family (`/models`, and whatever else hangs off the same base) is
 * composed from it — never re-derived from the chat URL by string surgery.
 */

import { AiError } from './errors.ts';

/**
 * The built-in providers. `custom` accepts any OpenAI-compatible base
 * URL (the caller must supply one). The local runtimes get `/v1`
 * appended automatically when the URL carries no path — pasting
 * `http://localhost:11434` just works.
 *
 * `structured` names the strongest structured-output tier the provider
 * reliably speaks on this wire: `'json_schema'` (schema-constrained
 * decoding), `'json'` (JSON mode without a schema), or `null` (assume
 * nothing — the schema travels in the prompt). Either way the caller
 * validates locally; the tier only decides how much the server helps.
 * @type
 */
export const PROVIDERS: Record<string, {
  label: string;
  baseUrl: string | null;
  local: boolean;
  structured: 'json_schema' | 'json' | null;
}> = {
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, structured: 'json_schema' },
  ollama: { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', local: true, structured: 'json' },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', local: true, structured: 'json_schema' },
  custom: { label: 'OpenAI-compatible', baseUrl: null, local: false, structured: null },
};

/**
 * Resolve a provider configuration into a concrete chat endpoint.
 * @param [options]
 * @returns `base` is the
 *   normalized base URL every endpoint of this wire family hangs off;
 *   `url` is `${base}/chat/completions`
 */
export function resolveEndpoint(options: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  headers?: Record<string, string>;
} = {}): {
  provider: string;
  base: string;
  url: string;
  headers: Record<string, string>;
  model: string;
} {
  const provider = options.provider
    ?? (typeof options.baseUrl === 'string' && options.baseUrl.trim() !== '' ? 'custom' : 'openrouter');
  const preset = PROVIDERS[provider];
  if (preset === undefined)
    throw new AiError('AI0001', `unknown provider '${provider}' (${Object.keys(PROVIDERS).join(', ')})`);

  const configured = (options.baseUrl ?? '').trim();
  const raw = configured === '' ? preset.baseUrl : configured;
  if (raw === null || raw === '')
    throw new AiError('AI0001', `provider '${provider}' needs a baseUrl`);

  const base = normalizeBaseUrl(raw, preset.local);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const apiKey = (options.apiKey ?? '').trim();
  if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`;
  Object.assign(headers, options.headers);

  return { provider, base, url: `${base}/chat/completions`, headers, model: options.model ?? '' };
}

/**
 * Probe a provider before the first turn: can this key/URL answer, and
 * which models does it offer? GETs the OpenAI-compatible `/models`
 * listing (OpenRouter, Ollama and LM Studio all serve it) with the
 * same resolved auth the chat call would use. Never throws — the
 * result object is the settings-UI contract.
 * @param [options]
 */
export async function probeProvider(options: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{
  ok: true;
  models: string[];
} | {
  ok: false;
  status?: number;
  error: string;
}> {

  let endpoint: ReturnType<typeof resolveEndpoint>;
  try {
    endpoint = resolveEndpoint(options);
  }
  catch (err: any) {
    return { ok: false as const, error: (err as Error).message };
  }
  const url = `${endpoint.base}/models`;
  const fetchFn = options.fetch ?? ((u: any, init: any) => globalThis.fetch(u, init));
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: endpoint.headers,
      signal: controller.signal,
    });
    if (response.ok !== true)
      return { ok: false as const, status: response.status, error: `HTTP ${response.status} from ${url}` };
    const payload = await response.json();
    const models = Array.isArray(payload?.data)
      ? payload.data.map((m: any) => m?.id).filter((id: any) => typeof id === 'string')
      : [];
    return { ok: true as const, models };
  }
  catch (err: any) {
    return {
      ok: false as const,
      error: controller.signal.aborted
        ? `no answer from ${url} within ${timeoutMs} ms`
        : (err as any)?.message ?? String(err),
    };
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * The per-token prices a provider's `/models` listing publishes —
 * OpenRouter's `pricing.prompt` and `pricing.completion`, in US dollars per
 * token — keyed by model id, for an agent's cost budget
 * (`prices: (model) => result.prices[model]`). Never throws, like
 * `probeProvider`; a provider that publishes no prices (every local runtime)
 * answers an empty map, and an entry without both prices is left out.
 * @param [options]
 */
export async function probePrices(options: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{
  ok: true;
  prices: Record<string, { prompt: number; completion: number }>;
} | {
  ok: false;
  status?: number;
  error: string;
}> {
  let endpoint: ReturnType<typeof resolveEndpoint>;
  try {
    endpoint = resolveEndpoint(options);
  }
  catch (err: any) {
    return { ok: false as const, error: (err as Error).message };
  }
  const url = `${endpoint.base}/models`;
  const fetchFn = options.fetch ?? ((u: any, init: any) => globalThis.fetch(u, init));
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { method: 'GET', headers: endpoint.headers, signal: controller.signal });
    if (response.ok !== true)
      return { ok: false as const, status: response.status, error: `HTTP ${response.status} from ${url}` };
    const payload = await response.json();
    const prices: Record<string, { prompt: number; completion: number }> = {};
    for (const entry of Array.isArray(payload?.data) ? payload.data : []) {
      const prompt = Number(entry?.pricing?.prompt);
      const completion = Number(entry?.pricing?.completion);
      if (typeof entry?.id === 'string' && entry?.pricing?.prompt != null && entry?.pricing?.completion != null
        && Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0)
        prices[entry.id] = { prompt, completion };
    }
    return { ok: true as const, prices };
  }
  catch (err: any) {
    return {
      ok: false as const,
      error: controller.signal.aborted ? `no answer from ${url} within ${timeoutMs} ms` : (err as any)?.message ?? String(err),
    };
  }
  finally {
    clearTimeout(timer);
  }
}

/**
 * Forgiving base-URL normalization, on the parts of ONE parse: trailing
 * slashes and a pasted `/chat/completions` suffix (in any case) are
 * stripped from the path; local runtimes with a bare origin get their
 * `/v1` prefix. Refused with `AI0001`, at construction rather than on
 * the first call: a scheme other than `http:` or `https:`; a username or
 * password, which `fetch` refuses to send and which would otherwise
 * surface as a retried network error quoting them; and a query string
 * or fragment, because this wire family composes endpoints by appending
 * a path and `…?api-version=x/chat/completions` is a URL nobody meant.
 * No refusal quotes the credentials.
 */
function normalizeBaseUrl(raw: string, local: boolean): string {

  const shown = quotable(raw);
  let url: URL;
  try {
    url = new URL(raw);
  }
  catch {
    throw new AiError('AI0001', `invalid baseUrl '${shown}'`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new AiError('AI0001', `baseUrl '${shown}' must be an http: or https: URL`);
  if (url.username !== '' || url.password !== '')
    throw new AiError('AI0001', `baseUrl '${shown}' must not carry credentials; pass the key as apiKey`);
  if (url.search !== '' || url.hash !== '')
    throw new AiError('AI0001', `baseUrl '${shown}' must not carry a query string or fragment`);
  let path = url.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(path))
    path = path.slice(0, -'/chat/completions'.length).replace(/\/+$/, '');
  if (local && path === '') path = '/v1';
  // with no credentials, no search and no hash, `href` is the origin
  // followed by the path
  return url.href.slice(0, url.href.length - url.pathname.length) + path;
}

/**
 * `raw` without its userinfo (`//user:password@` up to the last `@`
 * before the path) and without the text of its query or fragment, which
 * can carry a key too: what a refusal may quote of a URL the caller
 * pasted. It works on text that does not parse as a URL, which is
 * exactly when such text gets quoted.
 */
function quotable(raw: string): string {
  return raw.replace(/^([^/?#]*\/\/)[^/?#]*@/, '$1').replace(/([?#])[\s\S]*$/, '$1…');
}
