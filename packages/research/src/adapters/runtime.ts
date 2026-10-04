import { createProviderExecutor, compileProvider, providerReplayKey } from '@jarenjs/contract/provider';
import type { createAttemptBudget } from '@jarenjs/core/retry';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { readBoundedResponseBytes } from '@tangleai/documents/fetch';
import type { DiscoveryQuery, DiscoveryQueryOutcome, LiteratureRecord, DiscoveryCandidate, ResearchLicence, ResearchIssue } from '../contracts.gen.ts';
import { immutableResearchJson, researchArtifactIdOf } from '../identity.ts';
import { ResearchFailure, researchValue } from '../workflow-contract.ts';
import { validateResearchShape } from '../schema.ts';
import { researchIssue } from '../errors.ts';
import { normalizeLiterature, type ScholarlyMetadata, type ScholarlyProvider } from './normalize.ts';

type ExecutorOptions = NonNullable<Parameters<typeof createProviderExecutor>[0]>;
export type ResearchTransport = NonNullable<ExecutorOptions['transport']>;
export interface ResearchProviderHost {
  transport: ResearchTransport;
  now: () => number;
  sleep: NonNullable<ExecutorOptions['sleep']>;
  random: () => number;
  attempts: number;
  overallMs: number;
  attemptMs: number;
  /** arXiv live hosts must supply at least the provider's documented spacing. */
  spacingMs: number;
  licence: ResearchLicence;
}
export interface ResearchByteBudget { remaining: number; consumed: number }
export interface ResearchAdapterContext {
  signal: AbortSignal;
  budget: ReturnType<typeof createAttemptBudget>;
  bytes: ResearchByteBudget;
  /** Shared native scheduler across a discovery plan's concurrent queries. */
  dispatcher?: ResearchProviderDispatcher;
}
type Executor = ReturnType<typeof createProviderExecutor>;
interface ResearchProviderDispatcher {
  execute(request: Parameters<Executor['execute']>[0], context: Parameters<Executor['execute']>[1], capture: ResearchTransport): ReturnType<Executor['execute']>;
  close: Executor['close'];
  stats: Executor['stats'];
}
/** A transport route, not another scheduler: the sole executor owns all scopes and retries. */
export function createResearchProviderDispatcher(host: ResearchProviderHost, limits: { concurrency: number; bytes: number }): ResearchProviderDispatcher {
  const routes = new Map<string, ResearchTransport>();
  const keyOf = (request: Parameters<Executor['execute']>[0]) => providerReplayKey(request, { scope: 'research-provider-dispatch-v1' });
  const executor = createProviderExecutor({ transport: async (request, context) => {
    const capture = routes.get(await keyOf(request));
    if (!capture) throw new TypeError('Unregistered discovery request route.');
    return capture(request, context);
  }, attempts: host.attempts, overallMs: host.overallMs, attemptMs: host.attemptMs,
  maxBytes: limits.bytes, concurrency: limits.concurrency, maxQueue: 64, spacingMs: host.spacingMs,
  now: host.now, sleep: host.sleep, random: host.random });
  return { async execute(request, context, capture) {
    const key = await keyOf(request);
    if (routes.has(key)) throw new TypeError('Concurrent duplicate discovery request.');
    routes.set(key, capture);
    try { return await executor.execute(request, context); } finally { routes.delete(key); }
  }, close: executor.close, stats: executor.stats };
}
export interface ResearchAdapterArtifact { bytes: Uint8Array; mediaType: string }
export interface ScholarlyResult {
  records: LiteratureRecord[];
  candidates: DiscoveryCandidate[];
  outcome: DiscoveryQueryOutcome;
  artifacts: ResearchAdapterArtifact[];
}
interface Capture { url: string; status: number | null; headers: Record<string, string>; hash: string | null; reason: string | null }
interface ProviderFinish {
  state: DiscoveryQueryOutcome['state']; reason: string; attempts: number; rows: number;
  malformed: number; observations: unknown; records?: LiteratureRecord[]; candidates?: DiscoveryCandidate[]; issues?: ResearchIssue[];
}
interface ProviderRuntime {
  executor: ReturnType<typeof createProviderExecutor>;
  executeContext: { signal: AbortSignal; budget: ReturnType<typeof createAttemptBudget>; beforeDispatch: () => boolean };
  transport: ResearchTransport;
  artifacts: ResearchAdapterArtifact[];
  captures: Capture[];
  finish(input: ProviderFinish): Promise<ScholarlyResult>;
}
export function adapterInputs(provider: DiscoveryQuery['provider'], input: DiscoveryQuery, options: ResearchProviderHost) {
  const query = researchValue(validateResearchShape<DiscoveryQuery>('DiscoveryQuery', input));
  if (query.provider !== provider) throw new TypeError('Scholarly query uses another adapter.');
  return { query, host: { ...options, licence: researchValue(validateResearchShape<ResearchLicence>('ResearchLicence', options.licence)) } };
}
export const jsonArtifact = (value: unknown): ResearchAdapterArtifact => ({
  bytes: new TextEncoder().encode(canonicalizeJson(value)), mediaType: 'application/json' });

/** Native attempts own retries and cancellation; capture only accounts and retains bytes. */
export function providerRuntime(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext): ProviderRuntime {
  const captures: Capture[] = [], artifacts: ResearchAdapterArtifact[] = [];
  let queryBytes = 0;
  const transport: ResearchTransport = async (request, attempt) => {
    let status: number | null = null, headers: Record<string, string> = {};
    try {
      const response = await host.transport(request, attempt); status = response.status;
      headers = Object.fromEntries(['content-type', 'retry-after', 'etag', 'last-modified']
        .flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)!]] : []));
      const bytes = await readBoundedResponseBytes(response, Math.max(0, Math.min(query.bytes - queryBytes, context.bytes.remaining)), count => {
        queryBytes += count; context.bytes.consumed += count; context.bytes.remaining -= count;
        if (context.bytes.remaining < 0 || queryBytes > query.bytes) throw new Error('Discovery byte budget exhausted.');
      }, attempt.signal);
      const hash = (await researchArtifactIdOf(bytes)).slice(4);
      attempt.signal.throwIfAborted();
      captures.push({ url: request.url, status, headers, hash, reason: null });
      artifacts.push({ bytes, mediaType: headers['content-type']?.split(';')[0] || 'application/octet-stream' });
      return new Response([204, 205, 304].includes(status) ? null : new Uint8Array(bytes), { status, headers });
    } catch (cause) {
      captures.push({ url: request.url, status, headers, hash: null,
        reason: cause instanceof ResearchFailure ? cause.issue.cause?.code ?? cause.issue.code
          : context.bytes.remaining < 0 || queryBytes > query.bytes ? 'byte-limit' : attempt.signal.aborted ? 'cancelled' : 'transport' });
      throw cause;
    }
  };
  const executor: Executor = context.dispatcher ? {
    execute: (request, execution) => context.dispatcher!.execute(request, execution, transport),
    close: async () => {}, stats: context.dispatcher.stats,
  } : createProviderExecutor({ transport, attempts: host.attempts, overallMs: host.overallMs,
    attemptMs: host.attemptMs, maxBytes: query.bytes, concurrency: 1, maxQueue: 1, spacingMs: host.spacingMs,
    now: host.now, sleep: host.sleep, random: host.random });
  const executeContext = { signal: context.signal, budget: context.budget,
    beforeDispatch: () => queryBytes < query.bytes && context.bytes.remaining > 0 };
  return { executor, executeContext, transport, artifacts, captures,
    async finish(input: ProviderFinish): Promise<ScholarlyResult> {
      const issues = input.issues ?? [];
      const reason = captures.find(c => c.reason === 'replay-miss' || c.reason === 'byte-limit')?.reason
        ?? (input.reason === 'authority-changed' && (queryBytes >= query.bytes || context.bytes.remaining <= 0) ? 'byte-limit' : input.reason);
      const observed = (Array.isArray(input.observations)
        ? [...input.observations].reverse().find(value => value && typeof value === 'object' && typeof value.state === 'string')
        : (input.observations as { response?: unknown }).response) as { state?: string; status?: number } | undefined;
      const terminal = observed?.state ?? (reason === 'cancelled' ? 'cancelled' : input.state);
      const counts = { ok: captures.filter(c => c.reason === null && c.status !== null && c.status >= 200 && c.status < 300).length,
        failed: captures.filter(c => c.reason !== 'cancelled' && !(c.reason === null && c.status !== null && c.status >= 200 && c.status < 300)).length,
        refused: terminal === 'refused' ? 1 : 0, unresolved: terminal === 'unresolved' ? 1 : 0,
        cancelled: Math.max(captures.filter(c => c.reason === 'cancelled').length, terminal === 'cancelled' ? 1 : 0), rateLimited: captures.filter(c => c.status === 429).length };
      if (input.state !== 'complete' && !issues.length) issues.push({ ...researchIssue('TRSH1008', '/queries/' + query.id,
        'Scholarly discovery did not complete.'), cause: { code: 'provider', path: '', detail: reason,
        state: terminal, attempts: input.attempts, reason,
        ...(observed?.status === undefined ? {} : { status: observed.status }) } });
      const observation = jsonArtifact({ queryId: query.id, observations: input.observations, captures });
      artifacts.push(observation);
      const outcome: DiscoveryQueryOutcome = { queryId: query.id, provider: query.provider, state: input.state, reason,
        attempts: input.attempts, rows: input.rows, malformed: input.malformed, counts,
        observationArtifactId: await researchArtifactIdOf(observation.bytes), rawHashes: [...new Set(captures.flatMap(c => c.hash ? [c.hash] : []))].sort(), issues };
      return { records: input.records ?? [], candidates: input.candidates ?? [], outcome: immutableResearchJson(outcome), artifacts };
    } };
}
export async function pullJsonProvider(query: DiscoveryQuery, host: ResearchProviderHost, context: ResearchAdapterContext,
  descriptor: ReturnType<typeof compileProvider>, input: unknown, normalize: (row: unknown) => ScholarlyMetadata): Promise<ScholarlyResult> {
  const runtime = providerRuntime(query, host, context);
  try {
    const pulled = await descriptor.pull(input, { executor: runtime.executor, ...runtime.executeContext,
      cursor: query.provider === 'semanticscholar' ? 0 : '*' });
    const records: LiteratureRecord[] = []; let malformed = 0;
    const successfulBodies = runtime.captures.filter(c => c.hash && c.status !== null && c.status >= 200 && c.status < 300);
    let pageIndex = 0;
    for (const page of pulled.observations) if (page.state === 'page') {
      const hash = successfulBodies[pageIndex++]?.hash;
      if (!hash) throw new TypeError('Native page lacks its captured response bytes.');
      for (const row of page.rows) {
        try { records.push(await normalizeLiterature(normalize(row), query.provider as ScholarlyProvider, hash, host.licence)); }
        catch { malformed++; }
      }
    }
    const state = pulled.state === 'complete' && !malformed ? 'complete' : pulled.state === 'refused' ? 'refused' : 'incomplete';
    return await runtime.finish({ state, reason: malformed ? 'malformed-records' : pulled.reason || 'complete', attempts: pulled.attempts,
      rows: records.length + malformed, malformed, observations: pulled, records: state === 'complete' ? records : [] });
  } finally { await runtime.executor.close(); }
}

export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected scholarly object.');
  return value as Record<string, any>;
}
export function text(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new TypeError('Expected scholarly text.'); return value; }
export function strings(value: unknown, mapper: (entry: any) => string): string[] {
  if (!Array.isArray(value) || !value.length) throw new TypeError('Expected scholarly authors.');
  return value.map(mapper).map(text);
}
