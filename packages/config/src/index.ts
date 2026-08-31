/**
 * @tangleai/config — the one owner of the capability-profile registry
 * and effective-run-identity contracts.
 *
 * The JSON Schemas under `schemas/` are the runtime truth: documents are
 * validated against them (with their `$query` cross-field assertions)
 * before anything treats them as configuration, and the TypeScript in
 * `contracts.gen.ts` is GENERATED from them by `@jarenjs/emit` — no
 * hand-written interface mirrors a schema, and `npm run emit:check`
 * fails when the two drift.
 *
 * Resolution is pure: `resolveProfile` consumes a registry, a request
 * and a credential-free host manifest and returns an immutable identity
 * or stable `TCFG1xxx` issues. Effectful host adapters live with their
 * hosts; this package reads no environment, no database, no network.
 */

import profileRegistrySchema from '../schemas/profile-registry.schema.json' with { type: 'json' };
import runIdentitySchema from '../schemas/run-identity.schema.json' with { type: 'json' };

export { profileRegistrySchema, runIdentitySchema };

export {
  ISSUE_CODES,
  issue,
  sortIssues,
  validateRegistry,
  validateRequest,
  validateHostManifest,
  validateRunIdentity,
  validateIdentityEnvelope,
  type IssueCode,
  type Validated,
} from './schema.ts';

export { resolveProfiles } from './inheritance.ts';

export {
  revisionOf,
  registryRevisionOf,
  hostManifestRevisionOf,
  identityIdOf,
} from './identity.ts';

export { resolveProfile, type ResolveInput } from './resolve.ts';

export type {
  BudgetCeilings,
  Candidate,
  Capability,
  ComponentRef,
  ComponentRevision,
  ContentRevision,
  CredentialSlotStatus,
  EffectiveEmbedding,
  EffectiveRole,
  HostManifest,
  IdentityEnvelope,
  InferenceControls,
  Issue,
  LegacyWireState,
  ProfileRegistry,
  ProfileRequest,
  Resolution,
  RoleOverride,
  RoleSpec,
  RootProfile,
  RowIdentityRef,
  RunIdentity,
  ToolManifest,
} from './contracts.gen.ts';
