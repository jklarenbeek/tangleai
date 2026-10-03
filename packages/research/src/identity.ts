import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
import type { ArtifactAdmission, InputManifest, StageAttemptKey } from './contracts.gen.ts';

/** Snapshot finite JSON through the native canonical owner before an asynchronous seam. */
export function immutableResearchJson<T>(value: T): T { return deepFreeze(JSON.parse(canonicalizeJson(value))) as T; }
export function researchRevisionOf(value: unknown): Promise<string> { return canonicalSha256(immutableResearchJson(value)); }

/** Copy the exact view before yielding; no surrounding buffer bytes enter identity. */
export function copyResearchBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    throw new TypeError('Expected a Uint8Array byte view.');
  return new Uint8Array(bytes);
}
export async function researchArtifactIdOf(bytes: Uint8Array): Promise<string> {
  const snapshot = copyResearchBytes(bytes);
  const digest = await crypto.subtle.digest('SHA-256', snapshot);
  return 'art-' + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export function inputManifestHashOf(manifest: InputManifest): Promise<string> { return researchRevisionOf(manifest); }
export async function stageAttemptIdOf(key: StageAttemptKey): Promise<string> {
  const { projectId, stage, attemptOrdinal, inputManifestHash } = key;
  return 'attempt-' + await researchRevisionOf({ projectId, stage, attemptOrdinal, inputManifestHash });
}
export async function artifactAdmissionIdOf(value: Omit<ArtifactAdmission, 'id'>): Promise<string> {
  return 'admission-' + await researchRevisionOf(value);
}
