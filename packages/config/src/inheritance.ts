/**
 * Single-parent profile inheritance through RFC 7396.
 *
 * A root profile is a complete validated document. A child is exactly
 * `{ id, extends, patch }`: its ancestry is resolved root-to-leaf, each
 * patch applied with the suite's `applyMergePatch` (a `null` member
 * deletes a member, exactly as the RFC says), and the fully merged
 * registry is validated AGAINST THE REGISTRY SCHEMA AGAIN — so a patch
 * cannot smuggle in a ghost reference, an undeclared member or an
 * invalid final profile. Cycles and missing parents are stable issues,
 * never a stack overflow; there is no multiple inheritance, no second
 * patch format and no local merge implementation.
 *
 * RFC 7396 cannot say "set this member to null" — null always deletes.
 * Authored documents keep every member explicit (the schema requires
 * them), so after the merge the schema-known OPTIONAL-by-meaning
 * members a patch may null out are completed back to their empty
 * values: a deleted role reference becomes null, deleted tools become
 * the empty list. A patch that deletes a load-bearing member (a role
 * map, a description, an embedding) is NOT completed and the re-run
 * validation refuses it — a patch may empty an optional field and can
 * never create an invalid final profile.
 */

import { applyMergePatch } from '@jarenjs/json';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';

import type { Issue, ProfileRegistry, RootProfile } from './contracts.gen.ts';
import { issue, sortIssues, validateRegistry, type Validated } from './schema.ts';

/**
 * Resolve every child profile to its merged root form and validate the
 * whole registry again with the results in place. The returned map
 * holds one deeply frozen resolved profile per id.
 */
export function resolveProfiles(registry: ProfileRegistry): Validated<ReadonlyMap<string, RootProfile>> {
  const byId = new Map(registry.profiles.map((profile) => [profile.id, profile]));
  const issues: Issue[] = [];
  const resolved = new Map<string, RootProfile>();

  const resolveOne = (id: string, trail: string[]): RootProfile | null => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const profile = byId.get(id);
    if (profile === undefined) {
      issues.push(issue('TCFG1002', `/profiles/${indexOf(registry, trail[trail.length - 1] ?? id)}/extends`, `'${id}' names no profile`));
      return null;
    }
    if (trail.includes(id)) {
      issues.push(issue('TCFG1003', `/profiles/${indexOf(registry, id)}`, `inheritance cycle: ${[...trail, id].join(' -> ')}`));
      return null;
    }
    if (profile.kind === 'root') {
      resolved.set(id, profile);
      return profile;
    }
    const parent = resolveOne(profile.extends, [...trail, id]);
    if (parent === null) return null;
    const merged = applyMergePatch(cloneJson(parent) as unknown as Record<string, unknown>, profile.patch as Record<string, unknown>) as unknown as RootProfile;
    merged.id = profile.id;
    merged.kind = 'root';
    completeProfile(merged);
    resolved.set(id, merged);
    return merged;
  };

  for (const profile of registry.profiles) resolveOne(profile.id, []);
  if (issues.length > 0) return { ok: false, issues: sortIssues(issues) };

  // the merged result must be a valid registry again — the one gate
  const flattened = {
    ...cloneJson(registry) as ProfileRegistry,
    profiles: registry.profiles.map((profile) => cloneJson(resolved.get(profile.id)) as RootProfile),
  };
  const outcome = validateRegistry(flattened);
  if (!outcome.ok) return outcome;

  const frozen = new Map<string, RootProfile>();
  for (const profile of outcome.value.profiles) frozen.set(profile.id, deepFreeze(cloneJson(profile)) as RootProfile);
  return { ok: true, value: frozen };
}

function indexOf(registry: ProfileRegistry, id: string): number {
  return registry.profiles.findIndex((profile) => profile.id === id);
}

/**
 * Restore the empty value of every schema-known member a patch may
 * legitimately null out. Load-bearing members (roles, description,
 * embedding) are deliberately absent here so their deletion reaches the
 * re-run validation as the refusal it is.
 */
function completeProfile(profile: RootProfile): void {
  if (profile.policyComponent === undefined) profile.policyComponent = null;
  if (profile.budget === undefined) profile.budget = null;
  if (profile.roles === undefined || typeof profile.roles !== 'object') return;
  for (const role of Object.values(profile.roles)) {
    if (role === null || typeof role !== 'object') continue;
    if (role.capability === undefined) role.capability = null;
    if (role.candidate === undefined) role.candidate = null;
    if (role.prompt === undefined) role.prompt = null;
    if (role.responseSchema === undefined) role.responseSchema = null;
    if (role.inference === undefined) role.inference = null;
    if (role.ranker === undefined) role.ranker = null;
    if (role.tools === undefined) role.tools = [];
    if (role.toolsRequired === undefined) role.toolsRequired = false;
  }
}
