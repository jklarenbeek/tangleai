/**
 * Canonical MAS identities — RFC 8785 SHA-256 over explicit
 * credential-free payloads.
 *
 * Every identity excludes what could never be allowed to move it: a
 * workflow or template version excludes its own `versionId` and its
 * `provenance` (and, for workflows, the whole `compile` metadata block,
 * so a declarative and an imperative authoring of the same semantics
 * hash identically); a registry snapshot is the whole validated
 * document; an executable revision covers the region plan and every
 * lowered document. No clock, observation, result, cost, secret or
 * identity field itself can enter its own identity — the closed schemas
 * refuse those members before anything is hashed.
 */

import { canonicalSha256 } from '@jarenjs/json/canonical';

/** The one canonical-revision helper every MAS identity goes through. */
export function masRevisionOf(payload: unknown): Promise<string> {
  return canonicalSha256(payload);
}

/**
 * The semantic workflow version: the document minus `versionId`,
 * `provenance` and `compile`. Exactly the rule the conformance
 * registration pinned before this package existed.
 */
export function masWorkflowVersionIdOf(workflow: Record<string, unknown>): Promise<string> {
  const { versionId: _versionId, provenance: _provenance, compile: _compile, ...semantic } = workflow;
  return masRevisionOf(semantic);
}

/** The registry snapshot revision — the whole validated document. */
export function masRegistryRevisionOf(document: Record<string, unknown>): Promise<string> {
  return masRevisionOf(document);
}

/** The template version — the document minus `versionId` and `provenance`. */
export function masTemplateVersionIdOf(template: Record<string, unknown>): Promise<string> {
  const { versionId: _versionId, provenance: _provenance, ...semantic } = template;
  return masRevisionOf(semantic);
}

/** The CONFIG catalog revision — the whole document. */
export function masConfigCatalogRevisionOf(document: Record<string, unknown>): Promise<string> {
  return masRevisionOf(document);
}
