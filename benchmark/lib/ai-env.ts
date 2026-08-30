/**
 * The ONE place an instrument reads its live-model configuration from.
 *
 * Copied as a method from jarenjs's `benchmark/lib/env.js` (BOUNDARY
 * §"Copy the method, not the code"): every live tier in this workspace
 * resolves its provider, models, key and spend guards here — a second
 * reader would mean two ideas of what "no key" means, and the first
 * thing to rot would be the skip path nobody runs.
 *
 * The variables are the repository's own (`.env.example`, and
 * `scripts/live-openrouter-smoke.ts` reads the same names), and what
 * they resolve to is the DESKTOP's settings shape — `ChatSettings` and
 * `EmbedSettings` from `apps/desktop/src/settings.ts` — so the clients
 * a benchmark runs through are built by the same factories the app
 * uses (`chatClientFor`, `embedderFor`), never by a parallel wire.
 *
 * This reads `process.env` and nothing else. `.env` is loaded by Node
 * itself (`node --env-file-if-exists=.env <entry>`): no dotenv here,
 * and there must never be one — CONVENTIONS §1 binds dependencies to
 * `@jarenjs/*`, and a benchmark that needed a package to start would
 * not be reproducible from a clone.
 *
 * The contract every live tier obeys:
 *  - a missing key is NOT a failure. `live` comes back false with a
 *    stated `reason`; the caller prints its keyless tier and exits 0;
 *  - the key is never printed, logged or written to a file — only the
 *    NAME of the variable it came from;
 *  - the spend guards are hard ceilings, not hints. A caller that would
 *    exceed one stops up front with a named reason.
 */

import type { ChatSettings, EmbedSettings, WireProvider } from '../../apps/desktop/src/settings.ts';

/** The variables the live tiers read. */
export const AI_ENV = {
  key: 'OPENROUTER_AI_KEY',
  provider: 'TANGLE_AI_PROVIDER',
  baseUrl: 'TANGLE_AI_BASE_URL',
  model: 'TANGLE_AI_MODEL',
  modelStrong: 'TANGLE_AI_MODEL_STRONG',
  embedModel: 'TANGLE_AI_EMBEDDING_MODEL',
  maxCalls: 'TANGLE_AI_MAX_CALLS',
  maxConcurrency: 'TANGLE_AI_MAX_CONCURRENCY',
} as const;

/** The desktop's provider set; anything else is a stated skip. */
const PROVIDERS: ReadonlySet<string> = new Set<WireProvider>(['ollama', 'openrouter', 'lmstudio', 'custom']);
/** Providers that run on the machine and need no key. */
const LOCAL_PROVIDERS: ReadonlySet<string> = new Set<WireProvider>(['ollama', 'lmstudio']);

/** Spend-guard defaults — deliberately small; `.env` raises them. */
export const GUARD_DEFAULTS = { maxCalls: 200, maxConcurrency: 4 } as const;

export interface AiEnv {
  /** Whether a chat call can be made at all; `reason` says why not. */
  live: boolean;
  reason: string | null;
  provider: WireProvider;
  baseUrl: string | null;
  /** Never printed. `keySource` names the variable instead. */
  apiKey: string | null;
  keySource: string | null;
  model: string;
  /** The judge's model; the answer model when unset. */
  modelStrong: string;
  /** '' when unset — an embedding tier's own skip reason (a chat model is not an embedding model). */
  embedModel: string;
  /** Hard ceiling on requests a run may make — chat AND embedding. */
  maxCalls: number;
  maxConcurrency: number;
}

/** A positive integer, or the default: a typo in `.env` must not take the keyless tier down. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the live-model configuration from the environment. Never throws. */
export function readAiEnv(env: Record<string, string | undefined> = process.env): AiEnv {
  const read = (name: string): string => (env[name] ?? '').trim();
  const apiKey = read(AI_ENV.key);
  const provider = read(AI_ENV.provider) || 'openrouter';
  const baseUrl = read(AI_ENV.baseUrl);
  const model = read(AI_ENV.model);

  let reason: string | null = null;
  if (!PROVIDERS.has(provider)) {
    reason = `unknown provider '${provider}' — ${AI_ENV.provider} is one of ${[...PROVIDERS].join(', ')}`;
  } else if (apiKey === '' && !LOCAL_PROVIDERS.has(provider)) {
    reason = `no key — set ${AI_ENV.key} in .env (see .env.example)`;
  } else if (model === '') {
    reason = `no model — set ${AI_ENV.model} in .env (see .env.example)`;
  } else if (provider === 'custom' && baseUrl === '') {
    reason = `no base URL — a custom provider needs ${AI_ENV.baseUrl}`;
  }

  return {
    live: reason === null,
    reason,
    provider: (PROVIDERS.has(provider) ? provider : 'openrouter') as WireProvider,
    baseUrl: baseUrl === '' ? null : baseUrl,
    apiKey: apiKey === '' ? null : apiKey,
    keySource: apiKey === '' ? null : AI_ENV.key,
    model,
    modelStrong: read(AI_ENV.modelStrong) || model,
    embedModel: read(AI_ENV.embedModel),
    maxCalls: positiveInt(env[AI_ENV.maxCalls], GUARD_DEFAULTS.maxCalls),
    maxConcurrency: positiveInt(env[AI_ENV.maxConcurrency], GUARD_DEFAULTS.maxConcurrency),
  };
}

/** A one-line, key-free summary a run log may print. */
export function describeAiEnv(env: AiEnv): string {
  const key = env.keySource === null ? 'no key' : `key from ${env.keySource}`;
  return `${env.provider} · ${env.model || '(no model)'} · judge ${env.modelStrong || '(no model)'}`
    + ` · embeddings ${env.embedModel || '(none)'} · ${key}`
    + ` · ceilings ${env.maxCalls} requests, ${env.maxConcurrency} concurrent`;
}

/** The chat setting the desktop would hold for this environment, for one model. */
export function chatSettingsOf(env: AiEnv, model: string = env.model): ChatSettings {
  return { provider: env.provider, baseUrl: env.baseUrl, model: model === '' ? null : model, apiKey: env.apiKey };
}

/** The embed setting: the wire when an embedding model is named, else the built-in. */
export function embedSettingsOf(env: AiEnv): EmbedSettings {
  if (env.embedModel === '') return { provider: 'builtin', baseUrl: null, model: null, apiKey: null };
  return { provider: env.provider, baseUrl: env.baseUrl, model: env.embedModel, apiKey: env.apiKey };
}
