/**
 * Canonical revisions and immutable identity payloads.
 *
 * Every revision here is `canonicalSha256` (RFC 8785) over an EXPLICIT
 * schema-known payload with the identity's own field excluded — never a
 * recursive walk deleting suspicious member names from arbitrary
 * objects, because the payloads are credential-free by construction
 * (the schemas close every object and refuse secret-shaped members and
 * URLs before anything is hashed). Reordered object members hash
 * equally; reordered arrays do not, except where the schema gives a
 * member set semantics — requested/effective tool lists — which the
 * resolver sorts by name before hashing.
 *
 * No clock, observation, usage, latency, key or cache identifier is
 * ever part of a payload: a host manifest's dated `observation` block
 * is stripped before its revision is computed, so a re-probed but
 * unchanged host keeps its identity.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';

import type { HostManifest, ProfileRegistry, RunIdentity } from './contracts.gen.ts';

/** The one canonical-revision helper every identity goes through. */
export function revisionOf(payload: unknown): Promise<string> {
  return canonicalSha256(payload);
}

/** The registry's revision — the whole validated document. */
export function registryRevisionOf(registry: ProfileRegistry): Promise<string> {
  return revisionOf(registry);
}

/**
 * The host manifest's revision — the credential-free facts with the
 * dated observation excluded, so WHEN a host was observed never changes
 * WHAT it is.
 */
export function hostManifestRevisionOf(host: HostManifest): Promise<string> {
  const { observation: _observation, ...facts } = host;
  return revisionOf(facts);
}

/** The identity id — the complete identity with its own field excluded. */
export function identityIdOf(identity: Omit<RunIdentity, 'identityId'>): Promise<string> {
  return revisionOf(identity);
}
