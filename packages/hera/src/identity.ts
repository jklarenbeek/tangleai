/** Canonical, credential-free content identities, separate from lifecycle metadata. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
export const heraRevisionOf = canonicalSha256;
export function immutableHeraJson<T>(value: T): T { return deepFreeze(JSON.parse(canonicalizeJson(value))) as T; }
/** Status and observation time may change under a head; neither changes content. */
export function heraContentIdOf(value: object): Promise<string> {
  const { id: _id, at: _at, status: _status, ...content } = value as Record<string, unknown>;
  return canonicalSha256(content);
}
export function heraLibraryRevisionOf(ids: readonly string[]): Promise<string> { return canonicalSha256([...new Set(ids)].sort()); }
