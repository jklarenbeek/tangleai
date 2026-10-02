/** Credential-free authorization preflight for the frozen paper-profile state. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { readAiEnv, describeAiEnv, type AiEnv } from './ai-env.ts';
import { loadTradingPaperProfile } from './trading-paper.ts';
import { WIRE_CACHE_PATH } from './wire-cache.ts';
import { tradingSource } from './trading-report.ts';

export async function planTradingLive(options: { env?: AiEnv; cache?: string; fresh?: boolean } = {}) {
  const env = options.env ?? readAiEnv(), registration = await loadTradingPaperProfile();
  // No requests exist without a corpus. In particular, an unrelated paid cache row is never a hit.
  const payload = { instrument: 'trading-live' as const, profile: 'paper' as const, registrationSha256: await canonicalSha256(registration),
    sourceSha256: (await tradingSource()).sha256, manifestId: null, reason: registration.reason, environment: describeAiEnv(env),
    ceilings: { calls: env.maxCalls, concurrency: env.maxConcurrency },
    cache: { path: options.cache ?? WIRE_CACHE_PATH, fresh: options.fresh ?? false, eligibleKeys: [] as string[], hits: 0, misses: 0 },
    roles: ['analyst', 'research', 'trader', 'risk', 'fund-manager'].map(role => ({ role, decisions: 0, maximumFreshCalls: 0, exactCacheHits: 0 })),
    maximumFreshCalls: 0, exactCacheHits: 0, cases: [] as string[] };
  return { ...payload, planId: await canonicalSha256(payload) };
}
export async function runTradingLive(options: { env?: AiEnv; cache?: string; fresh?: boolean; authorize?: string } = {}) {
  const env = options.env ?? readAiEnv(), plan = await planTradingLive({ ...options, env });
  if (options.authorize !== undefined && options.authorize !== plan.planId) throw Error('Trading authorization does not match the frozen planId');
  return { plan, status: options.authorize === undefined ? 'dry-plan' as const : 'skipped' as const,
    reason: !env.live ? env.reason : plan.reason, corpusReason: plan.reason, fresh: 0, replayed: 0 };
}
