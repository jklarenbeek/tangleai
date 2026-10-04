/** Authenticated bounded HTTP admission; the backend alone owns effects and containers. */
import { createScheduler } from '@jarenjs/core/schedule';
import { readBoundedResponseBytes } from '@tangleai/documents/fetch';
import { decodeResearchExecutionRequest, researchExecutionResponse, RESEARCH_RUNNER_WIRE_LIMITS,
  researchRefuse, researchIssue, type ResearchExecutionResponse, type ResearchExecutorCapability,
  type ExecutionManifest, type ResearchWorkspace, type ResearchContract, type ExperimentPlan } from '@tangleai/research';

export interface ResearchRunnerRequest { manifest: ExecutionManifest; workspace: ResearchWorkspace; contract: ResearchContract; plan: ExperimentPlan }
export interface ResearchRunnerBackend {
  capability(signal: AbortSignal): Promise<ResearchExecutorCapability>;
  run(request: ResearchRunnerRequest, signal: AbortSignal): Promise<ResearchExecutionResponse>;
}
export function createResearchRunner(options: { hostname: string; token?: string; imageDigests: readonly string[];
  backend: ResearchRunnerBackend; now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  timeoutSignal: (ms: number) => AbortSignal }) {
  const token = options.token, backend = options.backend, now = options.now, images = new Set(options.imageDigests);
  if (!['127.0.0.1', 'localhost', '::1'].includes(options.hostname) && !token) throw new TypeError('A non-loopback research runner requires a token.');
  if (!images.size || [...images].some(value => !/^sha256:[0-9a-f]{64}$/.test(value))) throw new TypeError('Runner images must be digest-pinned.');
  const scheduler = createScheduler({ concurrency: 1, maxQueue: 8, maxScopes: 1, now, sleep: options.sleep });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  return {
    close: scheduler.close,
    async fetch(request: Request): Promise<Response> {
      if (token && request.headers.get('authorization') !== 'Bearer ' + token) return json({ error: 'Invalid runner token.' }, 401);
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/capability') {
        const signal = AbortSignal.any([request.signal, options.timeoutSignal(5000)]);
        try { return json(await scheduler.run(() => backend.capability(signal), { signal, deadline: now() + 5000 })); }
        catch (cause) { return json({ available: false, kind: 'container', engine: null, version: null, imageDigests: [],
          reason: 'Capability probe did not settle: ' + (cause instanceof Error ? cause.message : String(cause)) }); }
      }
      if (request.method !== 'POST' || path !== '/run') return json({ error: 'Unknown runner operation.' }, 404);
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'Expected application/json.' }, 415);
      try {
        return await scheduler.run(async () => {
          const bodySignal = AbortSignal.any([request.signal, options.timeoutSignal(10000)]);
          const bytes = await readBoundedResponseBytes(new Response(request.body), RESEARCH_RUNNER_WIRE_LIMITS.requestBytes, () => {}, bodySignal);
          const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          const decoded = await decodeResearchExecutionRequest(body);
          const hash = body?.manifest?.executionManifestHash;
          if (!/^[0-9a-f]{64}$/.test(hash ?? '')) return json(researchRefuse('TRSH1001', '/executionManifestHash', 'Request requires a content identity.'), 400);
          if (!decoded.valid) return json(researchExecutionResponse(hash, decoded));
          if (!images.has(decoded.value.manifest.imageDigest)) return json(researchExecutionResponse(hash,
            researchRefuse('TRSH1007', '/imageDigest', 'Image digest is outside the host qualification.')));
          if (decoded.value.manifest.network.setup !== 'off') return json(researchExecutionResponse(hash,
            researchRefuse('TRSH1010', '/network/setup', 'This host supports network-free setup only.')));
          return json(await backend.run(decoded.value, request.signal));
        }, { signal: request.signal, deadline: now() + 240000 });
      } catch (cause) {
        if (request.body && !request.body.locked) {
          try { await request.body.cancel(cause); }
          catch (cancelCause) { cause = new AggregateError([cause, cancelCause], 'Runner request and body cancellation failed.'); }
        }
        return json({ valid: false, issues: [researchIssue('TRSH1008', '/request', 'Runner request could not be admitted or settled.', cause)] }, 400);
      }
    },
  };
}
