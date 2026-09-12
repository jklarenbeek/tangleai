/**
 * The ONE place an instrument reads its live-model configuration from.
 *
 * Copied as a method from jarenjs's `benchmark/lib/env.ts` (BOUNDARY
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
 * Provider vocabulary and endpoint rules are the suite's: `PROVIDERS`
 * says which wires exist and which are local, and `resolveEndpoint` is
 * the only authority on whether a base resolves — this file keeps no
 * default-endpoint rule of its own. The spend guards are normalized
 * through the schema normalizer and then validated, so `'7'` is the
 * explicit integer 7, an absent variable is the recorded default, and
 * `'4x'`, `'2.5'`, zero or a negative is a RECORDED rejection that
 * falls back — never a partial parse that looks explicit.
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

import { PROVIDERS, resolveEndpoint } from '@tangleai/models/providers';
import { JarenValidator } from '@jarenjs/validate';
import { compileNormalizer } from '@jarenjs/validate/normalize';
import { resolveProfile, type HostManifest, type ProfileRequest, type RunIdentity } from '@tangleai/config';

import type { ChatSettings, EmbedSettings, WireProvider } from '../../apps/desktop/src/settings.ts';
import { buildHostManifest, normalizedWireBase, productionRegistry } from '../../apps/desktop/src/ai-host.ts';

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

/** Spend-guard defaults — deliberately small; `.env` raises them. */
export const GUARD_DEFAULTS = { maxCalls: 200, maxConcurrency: 4 } as const;

/** How a guard value was obtained — explicit, defaulted, or rejected-and-defaulted. */
export type GuardState = 'explicit' | 'defaulted' | 'rejected';

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
  /** Where each guard value came from. A rejection is a value, never a silent default. */
  guards: { maxCalls: GuardState, maxConcurrency: GuardState };
  /** One line per rejected guard, naming the variable and the raw value's shape problem. */
  guardIssues: string[];
}

const GUARD_SCHEMA = {
  type: 'object',
  properties: {
    maxCalls: { type: 'integer', minimum: 1, default: GUARD_DEFAULTS.maxCalls },
    maxConcurrency: { type: 'integer', minimum: 1, default: GUARD_DEFAULTS.maxConcurrency },
  },
} as const;

const normalizeGuards = compileNormalizer(GUARD_SCHEMA as unknown as Record<string, unknown>, {
  useDefaults: true,
  coerceTypes: true,
  trimStrings: true,
});
const validateGuards = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' })
  .compile(GUARD_SCHEMA as unknown as Record<string, unknown>);

interface GuardOutcome {
  value: number;
  state: GuardState;
  issue: string | null;
}

/** Whether a base URL smuggles a credential as userinfo. */
function carriesUserinfo(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.username !== '' || url.password !== '';
  } catch {
    return false; // an unparsable base fails endpoint resolution with its own reason
  }
}

/** One guard: normalized, validated, and honest about where it came from. */
function guardOf(name: 'maxCalls' | 'maxConcurrency', variable: string, raw: string | undefined): GuardOutcome {
  if (raw === undefined || raw.trim() === '') {
    return { value: GUARD_DEFAULTS[name], state: 'defaulted', issue: null };
  }
  const shaped = normalizeGuards({ [name]: raw }) as Record<string, unknown>;
  const outcome = validateGuards({ [name]: shaped[name] }) as { valid: boolean };
  if (!outcome.valid) {
    return {
      value: GUARD_DEFAULTS[name],
      state: 'rejected',
      issue: `${variable}='${raw}' is not a whole positive integer; the default ${GUARD_DEFAULTS[name]} stands`,
    };
  }
  return { value: shaped[name] as number, state: 'explicit', issue: null };
}

/** Resolve the live-model configuration from the environment. Never throws. */
export function readAiEnv(env: Record<string, string | undefined> = process.env): AiEnv {
  const read = (name: string): string => (env[name] ?? '').trim();
  const apiKey = read(AI_ENV.key);
  const provider = read(AI_ENV.provider) || 'openrouter';
  const baseUrl = read(AI_ENV.baseUrl);
  const model = read(AI_ENV.model);

  const known = provider in PROVIDERS;
  const local = known && PROVIDERS[provider].local;
  let reason: string | null = null;
  if (!known) {
    reason = `unknown provider '${provider}' — ${AI_ENV.provider} is one of ${Object.keys(PROVIDERS).sort().join(', ')}`;
  } else if (apiKey === '' && !local) {
    reason = `no key — set ${AI_ENV.key} in .env (see .env.example)`;
  } else if (model === '') {
    reason = `no model — set ${AI_ENV.model} in .env (see .env.example)`;
  } else if (baseUrl !== '' && carriesUserinfo(baseUrl)) {
    // host policy, checked BEFORE the suite: a credential-bearing base
    // must never reach normalization, a manifest or a replay key
    reason = `${AI_ENV.baseUrl} carries URL userinfo; a credential travels in ${AI_ENV.key}, never in a base URL`;
  } else {
    try {
      resolveEndpoint({ provider, baseUrl: baseUrl === '' ? undefined : baseUrl, model });
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  const maxCalls = guardOf('maxCalls', AI_ENV.maxCalls, env[AI_ENV.maxCalls]);
  const maxConcurrency = guardOf('maxConcurrency', AI_ENV.maxConcurrency, env[AI_ENV.maxConcurrency]);

  return {
    live: reason === null,
    reason,
    provider: (known ? provider : 'openrouter') as WireProvider,
    baseUrl: baseUrl === '' ? null : baseUrl,
    apiKey: apiKey === '' ? null : apiKey,
    keySource: apiKey === '' ? null : AI_ENV.key,
    model,
    modelStrong: read(AI_ENV.modelStrong) || model,
    embedModel: read(AI_ENV.embedModel),
    maxCalls: maxCalls.value,
    maxConcurrency: maxConcurrency.value,
    guards: { maxCalls: maxCalls.state, maxConcurrency: maxConcurrency.state },
    guardIssues: [maxCalls.issue, maxConcurrency.issue].filter((issue): issue is string => issue !== null),
  };
}

/** A one-line, key-free summary a run log may print. */
export function describeAiEnv(env: AiEnv): string {
  const key = env.keySource === null ? 'no key' : `key from ${env.keySource}`;
  const rejected = env.guardIssues.length === 0 ? '' : ` · ${env.guardIssues.length} guard value(s) rejected`;
  return `${env.provider} · ${env.model || '(no model)'} · judge ${env.modelStrong || '(no model)'}`
    + ` · embeddings ${env.embedModel || '(none)'} · ${key}`
    + ` · ceilings ${env.maxCalls} requests, ${env.maxConcurrency} concurrent${rejected}`;
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

// ---------------------------------------------------------------------------
// the env wires, projected through the one host adapter
// ---------------------------------------------------------------------------

/**
 * Resolve the environment's wires into the credential-free run identity
 * a live report must carry. The projection is the same generated legacy
 * request the desktop uses — the environment is just the second thin
 * reader feeding the same input schema — and a refusal THROWS, because
 * the caller is a live path that must stop rather than spend under an
 * unresolved identity.
 */
export async function envConfigIdentity(
  env: AiEnv,
  observed: { model: string, dims: number } | null,
  sourceClass: HostManifest['sourceClass'] = 'environment',
): Promise<RunIdentity> {
  const slot = env.apiKey !== null ? 'openrouter-primary' : null;
  const base = normalizedWireBase(env.provider, env.baseUrl);
  const proven = observed !== null && observed.dims > 0;
  const request: ProfileRequest = {
    kind: 'legacy',
    chat: env.model === ''
      ? { state: 'incomplete', requested: { provider: env.provider, baseUrl: env.baseUrl, model: null }, missing: ['model'] }
      : { state: 'configured', provider: env.provider, baseUrl: base, model: env.model, credentialSlot: slot },
    embed: env.embedModel === ''
      ? { state: 'unconfigured' }
      : proven
        ? { state: 'configured', provider: env.provider, baseUrl: base, model: env.embedModel, credentialSlot: slot }
        : { state: 'configured-unproven', provider: env.provider, baseUrl: base, model: env.embedModel, credentialSlot: slot },
    components: { policy: null, ranker: null },
    chatPrompt: null,
  };
  const built = await buildHostManifest({
    sourceClass,
    wires: [{ provider: env.provider, baseUrl: env.baseUrl, path: '/chat/baseUrl' }],
    slots: [{ name: 'openrouter-primary', configured: env.apiKey !== null, source: AI_ENV.key }],
    wireEmbeddings: env.embedModel === '' || !proven
      ? []
      : [{ provider: env.provider, baseUrl: env.baseUrl, model: env.embedModel, dims: observed.dims }],
    budget: { maxCalls: env.maxCalls, maxTokens: null, maxMs: null, maxConcurrency: env.maxConcurrency },
  });
  if (!built.ok) {
    throw new Error(`the environment's wires refuse a manifest: ${built.issues.map((issue) => `${issue.code} ${issue.path}`).join('; ')}`);
  }
  const resolution = await resolveProfile({ registry: productionRegistry, request, host: built.manifest });
  if (!resolution.ok) {
    throw new Error(`the environment's wires refuse an identity: ${resolution.issues.map((issue) => `${issue.code} ${issue.path}`).join('; ')}`);
  }
  return resolution.identity;
}
