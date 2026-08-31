/**
 * Document validation as values.
 *
 * The JSON Schemas under `schemas/` are the gate: every registry,
 * request, host manifest and identity envelope passes the suite
 * validator — including the `$query` cross-field assertions — before
 * anything treats it as configuration. This module owns the ONE
 * validator instance per schema and turns validator errors into the
 * stable `TCFG1xxx` issue vocabulary, attributing a `$query` refusal to
 * the duplicate, ghost reference or kind mismatch that caused it so a
 * caller gets `{ code, path, detail }` instead of "an assertion failed
 * somewhere".
 *
 * The attribution diagnostics NEVER decide validity — the schema does.
 * They only name what the schema already refused; when none of them
 * matches, the refusal is reported as the invalid-document code with
 * the validator's own path and message.
 */

import { JarenValidator } from '@jarenjs/validate';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';

import profileRegistrySchema from '../schemas/profile-registry.schema.json' with { type: 'json' };
import runIdentitySchema from '../schemas/run-identity.schema.json' with { type: 'json' };
import type { HostManifest, IdentityEnvelope, Issue, ProfileRegistry, ProfileRequest, RunIdentity } from './contracts.gen.ts';

export { profileRegistrySchema, runIdentitySchema };

/** The stable issue codes, with the meaning each is pinned to. */
export const ISSUE_CODES = {
  TCFG1001: 'unknown capability tag',
  TCFG1002: 'unknown inheritance parent',
  TCFG1003: 'profile inheritance cycle',
  TCFG1004: 'duplicate identifier',
  TCFG1005: 'unresolvable reference',
  TCFG1006: 'role/candidate kind mismatch',
  TCFG1007: 'invalid document',
  TCFG1008: 'credential slot unavailable',
  TCFG1009: 'provider or model unavailable on this host',
  TCFG1010: 'required provider feature unavailable',
  TCFG1011: 'required tool unavailable',
  TCFG1012: 'embedding identity disagreement',
  TCFG1013: 'credential-bearing URL',
  TCFG1014: 'secret-shaped member',
  TCFG1015: 'no available candidate for the requested tag',
  TCFG1016: 'profile attempts to raise a host ceiling',
  TCFG1017: 'component unavailable at the referenced revision',
  TCFG1018: 'row references no identity',
  TCFG1019: 'registry revision mismatch',
  TCFG1020: 'invalid role override',
  TCFG1021: 'incomplete wire request',
} as const;

export type IssueCode = keyof typeof ISSUE_CODES;

/** A refusal outcome or a validated, deeply frozen document. */
export type Validated<T> = { ok: true, value: T } | { ok: false, issues: Issue[] };

export function issue(code: IssueCode, path: string, detail: string): Issue {
  return { code, path, detail };
}

/** Sort refusals so equal inputs always produce equal outputs. */
export function sortIssues(issues: Issue[]): Issue[] {
  return issues.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const SECRET_MEMBER = /key|token|secret|password|credential|bearer/i;

interface ValidatorError {
  keyword?: string;
  instancePath?: string;
  message?: string;
  params?: { additionalProperty?: string, pattern?: string };
}

function compile(schema: object, refs: readonly object[] = []): (value: unknown) => { valid: boolean, errors?: ValidatorError[] } {
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  if (refs.length > 0) validator.addSchema(refs as Record<string, unknown>[]);
  const validate = validator.compile(schema as Record<string, unknown>);
  return (value) => validate(value) as { valid: boolean, errors?: ValidatorError[] };
}

const registryValidator = compile(profileRegistrySchema as object);
const identityValidator = compile(runIdentitySchema as object);
const requestValidator = compile(
  { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/profileRequest' },
  [runIdentitySchema as object],
);
const hostValidator = compile(
  { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/hostManifest' },
  [runIdentitySchema as object],
);
const envelopeValidator = compile(
  { $ref: 'https://tangleai.dev/schemas/run-identity#/$defs/identityEnvelope' },
  [runIdentitySchema as object],
);

/** One validator error, attributed to its stable code. */
function attributeError(error: ValidatorError): Issue {
  const path = error.instancePath ?? '';
  if (error.keyword === 'additionalProperties') {
    const member = error.params?.additionalProperty ?? '';
    if (SECRET_MEMBER.test(member)) {
      return issue('TCFG1014', path, `undeclared member '${member}' is secret-shaped; a credential value has no place in a validated document`);
    }
    return issue('TCFG1007', path, `undeclared member '${member}'`);
  }
  if (error.keyword === 'pattern' && /url|base/i.test(path)) {
    return issue('TCFG1013', path, 'a base URL must carry no userinfo, query or fragment');
  }
  return issue('TCFG1007', path, error.message ?? 'the document does not validate');
}

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) out.push(value);
    seen.add(value);
  }
  return out;
}

/**
 * Name what the registry schema's `$query` refused: duplicates, ghost
 * references and kind mismatches, each with the precise code the
 * campaign pins. Purely diagnostic — validity was already decided.
 */
function registryDiagnostics(registry: ProfileRegistry): Issue[] {
  const issues: Issue[] = [];
  const collections: Array<[string, readonly string[]]> = [
    ['/credentialSlots', registry.credentialSlots],
    ['/candidates', registry.candidates.map((c) => c.id)],
    ['/capabilities', registry.capabilities.map((c) => c.tag)],
    ['/prompts', registry.prompts.map((p) => p.id)],
    ['/responseSchemas', registry.responseSchemas.map((s) => s.id)],
    ['/components', registry.components.map((c) => c.id)],
    ['/inference', registry.inference.map((i) => i.id)],
    ['/budgets', registry.budgets.map((b) => b.id)],
    ['/profiles', registry.profiles.map((p) => p.id)],
  ];
  for (const [path, values] of collections) {
    for (const dup of duplicatesOf(values)) issues.push(issue('TCFG1004', path, `'${dup}' is declared more than once`));
  }

  const candidateIds = new Set(registry.candidates.map((c) => c.id));
  const chatIds = new Set(registry.candidates.filter((c) => c.kind === 'chat').map((c) => c.id));
  const embeddingIds = new Set(registry.candidates.filter((c) => c.kind === 'embedding').map((c) => c.id));
  const tags = new Set(registry.capabilities.map((c) => c.tag));
  const promptIds = new Set(registry.prompts.map((p) => p.id));
  const schemaIds = new Set(registry.responseSchemas.map((s) => s.id));
  const policyIds = new Set(registry.components.filter((c) => c.kind === 'policy').map((c) => c.id));
  const rankerIds = new Set(registry.components.filter((c) => c.kind === 'ranker').map((c) => c.id));
  const inferenceIds = new Set(registry.inference.map((i) => i.id));
  const budgetIds = new Set(registry.budgets.map((b) => b.id));
  const profileIds = new Set(registry.profiles.map((p) => p.id));
  const slots = new Set(registry.credentialSlots);

  registry.capabilities.forEach((capability, index) => {
    capability.candidates.forEach((ref, refIndex) => {
      if (!candidateIds.has(ref.candidate)) {
        issues.push(issue('TCFG1005', `/capabilities/${index}/candidates/${refIndex}/candidate`, `'${ref.candidate}' names no candidate`));
      }
    });
  });
  registry.candidates.forEach((candidate, index) => {
    if (candidate.credentialSlot !== null && !slots.has(candidate.credentialSlot)) {
      issues.push(issue('TCFG1005', `/candidates/${index}/credentialSlot`, `'${candidate.credentialSlot}' names no declared credential slot`));
    }
  });
  registry.profiles.forEach((profile, index) => {
    if (profile.kind === 'child') {
      if (!profileIds.has(profile.extends)) {
        issues.push(issue('TCFG1002', `/profiles/${index}/extends`, `'${profile.extends}' names no profile`));
      }
      return;
    }
    if (!embeddingIds.has(profile.embedding)) {
      const code = chatIds.has(profile.embedding) ? 'TCFG1006' : 'TCFG1005';
      issues.push(issue(code, `/profiles/${index}/embedding`, `'${profile.embedding}' is not an embedding candidate`));
    }
    if (profile.policyComponent !== null && !policyIds.has(profile.policyComponent)) {
      const code = rankerIds.has(profile.policyComponent) ? 'TCFG1006' : 'TCFG1005';
      issues.push(issue(code, `/profiles/${index}/policyComponent`, `'${profile.policyComponent}' is not a policy component`));
    }
    if (profile.budget !== null && !budgetIds.has(profile.budget)) {
      issues.push(issue('TCFG1005', `/profiles/${index}/budget`, `'${profile.budget}' names no budget preset`));
    }
    for (const [roleName, role] of Object.entries(profile.roles)) {
      const at = `/profiles/${index}/roles/${roleName}`;
      if (role.capability !== null && !tags.has(role.capability)) {
        issues.push(issue('TCFG1001', `${at}/capability`, `'${role.capability}' names no capability tag`));
      }
      if (role.candidate !== null && !chatIds.has(role.candidate)) {
        const code = embeddingIds.has(role.candidate) ? 'TCFG1006' : 'TCFG1005';
        issues.push(issue(code, `${at}/candidate`, `'${role.candidate}' is not a chat candidate`));
      }
      if ((role.capability === null) === (role.candidate === null)) {
        issues.push(issue('TCFG1007', at, 'a role names exactly one of a capability tag or a pinned candidate'));
      }
      if (role.prompt !== null && !promptIds.has(role.prompt)) {
        issues.push(issue('TCFG1005', `${at}/prompt`, `'${role.prompt}' names no prompt`));
      }
      if (role.responseSchema !== null && !schemaIds.has(role.responseSchema)) {
        issues.push(issue('TCFG1005', `${at}/responseSchema`, `'${role.responseSchema}' names no response schema`));
      }
      if (role.inference !== null && !inferenceIds.has(role.inference)) {
        issues.push(issue('TCFG1005', `${at}/inference`, `'${role.inference}' names no inference preset`));
      }
      if (role.ranker !== null && !rankerIds.has(role.ranker)) {
        const code = policyIds.has(role.ranker) ? 'TCFG1006' : 'TCFG1005';
        issues.push(issue(code, `${at}/ranker`, `'${role.ranker}' is not a ranker component`));
      }
    }
  });
  return issues;
}

function refuse(errors: ValidatorError[] | undefined, diagnostics: Issue[] = []): { ok: false, issues: Issue[] } {
  const attributed = (errors ?? []).map(attributeError);
  const queryRefused = (errors ?? []).some((error) => error.keyword === '$query');
  const kept = queryRefused && diagnostics.length > 0
    ? [...attributed.filter((item) => item.code !== 'TCFG1007' || !item.detail.includes('$query')), ...diagnostics]
    : attributed;
  const unique = new Map(kept.map((item) => [`${item.code} ${item.path} ${item.detail}`, item]));
  return { ok: false, issues: sortIssues([...unique.values()]) };
}

/** Validate a registry document; the value comes back deeply frozen. */
export function validateRegistry(value: unknown): Validated<ProfileRegistry> {
  const outcome = registryValidator(value);
  if (!outcome.valid) {
    const structurally = typeof value === 'object' && value !== null;
    const diagnostics = structurally ? safeDiagnostics(value as ProfileRegistry) : [];
    return refuse(outcome.errors, diagnostics);
  }
  return { ok: true, value: deepFreeze(cloneJson(value)) as ProfileRegistry };
}

/** Diagnostics over a document that failed the schema — every member may be missing. */
function safeDiagnostics(registry: ProfileRegistry): Issue[] {
  try {
    return registryDiagnostics({
      version: 1,
      credentialSlots: registry.credentialSlots ?? [],
      candidates: registry.candidates ?? [],
      capabilities: registry.capabilities ?? [],
      prompts: registry.prompts ?? [],
      responseSchemas: registry.responseSchemas ?? [],
      components: registry.components ?? [],
      inference: registry.inference ?? [],
      budgets: registry.budgets ?? [],
      profiles: registry.profiles ?? [],
    });
  } catch {
    return [];
  }
}

export function validateRequest(value: unknown): Validated<ProfileRequest> {
  const outcome = requestValidator(value);
  if (!outcome.valid) return refuse(outcome.errors);
  return { ok: true, value: deepFreeze(cloneJson(value)) as ProfileRequest };
}

export function validateHostManifest(value: unknown): Validated<HostManifest> {
  const outcome = hostValidator(value);
  if (!outcome.valid) return refuse(outcome.errors);
  return { ok: true, value: deepFreeze(cloneJson(value)) as HostManifest };
}

export function validateRunIdentity(value: unknown): Validated<RunIdentity> {
  const outcome = identityValidator(value);
  if (!outcome.valid) return refuse(outcome.errors);
  return { ok: true, value: deepFreeze(cloneJson(value)) as RunIdentity };
}

/** Validate an identity envelope; a dangling run row is the pinned refusal. */
export function validateIdentityEnvelope(value: unknown): Validated<IdentityEnvelope> {
  const outcome = envelopeValidator(value);
  if (!outcome.valid) {
    const refused = refuse(outcome.errors);
    const envelope = value as IdentityEnvelope;
    if (Array.isArray(envelope?.identities) && Array.isArray(envelope?.rows)) {
      const known = new Set(envelope.identities.map((identity) => identity?.identityId));
      envelope.rows.forEach((row, index) => {
        if (row !== null && typeof row === 'object' && row.identityStatus === 'run' && !known.has(row.identityId)) {
          refused.issues.push(issue('TCFG1018', `/rows/${index}/identityId`, `'${String(row.identityId).slice(0, 12)}…' resolves to no identity in the table`));
        }
      });
      sortIssues(refused.issues);
    }
    return refused;
  }
  return { ok: true, value: deepFreeze(cloneJson(value)) as IdentityEnvelope };
}
