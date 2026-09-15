/**
 * The one identity function for skill artifacts.
 *
 * A directory's id is the canonical hash of its manifest projection —
 * scope, mode, parent, root page and the ordered `{ path, sha256 }`
 * pairs. Mutable state (status, origin, sizes) is deliberately outside
 * the hash so activating a directory cannot rename it, and file order
 * is code point rather than locale so the identity is host independent.
 */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { deepFreeze } from '@jarenjs/core/object';
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';

/** Code-point order, because these names become hash inputs. */
export const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Fresh, stable JSON property order; non-JSON, function and non-finite values refuse. */
export function immutableJson<T>(value: T): T { return deepFreeze(JSON.parse(JSON.stringify(value))) as T; }

const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/** Exact byte receipt of one file, including whitespace and line endings. */
export async function skillFileDigest(bytes: Uint8Array | string): Promise<string> {
  const buffer = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buffer as unknown as ArrayBuffer);
  let hex = '';
  for (const byte of new Uint8Array(digest)) hex += HEX[byte];
  return hex;
}

export interface BundleIdentity {
  scopeKey: string;
  mode: 'deepening' | 'creation';
  parentId: string | null;
  rootFile: string;
  files: ReadonlyArray<{ path: string, sha256: string }>;
}

export function bundleIdOf(identity: BundleIdentity): Promise<string> {
  return canonicalSha256({
    scopeKey: identity.scopeKey,
    mode: identity.mode,
    parent: identity.parentId,
    root: identity.rootFile,
    files: [...identity.files].sort((a, b) => byPath(a.path, b.path)).map(file => ({ path: file.path, sha256: file.sha256 })),
  });
}

export function skillRevisionOf(value: unknown): Promise<string> { return canonicalSha256(value); }

/** One idempotency key: run, stage, unit, attempt and every input that changes the answer. */
export function idempotencyKeyOf(input: {
  runId: string, stage: string, unit: string, attempt: number,
  inputHashes: readonly string[], identityId: string, promptVersion: string,
}): Promise<string> {
  return canonicalSha256({ ...input, inputHashes: [...input.inputHashes].sort(byPath) });
}

/** Every rollout, analyst result, patch and merge node names the same frozen directory. */
export function refuseStaleBase<T = never>(expected: string, actual: string, path: string): Trace2SkillOutcome<T> | null {
  return expected === actual ? null
    : trace2SkillRefuse<T>('TT2S1002', path, `the frozen directory is ${expected.slice(0, 12)}…, the record names ${actual.slice(0, 12)}…`);
}
