/** One native single-send provider request; an unreceipted dispatch remains explicitly unresolved. */
import { createProviderExecutor } from '@jarenjs/contract/provider';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import type { ResearchExecutionResponse, ResearchExecutorCapability } from '../contracts.gen.ts';
import { researchIssue, type ResearchOutcome } from '../errors.ts';
import { researchValue, researchFail } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { researchExecutionOutcome } from './manifest.ts';
import { RESEARCH_EXECUTOR_CONTRACT, validateResearchExecutionResult, type ResearchExecutor } from './executor.ts';
import { RESEARCH_RUNNER_WIRE_LIMITS, researchExecutionRequest, decodeResearchExecutionRequest } from './wire.ts';

type ProviderOptions = NonNullable<Parameters<typeof createProviderExecutor>[0]>;
export function createRemoteResearchExecutor(options: { endpoint: string; token?: string; fetch: typeof globalThis.fetch;
  now: () => number; sleep: NonNullable<ProviderOptions['sleep']>; requestMs?: number }): ResearchExecutor & { close(): Promise<void> } {
  const endpoint = new URL(options.endpoint), token = options.token, fetch = options.fetch, now = options.now;
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || !loopback && (endpoint.protocol !== 'https:' || !token)) throw new TypeError('Runner endpoint requires HTTP(S), no URL credentials, and authenticated HTTPS outside loopback.');
  const requestMs = options.requestMs ?? 210000;
  if (!Number.isSafeInteger(requestMs) || requestMs < 1 || requestMs > 240000) throw new TypeError('Runner request deadline must be finite and at most four minutes.');
  const provider = createProviderExecutor({ transport: (request, context) => fetch(request.url, { method: request.method,
    headers: { ...request.headers, ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: request.body, signal: context.signal, redirect: 'error' }),
    attempts: 1, concurrency: 1, maxQueue: 8, maxScopes: 1, spacingMs: 0, retryAfter: 'none',
    overallMs: requestMs, attemptMs: requestMs, maxBytes: RESEARCH_RUNNER_WIRE_LIMITS.responseBytes,
    maxRequestBytes: RESEARCH_RUNNER_WIRE_LIMITS.requestBytes, now, sleep: options.sleep, random: () => 0 });
  const unresolved = <T>(reason: string, attempts: number): ResearchOutcome<T> => ({ valid: false, issues: [{
    ...researchIssue('TRSH1008', '/remote', attempts ? 'Runner dispatch has no validated settlement; do not resubmit automatically.' : 'Runner request was not dispatched.'),
    cause: { code: 'research-remote', path: '', detail: reason, state: attempts ? 'unresolved' : 'refused', reason, attempts },
  }] });
  return Object.freeze({ contract: RESEARCH_EXECUTOR_CONTRACT, close: provider.close,
    capability: ({ signal }) => researchExecutionOutcome(async () => {
      const response = await provider.execute({ url: new URL('/capability', endpoint).href, method: 'GET', safety: 'safe-read' },
        { signal, maxBytes: RESEARCH_RUNNER_WIRE_LIMITS.capabilityBytes, deadline: now() + Math.min(5000, requestMs) });
      if (response.state !== 'ok') return { available: false, kind: 'container' as const, engine: null, version: null, imageDigests: [],
        reason: 'Runner capability unavailable: ' + response.reason };
      const capability = researchValue(validateResearchShape<ResearchExecutorCapability>('ResearchExecutorCapability', JSON.parse(response.text)));
      if (capability.kind !== 'container' || capability.available && (!capability.engine || !capability.version || !capability.imageDigests.length)
        || !capability.available && !capability.reason) researchFail('TRSH1007', '/capability', 'Runner capability lacks its qualification or unavailability reason.');
      return capability;
    }),
    run: async (manifest, workspace, context) => {
      const signal = context.signal;
      const admitted = await researchExecutionRequest(manifest, workspace, context);
      if (!admitted.valid) return admitted;
      // Use the same captured archive for transport and independent receipt verification.
      const frozen = researchValue(await decodeResearchExecutionRequest(admitted.value));
      const response = await provider.execute({ url: new URL('/run', endpoint).href, method: 'POST', safety: 'single-send',
        headers: { 'content-type': 'application/json' }, body: canonicalizeJson(admitted.value) }, { signal });
      if (response.state !== 'ok') return unresolved(response.reason, response.attempts);
      let decoded: ResearchExecutionResponse;
      try { decoded = researchValue(validateResearchShape<ResearchExecutionResponse>('ResearchExecutionResponse', JSON.parse(response.text))); }
      catch { return unresolved('invalid-receipt', response.attempts); }
      if (decoded.executionManifestHash !== frozen.manifest.executionManifestHash) return unresolved('receipt-manifest-mismatch', response.attempts);
      if (decoded.settlement === 'unresolved') return unresolved('runner-unresolved', response.attempts);
      if (!decoded.outcome.valid) return decoded.settlement === 'not-started' ? decoded.outcome : unresolved('invalid-refusal-settlement', response.attempts);
      if (decoded.settlement !== 'settled') return unresolved('invalid-success-settlement', response.attempts);
      const result = await validateResearchExecutionResult({ run: decoded.outcome.value.run,
        artifacts: decoded.outcome.value.artifacts.map(row => ({ artifactId: row.artifactId, bytes: new Uint8Array(row.bytes) })) }, frozen.manifest, frozen.workspace, frozen);
      if (!result.valid || result.value.run.isolation?.kind !== 'container') return unresolved('invalid-execution-evidence', response.attempts);
      return result;
    },
  } satisfies ResearchExecutor & { close(): Promise<void> });
}
