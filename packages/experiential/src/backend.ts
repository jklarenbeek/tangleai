/** Training effects belong to an injected backend; receipts confer no activation authority. */
import { deepFreeze } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { validateExperientialShape } from './schema.ts';
import { experientialNativeCause, refuseExperiential, type ExperientialResult } from './errors.ts';
import type { ArtifactReceipt, BackendJob, BackendJobState, ExperientialRuntime,
  ExperientialTrainingRunBackendIdentity, TrainingCapabilities, TrainingSpec } from './contracts.gen.ts';

export type BackendResult<T> = ExperientialResult<T>;
export interface TrainingBackend {
  readonly identity: ExperientialTrainingRunBackendIdentity;
  capabilities(): Promise<TrainingCapabilities>;
  submit(spec: TrainingSpec): Promise<BackendResult<BackendJob>>;
  inspect(jobId: string): Promise<BackendResult<BackendJobState>>;
  cancel(jobId: string): Promise<BackendResult<BackendJobState>>;
  materialize(jobId: string): Promise<BackendResult<ArtifactReceipt>>;
}

export const validateTrainingSpec = (value: unknown) => validateExperientialShape<TrainingSpec>('TrainingSpec', value);

/** Every configured input participates; the caller cannot change it while hashing. */
export async function trainingSpecDigest(value: unknown): Promise<BackendResult<string>> {
  const spec = validateTrainingSpec(value);
  return spec.ok ? { ok: true, value: await canonicalSha256(spec.value) } : spec;
}

/** An inference-only or differently bound service is refused before submission. */
export function checkTrainingCapabilities(spec: TrainingSpec, value: unknown): BackendResult<TrainingCapabilities> {
  const input = validateTrainingSpec(spec); if (!input.ok) return input;
  const capabilities = validateExperientialShape<TrainingCapabilities>('TrainingCapabilities', value);
  if (!capabilities.ok) return refuseExperiential('TEXP1008', '/capabilities', 'The backend returned an invalid capability document.');
  const c = capabilities.value, s = input.value;
  if (!c.trainable || !c.methods.includes(s.method) || !c.baseModels.includes(s.baseArtifactId)
    || !c.artifactKinds.includes(s.method === 'lora' ? 'adapter' : 'weights'))
    return refuseExperiential('TEXP1008', '/capabilities', 'Training, method, exact base identity and artifact kind must all be supported.');
  return capabilities;
}

/** Standard raw-byte SHA-256, with a detached copy of exactly the supplied view. */
export async function experientialArtifactChecksum(bytes: Uint8Array): Promise<string> {
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    throw new TypeError('Artifact hashing requires a Uint8Array view.');
  const snapshot = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', snapshot);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export interface VerifyArtifactReceiptOptions {
  spec: TrainingSpec;
  job: BackendJob;
  /** The host's configured inference endpoint and provider; the served model may be new. */
  runtime: ExperientialRuntime;
  maxBytes: number;
  /** The host enforces its allowed origins and streaming byte limit while reading. */
  readBytes(receipt: ArtifactReceipt, maxBytes: number): Promise<Uint8Array>;
}
export interface VerifiedArtifactReceipt { receipt: ArtifactReceipt; verifiedBytes: number }
const verifiedReceipts = new WeakSet<object>();
/** Only this process's independent byte verifier can authorize a durable verification fact. */
export function isVerifiedArtifactReceipt(value: unknown): value is VerifiedArtifactReceipt {
  return typeof value === 'object' && value !== null && verifiedReceipts.has(value);
}

/** Recompute bytes and ancestry independently of a backend's success assertion. */
export async function verifyArtifactReceipt(value: unknown, options: VerifyArtifactReceiptOptions): Promise<BackendResult<VerifiedArtifactReceipt>> {
  const spec = validateTrainingSpec(options.spec); if (!spec.ok) return spec;
  const job = validateExperientialShape<BackendJob>('BackendJob', options.job);
  const runtime = validateExperientialShape<ExperientialRuntime>('ExperientialRuntime', options.runtime);
  const receipt = validateExperientialShape<ArtifactReceipt>('ArtifactReceipt', value);
  if (!job.ok || !runtime.ok || !receipt.ok)
    return refuseExperiential('TEXP1008', '/receipt', 'The job, runtime and artifact receipt must be closed credential-free records.');
  const { maxBytes, readBytes } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof readBytes !== 'function')
    return refuseExperiential('TEXP1008', '/maxBytes', 'A positive byte bound and host byte reader are required.');
  const s = spec.value, j = job.value, r = receipt.value, expected = runtime.value;
  const digest = await canonicalSha256(s);
  if (j.specDigest !== digest || r.specDigest !== digest || r.jobId !== j.id || r.datasetId !== s.datasetId
    || r.baseArtifactId !== s.baseArtifactId || r.baseChecksum !== s.baseChecksum || r.method !== s.method
    || r.kind !== (s.method === 'lora' ? 'adapter' : 'weights'))
    return refuseExperiential('TEXP1008', '/receipt/ancestry', 'The receipt must bind this exact submission, dataset, base and training method.');
  if (r.runtime.provider !== expected.provider || r.runtime.base !== expected.base)
    return refuseExperiential('TEXP1008', '/receipt/runtime', 'The artifact runtime differs from the configured inference provider or endpoint.');
  if (r.sizeBytes > maxBytes)
    return refuseExperiential('TEXP1008', '/receipt/sizeBytes', 'The declared artifact exceeds the host byte bound.');
  let bytes: Uint8Array;
  try {
    const supplied = await readBytes(r, maxBytes);
    if (!ArrayBuffer.isView(supplied) || Object.prototype.toString.call(supplied) !== '[object Uint8Array]'
      || supplied.byteLength !== r.sizeBytes || supplied.byteLength > maxBytes)
      return refuseExperiential('TEXP1008', '/receipt/sizeBytes', 'The fetched artifact size differs from its receipt or exceeds the host bound.');
    bytes = new Uint8Array(supplied);
  } catch (error) { return refuseExperiential('TEXP1008', '/receipt/storageUri', 'The configured host could not read the bounded artifact bytes.', experientialNativeCause(error)); }
  if (await experientialArtifactChecksum(bytes) !== r.sha256)
    return refuseExperiential('TEXP1008', '/receipt/sha256', 'The fetched artifact checksum does not reproduce.');
  const verified = deepFreeze({ receipt: r, verifiedBytes: bytes.byteLength });
  verifiedReceipts.add(verified);
  return { ok: true, value: verified };
}
