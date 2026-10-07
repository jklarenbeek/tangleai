/** A deterministic test backend. Its JSON artifact is not trained model weights. */
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalizeJson, canonicalSha256 } from '@jarenjs/json/canonical';
import { checkTrainingCapabilities, experientialArtifactChecksum, validateTrainingSpec,
  type TrainingBackend } from './backend.ts';
import { validateExperientialShape } from './schema.ts';
import { refuseExperiential } from './errors.ts';
import type { ArtifactReceipt, BackendJob, BackendJobState, ExperientialRuntime,
  TrainingCapabilities, TrainingSpec } from './contracts.gen.ts';

export interface FakeTrainingBackendOptions {
  seed: number;
  stepsPerState?: number;
  failAt?: 'preparing' | 'training' | 'materializing';
  corruptChecksum?: boolean;
  clock(): number;
  /** Explicit base content addresses accepted by this test service. */
  baseModels?: readonly string[];
  runtime?: ExperientialRuntime;
}
export interface FakeTrainingBackend extends TrainingBackend {
  readBytes(receipt: ArtifactReceipt, maxBytes: number): Promise<Uint8Array>;
  stats(): { submitRequests: number; submissions: number; inspections: number; cancellations: number;
    materializations: number; lastObservedAt: number | null };
}
interface FakeJob { job: BackendJob; spec: TrainingSpec; bytes: Uint8Array; checksum: string; ticks: number; state: BackendJobState['state'] }

export function createFakeTrainingBackend(options: FakeTrainingBackendOptions): FakeTrainingBackend {
  const { seed, clock, failAt, corruptChecksum = false, stepsPerState = 1 } = options;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(stepsPerState) || stepsPerState < 1
    || typeof clock !== 'function' || failAt !== undefined && !['preparing', 'training', 'materializing'].includes(failAt))
    throw new TypeError('A uint32 seed, positive state steps, named failure point and injected clock are required.');
  const capability = validateExperientialShape<TrainingCapabilities>('TrainingCapabilities', {
    methods: ['lora'], baseModels: [...(options.baseModels ?? ['0'.repeat(64)])], resumable: true,
    artifactKinds: ['adapter'], trainable: true,
  });
  const configured = validateExperientialShape<ExperientialRuntime>('ExperientialRuntime', options.runtime ?? {
    provider: 'fake', base: 'memory:fake/inference', servedModel: 'fake-adapter',
  });
  if (!capability.ok || !configured.ok) throw new TypeError('The fake service configuration must be closed and credential-free.');
  const capabilities = capability.value, runtime = configured.value;
  const identity = deepFreeze({ id: `tangle-fake-training/${seed}`, version: '1', kind: 'fake' });
  const jobs = new Map<string, FakeJob>(), bySpec = new Map<string, string>();
  const counts = { submitRequests: 0, submissions: 0, inspections: 0, cancellations: 0, materializations: 0,
    lastObservedAt: null as number | null };
  const observe = () => {
    const at = clock(); if (!Number.isFinite(at) || at < 0) throw new TypeError('The injected clock must return a nonnegative epoch time.');
    counts.lastObservedAt = at;
  };
  async function stateOf(jobId: string): Promise<BackendJobState> {
    const row = jobs.get(jobId), state = row?.state ?? 'unknown';
    const sourceId = `fake-log:${jobId}:${state}`;
    return deepFreeze({ jobId, state, stopReason: state === 'failed' ? 'scripted-training-failure' : state === 'cancelled' ? 'cancelled' : state === 'unknown' ? 'unknown-job' : null,
      logRefs: row ? [{ sourceId, kind: 'training-log', digest: await canonicalSha256({ jobId, state, ticks: row.ticks }) }] : [],
      metricsRef: null, spend: row ? 0 : null });
  }
  const backend: FakeTrainingBackend = {
    identity,
    capabilities: async () => capabilities,
    async submit(value) {
      counts.submitRequests++; observe();
      const checked = validateTrainingSpec(value); if (!checked.ok) return checked;
      const supported = checkTrainingCapabilities(checked.value, capabilities); if (!supported.ok) return supported;
      const spec = checked.value, specDigest = await canonicalSha256(spec);
      const id = await canonicalSha256({ backend: identity, specDigest });
      const bytes = new TextEncoder().encode(canonicalizeJson({ format: 'tangle-fake-adapter/1', datasetId: spec.datasetId,
        baseArtifactId: spec.baseArtifactId, method: spec.method, hyperparameters: spec.hyperparameters, seed: spec.seed }));
      const checksum = await experientialArtifactChecksum(bytes);
      // Admission is synchronous after hashing, so concurrent identical submits
      // retain one provider job and increment the submission count once.
      const previous = bySpec.get(specDigest);
      if (previous !== undefined) return { ok: true, value: jobs.get(previous)!.job };
      const job = deepFreeze({ id, specDigest });
      jobs.set(id, { job, spec, bytes, checksum, ticks: 0, state: 'queued' }); bySpec.set(specDigest, id); counts.submissions++;
      return { ok: true, value: job };
    },
    async inspect(jobId) {
      if (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 256)
        return refuseExperiential('TEXP1008', '/jobId', 'Expected a bounded provider job identity.');
      counts.inspections++; observe();
      const row = jobs.get(jobId);
      if (row && !['complete', 'failed', 'cancelled'].includes(row.state)) {
        row.ticks++;
        const states = ['queued', 'preparing', 'training', 'materializing', 'complete'] as const;
        row.state = states[Math.min(4, Math.floor(row.ticks / stepsPerState))]!;
        if (row.state === failAt) row.state = 'failed';
      }
      return { ok: true, value: await stateOf(jobId) };
    },
    async cancel(jobId) {
      if (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 256)
        return refuseExperiential('TEXP1008', '/jobId', 'Expected a bounded provider job identity.');
      counts.cancellations++; observe(); const row = jobs.get(jobId);
      if (row && !['complete', 'failed', 'cancelled'].includes(row.state)) row.state = 'cancelled';
      return { ok: true, value: await stateOf(jobId) };
    },
    async materialize(jobId) {
      if (typeof jobId !== 'string' || !jobId.trim() || jobId.length > 256)
        return refuseExperiential('TEXP1008', '/jobId', 'Expected a bounded provider job identity.');
      counts.materializations++; observe(); const row = jobs.get(jobId);
      if (!row || row.state !== 'complete') return refuseExperiential('TEXP1008', '/jobId', 'Only a completed fake training job has materialized bytes.');
      const observation = await stateOf(jobId);
      return { ok: true, value: deepFreeze({ jobId, specDigest: row.job.specDigest, datasetId: row.spec.datasetId,
        baseArtifactId: row.spec.baseArtifactId, baseChecksum: row.spec.baseChecksum, method: row.spec.method, kind: 'adapter',
        storageUri: 'memory:fake/artifacts/' + row.checksum,
        sha256: corruptChecksum ? (row.checksum[0] === '0' ? '1' : '0') + row.checksum.slice(1) : row.checksum,
        sizeBytes: row.bytes.length, runtime: { ...runtime, servedModel: 'fake-adapter:' + row.checksum },
        deterministic: true, logRefs: observation.logRefs, metricsRef: observation.metricsRef }) };
    },
    async readBytes(receipt, maxBytes) {
      const row = jobs.get(receipt.jobId);
      if (!row || row.state !== 'complete' || receipt.storageUri !== 'memory:fake/artifacts/' + row.checksum
        || !Number.isSafeInteger(maxBytes) || maxBytes < row.bytes.length)
        throw new TypeError('The fake artifact is unavailable at the requested address or byte bound.');
      return new Uint8Array(row.bytes);
    },
    stats: () => ({ ...counts }),
  };
  return Object.freeze(backend);
}
