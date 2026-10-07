/** Bounded HTTP effects over the native contract client; durable work remains the host's job. */
import { compileContract } from '@jarenjs/contract';
import { openHttpClient, type Outcome } from '@jarenjs/contract/client';
import { createBoundedCache } from '@jarenjs/core/cache';
import { deepFreeze } from '@jarenjs/core/object';
import { createAttemptBudget, parseRetryAfter } from '@jarenjs/core/retry';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { readBoundedResponseBytes } from '@tangleai/documents/fetch';
import document from '../schemas/training-service.contract.json' with { type: 'json' };
import { checkTrainingCapabilities, trainingSpecDigest, validateTrainingSpec, verifyArtifactReceipt,
  type BackendResult, type TrainingBackend } from './backend.ts';
import { refuseExperiential } from './errors.ts';
import { validateExperientialShape } from './schema.ts';
import { trainingServiceBase } from './training-env.ts';
import type { ArtifactReceipt, BackendJob, BackendJobState, ExperientialRuntime, TrainingCapabilities, TrainingSpec } from './contracts.gen.ts';

export interface HttpTrainingBudget {
  maxRequests: number;
  maxJobs: number;
  maxBytes: number;
  maxResponseBytes: number;
  maxWallMs: number;
  maxSpend: number | null;
}
export interface HttpTrainingBackendOptions {
  base: string;
  fetch: typeof globalThis.fetch;
  credential(): Promise<string | null>;
  budget: HttpTrainingBudget;
  clock(): number;
  runtime: ExperientialRuntime;
}
export interface HttpTrainingStats {
  requests: number;
  submissions: number;
  verifiedArtifacts: number;
  inferenceOnly: boolean;
  retryAfterUntil: number | null;
  observedSpend: number | null;
  failures: { transport: number; shape: number; budget: number; backoff: number };
}
export interface HttpTrainingBackend extends TrainingBackend {
  /** Restore a job from the host's checked durable run; never submits or requeues it. */
  bindJob(spec: TrainingSpec, job: BackendJob): Promise<BackendResult<BackendJob>>;
  readBytes(receipt: ArtifactReceipt, maxBytes: number): Promise<Uint8Array>;
  stats(): HttpTrainingStats;
}
type FaultKind = 'transport' | 'shape' | 'budget' | 'backoff';
class WireFault extends Error {
  readonly kind: FaultKind;
  constructor(kind: FaultKind) { super('Training service request refused.'); this.kind = kind; }
}
interface BoundJob { spec: TrainingSpec; job: BackendJob; observed: BackendJobState | null; unknown: boolean; spend: number | null; costKnown: boolean }
const contract = compileContract(document);
const inferenceOnly = deepFreeze<TrainingCapabilities>({ methods: [], baseModels: [], resumable: false, artifactKinds: [], trainable: false });
const refused = (detail: string) => refuseExperiential('TEXP1008', '/backend', detail);
const stateOrder: Record<BackendJobState['state'], number> = { queued: 0, preparing: 1, training: 2, materializing: 3, complete: 4, failed: 4, cancelled: 4, unknown: -1 };
const unknown = (jobId: string): BackendResult<BackendJobState> => ({ ok: true, value: deepFreeze({ jobId, state: 'unknown',
  stopReason: 'transport-unknown', logRefs: [], metricsRef: null, spend: null }) });

/** Configuration errors are values and contain neither the supplied URL nor a credential. */
export function createHttpTrainingBackend(options: HttpTrainingBackendOptions): BackendResult<HttpTrainingBackend> {
  const address = trainingServiceBase(options.base); if (!address.ok) return address;
  const runtime = validateExperientialShape<ExperientialRuntime>('ExperientialRuntime', options.runtime); if (!runtime.ok) return runtime;
  const expectedRuntime = runtime.value;
  const budget = { ...options.budget }, base = address.value, origin = new URL(base).origin;
  if (base.length > 225 || typeof options.fetch !== 'function' || typeof options.credential !== 'function' || typeof options.clock !== 'function'
    || ['maxRequests', 'maxJobs', 'maxBytes', 'maxResponseBytes', 'maxWallMs'].some(key => !Number.isSafeInteger(budget[key as keyof HttpTrainingBudget]) || Number(budget[key as keyof HttpTrainingBudget]) < 1)
    || budget.maxWallMs > 2147483647 || (budget.maxSpend !== null && (!Number.isFinite(budget.maxSpend) || budget.maxSpend < 0)))
    return refuseExperiential('TEXP1001', '/backend', 'The training host requires injected effects and positive finite capacity, byte and wall bounds.');
  const fetch = options.fetch, credential = options.credential, clock = options.clock;
  const startedAt = clock();
  if (!Number.isFinite(startedAt)) return refuseExperiential('TEXP1001', '/clock', 'The training host clock must be finite.');
  let lastAt = startedAt, capability: Promise<TrainingCapabilities> | null = null;
  const attempts = createAttemptBudget(budget.maxRequests, 'provider-idempotent');
  const submissions = createBoundedCache<string, Promise<BackendResult<BackendJob>>>(budget.maxJobs);
  const jobs = createBoundedCache<string, BoundJob>(budget.maxJobs);
  const boundSpecs = createBoundedCache<string, BackendJob>(budget.maxJobs);
  const unresolvedCosts = createBoundedCache<string, true>(budget.maxJobs);
  const stats: HttpTrainingStats = { requests: 0, submissions: 0, verifiedArtifacts: 0, inferenceOnly: false,
    retryAfterUntil: null, observedSpend: null, failures: { transport: 0, shape: 0, budget: 0, backoff: 0 } };
  let totalKnownSpend = 0, unknownCosts = 0, reservedSpend = 0;
  function invalidate(bound: BoundJob): void {
    bound.unknown = true;
    if (bound.costKnown) { bound.costKnown = false; unknownCosts++; }
    stats.observedSpend = null;
  }
  function wall(maxWallMs = budget.maxWallMs): number {
    const at = clock();
    if (!Number.isFinite(at) || at < lastAt || at - startedAt >= Math.min(budget.maxWallMs, maxWallMs)) throw new WireFault('budget');
    lastAt = at; return at;
  }
  function secretIn(value: unknown, secret: string): boolean {
    if (typeof value === 'string') return value.includes(secret);
    if (Array.isArray(value)) return value.some(v => secretIn(v, secret));
    return value !== null && typeof value === 'object' && Object.entries(value).some(([k, v]) => k.includes(secret) || secretIn(v, secret));
  }
  async function send(url: string, init: RequestInit, maxBytes: number, json: boolean, maxWallMs = budget.maxWallMs): Promise<{ response: Response; bytes: Uint8Array }> {
    try {
      const checked = trainingServiceBase(url);
      if (!checked.ok || new URL(url).origin !== origin) throw new WireFault('shape');
      let at = wall(maxWallMs);
      if (stats.retryAfterUntil !== null && at < stats.retryAfterUntil) throw new WireFault('backoff');
      const key = await credential(); at = wall(maxWallMs);
      if (stats.retryAfterUntil !== null && at < stats.retryAfterUntil) throw new WireFault('backoff');
      if (key !== null && (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key))) throw new WireFault('shape');
      if (key && (url.includes(key) || typeof init.body === 'string' && secretIn(JSON.parse(init.body), key))) throw new WireFault('shape');
      if (!attempts.take()) throw new WireFault('budget');
      const headers = new Headers(init.headers); if (key) headers.set('authorization', 'Bearer ' + key);
      const deadline = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(budget.maxWallMs, maxWallMs) - (at - startedAt))));
      const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
      stats.requests++;
      const response = await fetch(url, { ...init, headers, signal, redirect: 'error', credentials: 'omit' });
      wall(maxWallMs);
      if (response.redirected || response.url && (new URL(response.url).origin !== origin || !trainingServiceBase(response.url).ok)) {
        await response.body?.cancel(); throw new WireFault('shape');
      }
      const retry = parseRetryAfter(response.headers.get('retry-after'), { now: lastAt });
      if (retry !== undefined) stats.retryAfterUntil = Math.max(stats.retryAfterUntil ?? 0, lastAt + retry);
      if (response.status >= 500 || response.status === 429) { await response.body?.cancel(); throw new WireFault('transport'); }
      if (!response.ok) {
        await response.body?.cancel();
        return { response, bytes: new Uint8Array() };
      }
      let bytes: Uint8Array;
      try { bytes = await readBoundedResponseBytes(response, maxBytes, undefined, signal); }
      catch { throw new WireFault(signal.aborted ? 'transport' : 'shape'); }
      wall(maxWallMs);
      if (json && key) {
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { throw new WireFault('shape'); }
        if (secretIn(value, key)) throw new WireFault('shape');
      }
      return { response, bytes };
    } catch (error) {
      const fault = error instanceof WireFault ? error : new WireFault('transport'); stats.failures[fault.kind]++; throw fault;
    }
  }
  async function invoke(name: string, input: unknown, key?: string, maxWallMs = budget.maxWallMs): Promise<{ result: Outcome; fault: FaultKind | null }> {
    let fault: FaultKind | null = null;
    const client = openHttpClient(contract, { baseUrl: base, now: clock, keys: () => { throw new WireFault('shape'); },
      fetch: async (url, init) => {
        try {
          const { response, bytes } = await send(url, init, budget.maxResponseBytes, true, maxWallMs);
          return new Response(bytes.length ? new Uint8Array(bytes) : null, { status: response.status, headers: { 'content-type': 'application/json' } });
        } catch (error) { fault = error instanceof WireFault ? error.kind : 'transport'; throw error; }
      } });
    try {
      const result = await client.invoke(name, input, key === undefined ? {} : { idempotencyKey: key });
      if (!result.ok && !fault && result.error.status !== 404 && result.error.status !== 405) stats.failures.shape++;
      return { result, fault };
    } finally { client.close(); }
  }
  async function capabilities(): Promise<TrainingCapabilities> {
    capability ??= (async () => {
      const { result } = await invoke('training.capabilities', {});
      if (!result.ok) {
        if (result.error.status === 404 || result.error.status === 405) { stats.inferenceOnly = true; return inferenceOnly; }
        throw new Error('TEXP1008: training capabilities are unavailable or invalid.');
      }
      const checked = validateExperientialShape<TrainingCapabilities>('TrainingCapabilities', result.value);
      if (!checked.ok) throw new Error('TEXP1008: invalid training capabilities.');
      stats.inferenceOnly = !checked.value.trainable; return checked.value;
    })();
    return capability;
  }
  async function bindJob(specValue: TrainingSpec, jobValue: BackendJob): Promise<BackendResult<BackendJob>> {
    const spec = validateTrainingSpec(specValue), job = validateExperientialShape<BackendJob>('BackendJob', jobValue);
    if (!spec.ok || !job.ok) return refused('The host job and training specification must be closed records.');
    const digest = await trainingSpecDigest(spec.value);
    if (!digest.ok || job.value.specDigest !== digest.value) return refused('The job must bind the exact training specification.');
    const previous = jobs.get(job.value.id);
    if (previous) return previous.job.specDigest === job.value.specDigest ? { ok: true, value: previous.job } : refused('A job identifier cannot be rebound to another specification.');
    const bound = boundSpecs.get(job.value.specDigest);
    if (bound && bound.id !== job.value.id) return refused('One specification cannot be rebound to another job identifier.');
    if (jobs.size() >= budget.maxJobs || !submissions.get(job.value.specDigest) && submissions.size() >= budget.maxJobs)
      return refused('The host job capacity is exhausted.');
    if (!submissions.get(job.value.specDigest) && budget.maxSpend !== null) {
      if (spec.value.budget.maxSpend === null || spec.value.budget.maxSpend > budget.maxSpend - reservedSpend)
        return refused('The restored job exceeds the remaining host spend reservation.');
      reservedSpend += spec.value.budget.maxSpend;
    }
    jobs.set(job.value.id, { spec: spec.value, job: job.value, observed: null, unknown: false, spend: null, costKnown: false });
    unknownCosts++; stats.observedSpend = null;
    unresolvedCosts.delete(job.value.specDigest);
    boundSpecs.set(job.value.specDigest, job.value);
    submissions.set(job.value.specDigest, Promise.resolve({ ok: true, value: job.value }));
    return { ok: true, value: job.value };
  }
  async function submit(value: TrainingSpec): Promise<BackendResult<BackendJob>> {
    const spec = validateTrainingSpec(value); if (!spec.ok) return spec;
    const digest = await trainingSpecDigest(spec.value); if (!digest.ok) return digest;
    const prior = submissions.get(digest.value); if (prior) return prior;
    if (budget.maxSpend !== null && (spec.value.budget.maxSpend === null || spec.value.budget.maxSpend > budget.maxSpend - reservedSpend))
      return refused('The submitted specification must declare a spend ceiling within the remaining host budget.');
    if (submissions.size() >= budget.maxJobs) return refused('The host submission capacity is exhausted.');
    reservedSpend += spec.value.budget.maxSpend ?? 0;
    const promise = (async (): Promise<BackendResult<BackendJob>> => {
      let caps: TrainingCapabilities;
      try { caps = await capabilities(); } catch { return refused('Training capabilities are unavailable or invalid.'); }
      if (!caps.trainable) return refused('The provider is inference-only.');
      const supported = checkTrainingCapabilities(spec.value, caps); if (!supported.ok) return supported;
      unresolvedCosts.set(digest.value, true); stats.observedSpend = null;
      const { result } = await invoke('training.submit', spec.value, digest.value, spec.value.budget.maxWallMs);
      if (!result.ok) return refused('Submission is unconfirmed; reconcile the fixed specification digest before any further submission.');
      const checked = await bindJob(spec.value, result.value as BackendJob);
      if (checked.ok) stats.submissions++;
      return checked;
    })();
    submissions.set(digest.value, promise); return promise;
  }
  async function observe(id: string, cancel: boolean): Promise<BackendResult<BackendJobState>> {
    const bound = jobs.get(id); if (!bound) return refused('The host must bind this job before inspecting or cancelling it.');
    const wasUnknown = bound.unknown; invalidate(bound);
    const { result, fault } = await invoke(cancel ? 'training.cancel' : 'training.inspect', { jobId: id }, cancel ? bound.job.specDigest + ':cancel' : undefined, bound.spec.budget.maxWallMs);
    if (!result.ok) {
      if (fault === 'transport' || fault === 'backoff') { bound.unknown = true; return unknown(id); }
      return refused('The training service returned an invalid or unavailable job state.');
    }
    const checked = validateExperientialShape<BackendJobState>('BackendJobState', result.value);
    if (!checked.ok || checked.value.jobId !== id) return refused('The job observation has invalid shape or identity.');
    const state = checked.value, before = bound.observed;
    if (wasUnknown && state.state === 'queued') return unknown(id);
    if (before && state.state !== 'unknown' && (stateOrder[state.state] < stateOrder[before.state]
      || stateOrder[before.state] === 4 && before.state !== state.state)) return refused('The job observation regressed from its retained state.');
    if (state.spend !== null && bound.spend !== null && state.spend < bound.spend) return refused('Cumulative training spend cannot decrease.');
    const limit = Math.min(budget.maxSpend ?? Infinity, bound.spec.budget.maxSpend ?? Infinity);
    if (state.spend !== null) {
      if (!bound.costKnown) { unknownCosts--; bound.costKnown = true; }
      totalKnownSpend += state.spend - (bound.spend ?? 0); bound.spend = state.spend;
    }
    stats.observedSpend = unknownCosts > 0 || unresolvedCosts.size() > 0 ? null : totalKnownSpend;
    if (Number.isFinite(limit) && (state.spend === null || state.spend > limit) || budget.maxSpend !== null && totalKnownSpend > budget.maxSpend)
      return refused('Unknown or excessive training spend does not satisfy the configured ceiling.');
    if (cancel && !['cancelled', 'complete', 'failed'].includes(state.state)) return refused('Cancellation was not confirmed by a terminal state.');
    bound.observed = state; bound.unknown = state.state === 'unknown'; return checked;
  }
  async function readBytes(value: ArtifactReceipt, maxBytes: number): Promise<Uint8Array> {
    const receipt = validateExperientialShape<ArtifactReceipt>('ArtifactReceipt', value);
    if (!receipt.ok || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || receipt.value.sizeBytes > Math.min(maxBytes, budget.maxBytes)) throw new WireFault('shape');
    const url = trainingServiceBase(receipt.value.storageUri);
    if (!url.ok || new URL(url.value).origin !== origin) throw new WireFault('shape');
    const { response, bytes } = await send(url.value, { method: 'GET' }, Math.min(maxBytes, budget.maxBytes), false, jobs.get(receipt.value.jobId)?.spec.budget.maxWallMs);
    if (!response.ok) throw new WireFault('transport');
    return bytes;
  }
  async function materialize(id: string): Promise<BackendResult<ArtifactReceipt>> {
    const bound = jobs.get(id); if (!bound) return refused('The host must bind this job before materializing it.');
    if (bound.observed?.state !== 'complete' || bound.unknown) {
      const observed = await observe(id, false);
      if (!observed.ok) return observed;
      if (observed.value.state !== 'complete') return refused('Only a confirmed complete job may materialize an artifact.');
    }
    if (budget.maxSpend !== null && (stats.observedSpend === null || totalKnownSpend > budget.maxSpend))
      return refused('Unknown aggregate spend cannot satisfy the host ceiling.');
    const { result } = await invoke('training.materialize', { jobId: id }, undefined, bound.spec.budget.maxWallMs);
    if (!result.ok) { invalidate(bound); return refused('The training service returned an invalid or unavailable artifact receipt.'); }
    const checked = await verifyArtifactReceipt(result.value, { spec: bound.spec, job: bound.job, runtime: expectedRuntime,
      maxBytes: budget.maxBytes, readBytes });
    if (!checked.ok) { stats.failures.shape++; return checked; }
    stats.verifiedArtifacts++; return { ok: true, value: checked.value.receipt };
  }
  return { ok: true, value: Object.freeze({ identity: deepFreeze({ id: 'tangle-training-service:' + base, version: '1', kind: 'http' }),
    capabilities, submit, bindJob, inspect: (id: string) => observe(id, false), cancel: (id: string) => observe(id, true), materialize, readBytes,
    stats: () => deepFreeze(JSON.parse(canonicalizeJson(stats)) as HttpTrainingStats) }) };
}
