/**
 * Pure profile resolution — documents in, an immutable identity or
 * stable issues out.
 *
 * The resolver reads no environment, no settings database, no network
 * and creates no client: it consumes a validated registry, a request
 * and a credential-free host manifest, and every fact it uses is in
 * those three documents. The promise it returns exists only because the
 * suite's canonical SHA-256 is asynchronous.
 *
 * Selection is deterministic: a tag's candidates are filtered by host
 * availability and ordered by declared priority then candidate id, so
 * host iteration order cannot matter and two calls over equal inputs
 * are deeply equal. Nothing here falls back: a pinned candidate the
 * host cannot serve, an exhausted tag, a missing required tool, a
 * dimension disagreement or a ceiling raise is an issue value — never a
 * silent substitute, never the legacy or offline behavior, which only
 * the genuinely unconfigured legacy request keeps.
 */

import { sameIdentity } from '@tangleai/context/ledger';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';

import type {
  BudgetCeilings,
  Candidate,
  EffectiveEmbedding,
  EffectiveRole,
  HostManifest,
  InferenceControls,
  Issue,
  ProfileRegistry,
  ProfileRequest,
  Resolution,
  RoleOverride,
  RoleSpec,
  RootProfile,
  RunIdentity,
} from './contracts.gen.ts';
import { resolveProfiles } from './inheritance.ts';
import { hostManifestRevisionOf, identityIdOf, registryRevisionOf } from './identity.ts';
import { issue, sortIssues, validateHostManifest, validateRegistry, validateRequest } from './schema.ts';

export interface ResolveInput {
  registry: unknown;
  request: unknown;
  host: unknown;
}

interface Refusal {
  ok: false;
  issues: Issue[];
}

const refuse = (issues: Issue[]): Refusal => deepFreeze(cloneJson({ ok: false, issues: sortIssues(issues) })) as Refusal;

// ---------------------------------------------------------------------------
// availability — every reason a candidate cannot serve, as issues
// ---------------------------------------------------------------------------

interface ChatAvailability {
  ok: boolean;
  base: string;
  issues: Issue[];
}

function chatAvailability(candidate: Candidate, host: HostManifest, path: string): ChatAvailability {
  const issues: Issue[] = [];
  const entry = host.providers.find((provider) => provider.provider === candidate.provider);
  if (entry === undefined) {
    return { ok: false, base: '', issues: [issue('TCFG1009', path, `provider '${candidate.provider}' is not available on this host`)] };
  }
  let base = entry.base;
  if (candidate.baseUrl !== null && candidate.baseUrl !== entry.base) {
    issues.push(issue('TCFG1009', path, `the host serves '${candidate.provider}' at a different base than the candidate declares`));
  } else if (candidate.baseUrl !== null) {
    base = candidate.baseUrl;
  }
  if (entry.models !== null && !entry.models.includes(candidate.model)) {
    issues.push(issue('TCFG1009', path, `model '${candidate.model}' is not offered by the host's '${candidate.provider}' endpoint`));
  }
  for (const feature of candidate.features) {
    if (!entry.features.includes(feature)) {
      issues.push(issue('TCFG1010', path, `required feature '${feature}' is not available on the host's '${candidate.provider}' endpoint`));
    }
  }
  if (candidate.credentialSlot !== null) {
    const slot = host.credentialSlots.find((status) => status.name === candidate.credentialSlot);
    if (slot === undefined || !slot.configured) {
      issues.push(issue('TCFG1008', path, `credential slot '${candidate.credentialSlot}' is not configured on this host`));
    }
  }
  return { ok: issues.length === 0, base, issues };
}

interface EmbeddingAvailability {
  ok: boolean;
  embedding: EffectiveEmbedding | null;
  issues: Issue[];
}

function embeddingAvailability(candidate: Candidate, host: HostManifest, path: string): EmbeddingAvailability {
  const entry = host.embedding.find((item) => item.provider === candidate.provider && item.model === candidate.model);
  if (entry === undefined) {
    return { ok: false, embedding: null, issues: [issue('TCFG1009', path, `embedding '${candidate.provider}/${candidate.model}' is not available on this host`)] };
  }
  const issues: Issue[] = [];
  if (candidate.provider !== 'builtin' && candidate.credentialSlot !== null) {
    const slot = host.credentialSlots.find((status) => status.name === candidate.credentialSlot);
    if (slot === undefined || !slot.configured) {
      issues.push(issue('TCFG1008', path, `credential slot '${candidate.credentialSlot}' is not configured on this host`));
    }
  }
  const dims = candidate.dims as number;
  if (entry.dims === null) {
    issues.push(issue('TCFG1012', path, `the host has not observed a width for '${candidate.model}'; an identity is final only after a probe or reply confirms the registry's ${dims} dimensions`));
  } else if (!sameIdentity({ model: candidate.model, dims }, { model: entry.model, dims: entry.dims })) {
    issues.push(issue('TCFG1012', path, `the registry declares ${dims} dimensions for '${candidate.model}' and the host observed ${entry.dims}; disagreement refuses before indexed work`));
  }
  if (issues.length > 0) return { ok: false, embedding: null, issues };
  return {
    ok: true,
    embedding: {
      provider: candidate.provider as EffectiveEmbedding['provider'],
      base: candidate.provider === 'builtin' ? null : entry.base,
      model: candidate.model,
      dims,
      credentialSlot: candidate.credentialSlot,
    },
    issues: [],
  };
}

// ---------------------------------------------------------------------------
// role materialization
// ---------------------------------------------------------------------------

function inferenceOf(registry: ProfileRegistry, id: string | null): InferenceControls {
  const preset = id === null ? undefined : registry.inference.find((item) => item.id === id);
  return {
    temperature: preset?.temperature ?? null,
    maxTokens: preset?.maxTokens ?? null,
    ...(preset?.maxTokensField === undefined ? {} : { maxTokensField: preset.maxTokensField }),
    retry: preset?.retry === undefined || preset.retry === null ? null : { ...preset.retry },
    reasoning: preset?.reasoning === undefined || preset.reasoning === null ? null : { ...preset.reasoning },
  };
}

function applyOverride(role: RoleSpec, override: RoleOverride, path: string, issues: Issue[]): RoleSpec {
  const next: RoleSpec = { ...role, tools: [...role.tools] };
  if (override.capability !== undefined && override.capability !== null) {
    next.capability = override.capability;
    next.candidate = override.candidate !== undefined ? override.candidate : null;
  }
  if (override.candidate !== undefined && override.candidate !== null) {
    next.candidate = override.candidate;
    if (override.capability === undefined || override.capability === null) next.capability = null;
  }
  if ((next.capability === null) === (next.candidate === null)) {
    issues.push(issue('TCFG1020', path, 'an override must leave the role with exactly one of a capability tag or a pinned candidate'));
  }
  if (override.prompt !== undefined) next.prompt = override.prompt;
  if (override.responseSchema !== undefined) next.responseSchema = override.responseSchema;
  if (override.tools !== undefined) next.tools = [...override.tools];
  if (override.toolsRequired !== undefined) next.toolsRequired = override.toolsRequired;
  if (override.inference !== undefined) next.inference = override.inference;
  if (override.ranker !== undefined) next.ranker = override.ranker;
  return next;
}

interface RoleResolution {
  role: EffectiveRole | null;
  ranker: string | null;
  issues: Issue[];
}

function resolveRole(
  registry: ProfileRegistry,
  host: HostManifest,
  roleName: string,
  spec: RoleSpec,
  path: string,
): RoleResolution {
  const issues: Issue[] = [];

  let selected: Candidate | null = null;
  let base = '';
  if (spec.candidate !== null) {
    const candidate = registry.candidates.find((item) => item.id === spec.candidate) as Candidate;
    const availability = chatAvailability(candidate, host, `${path}/candidate`);
    if (!availability.ok) {
      issues.push(...availability.issues);
    } else {
      selected = candidate;
      base = availability.base;
    }
  } else {
    const tag = registry.capabilities.find((item) => item.tag === spec.capability);
    if (tag === undefined) {
      issues.push(issue('TCFG1001', `${path}/capability`, `'${spec.capability}' names no capability tag`));
    } else {
      const ordered = [...tag.candidates].sort((a, b) => a.priority - b.priority || (a.candidate < b.candidate ? -1 : a.candidate > b.candidate ? 1 : 0));
      const reasons: string[] = [];
      for (const ref of ordered) {
        const candidate = registry.candidates.find((item) => item.id === ref.candidate) as Candidate;
        if (candidate.kind !== 'chat') continue;
        const availability = chatAvailability(candidate, host, `${path}/capability`);
        if (availability.ok) {
          selected = candidate;
          base = availability.base;
          break;
        }
        reasons.push(`${candidate.id}: ${availability.issues.map((item) => item.detail).join('; ')}`);
      }
      if (selected === null && issues.length === 0) {
        issues.push(issue('TCFG1015', `${path}/capability`, `no candidate of tag '${tag.tag}' is available on this host — ${reasons.join(' | ')}`));
      }
    }
  }

  const requested = [...new Set(spec.tools)].sort();
  const effectiveTools: Array<{ name: string, inputSchemaRevision: string }> = [];
  const missing: string[] = [];
  for (const name of requested) {
    const tool = host.tools.find((item) => item.name === name);
    if (tool === undefined) missing.push(name);
    else effectiveTools.push({ name: tool.name, inputSchemaRevision: tool.inputSchemaRevision });
  }
  if (spec.toolsRequired && missing.length > 0) {
    issues.push(issue('TCFG1011', `${path}/tools`, `required tools are not on the host allowlist: ${missing.join(', ')}`));
  }

  let rankerRef: string | null = spec.ranker;
  if (issues.length > 0 || selected === null) return { role: null, ranker: rankerRef, issues };

  const prompt = spec.prompt === null ? null : registry.prompts.find((item) => item.id === spec.prompt) ?? null;
  const responseSchema = spec.responseSchema === null ? null : registry.responseSchemas.find((item) => item.id === spec.responseSchema) ?? null;

  const role: EffectiveRole = {
    provider: selected.provider as EffectiveRole['provider'],
    base,
    model: selected.model,
    credentialSlot: selected.credentialSlot,
    inference: inferenceOf(registry, spec.inference),
    prompt: prompt === null ? null : { id: prompt.id, revision: prompt.revision },
    responseSchema: responseSchema === null ? null : { id: responseSchema.id, revision: responseSchema.revision },
    tools: { requested, effective: effectiveTools },
    rateCard: selected.rateCard === null ? null : { ...selected.rateCard },
  };
  return { role, ranker: rankerRef, issues: [] };
}

// ---------------------------------------------------------------------------
// budget
// ---------------------------------------------------------------------------

const BUDGET_DIMENSIONS = ['maxCalls', 'maxTokens', 'maxMs', 'maxConcurrency'] as const;

function resolveBudget(
  requested: BudgetCeilings | null,
  host: BudgetCeilings,
  path: string,
  issues: Issue[],
): BudgetCeilings {
  const effective: BudgetCeilings = { maxCalls: null, maxTokens: null, maxMs: null, maxConcurrency: null };
  for (const dimension of BUDGET_DIMENSIONS) {
    const ceiling = host[dimension];
    const asked = requested === null ? null : requested[dimension];
    if (asked === null) {
      effective[dimension] = ceiling;
    } else if (ceiling !== null && asked > ceiling) {
      issues.push(issue('TCFG1016', `${path}/${dimension}`, `the profile asks for ${asked} and the host's hard ceiling is ${ceiling}; a profile may lower a ceiling and can never raise one`));
    } else {
      effective[dimension] = asked;
    }
  }
  return effective;
}

// ---------------------------------------------------------------------------
// the resolver
// ---------------------------------------------------------------------------

/**
 * Resolve `{ registry, request, host }` to `{ ok: true, identity }` or
 * `{ ok: false, issues }`. The returned graph is deeply frozen and
 * shares no mutable reference with the inputs.
 */
export async function resolveProfile(input: ResolveInput): Promise<Resolution> {
  const registryOutcome = validateRegistry(input.registry);
  const requestOutcome = validateRequest(input.request);
  const hostOutcome = validateHostManifest(input.host);
  const entryIssues: Issue[] = [
    ...(registryOutcome.ok ? [] : registryOutcome.issues),
    ...(requestOutcome.ok ? [] : requestOutcome.issues),
    ...(hostOutcome.ok ? [] : hostOutcome.issues),
  ];
  if (!registryOutcome.ok || !requestOutcome.ok || !hostOutcome.ok) return refuse(entryIssues);

  const registry = registryOutcome.value;
  const request = requestOutcome.value;
  const host = hostOutcome.value;

  const profilesOutcome = resolveProfiles(registry);
  if (!profilesOutcome.ok) return refuse([...profilesOutcome.issues]);
  const profiles = profilesOutcome.value;

  const issues: Issue[] = [];
  const roles: Record<string, EffectiveRole> = {};
  let embedding: EffectiveEmbedding | null = null;
  let policy: RunIdentity['components']['policy'] = null;
  let ranker: RunIdentity['components']['ranker'] = null;
  let budget: BudgetCeilings = { ...host.budget };
  let registryRevision: string | null = null;

  if (request.kind === 'legacy') {
    if (request.chat.state === 'incomplete') {
      issues.push(issue('TCFG1021', '/chat', `the chat wire request is incomplete — missing ${request.chat.missing.join(', ')}; it is refused rather than silently becoming another model`));
    }
    if (request.embed.state === 'incomplete') {
      issues.push(issue('TCFG1021', '/embed', `the embedding wire request is incomplete — missing ${request.embed.missing.join(', ')}; it is refused rather than silently becoming the built-in`));
    }
    if (request.chat.state === 'configured') {
      const entry = host.providers.find((provider) => provider.provider === (request.chat as { provider: string }).provider);
      if (entry === undefined) {
        issues.push(issue('TCFG1009', '/chat/provider', `provider '${request.chat.provider}' is not available on this host`));
      } else if (request.chat.baseUrl !== null && request.chat.baseUrl !== entry.base) {
        issues.push(issue('TCFG1009', '/chat/baseUrl', `the host serves '${request.chat.provider}' at a different base than the request declares`));
      } else {
        roles.chat = {
          provider: request.chat.provider,
          base: request.chat.baseUrl ?? entry.base,
          model: request.chat.model,
          credentialSlot: request.chat.credentialSlot,
          inference: request.chat.inference ?? inferenceOf(registry, null),
          prompt: request.chatPrompt,
          responseSchema: null,
          tools: { requested: [], effective: [] },
          rateCard: null,
        };
      }
    }
    const wantBuiltin = request.embed.state === 'unconfigured';
    if (wantBuiltin) {
      const entry = host.embedding.find((item) => item.provider === 'builtin');
      if (entry === undefined || entry.dims === null) {
        issues.push(issue('TCFG1009', '/embed', 'the host declares no built-in embedding identity'));
      } else {
        embedding = { provider: 'builtin', base: null, model: entry.model, dims: entry.dims, credentialSlot: null };
      }
    } else if (request.embed.state === 'configured-unproven') {
      // the wire was configured and no work of this run observed its
      // width: the stack claims NO embedding identity rather than
      // guessing one, and zero vectors exist under it
      embedding = null;
    } else if (request.embed.state === 'configured') {
      const wire = request.embed;
      const entry = host.embedding.find((item) => item.provider === wire.provider && item.model === wire.model);
      if (entry === undefined) {
        issues.push(issue('TCFG1009', '/embed', `embedding '${wire.provider}/${wire.model}' is not available on this host`));
      } else if (entry.dims === null) {
        issues.push(issue('TCFG1012', '/embed', `the host has not observed a width for '${wire.model}'; the identity stays provisional until a probe or reply proves it`));
      } else {
        embedding = { provider: wire.provider, base: entry.base, model: wire.model, dims: entry.dims, credentialSlot: wire.credentialSlot };
      }
    }
    policy = request.components.policy === null ? null : { ...request.components.policy };
    ranker = request.components.ranker === null ? null : { ...request.components.ranker };
  } else {
    registryRevision = await registryRevisionOf(registry);
    let profile: RootProfile | null = null;
    let overrides: Record<string, RoleOverride> | null = null;

    if (request.kind === 'profile') {
      profile = profiles.get(request.profile) ?? null;
      if (profile === null) issues.push(issue('TCFG1005', '/profile', `'${request.profile}' names no profile`));
      overrides = request.overrides;
    } else {
      const tag = registry.capabilities.find((item) => item.tag === request.tag);
      if (tag === undefined) {
        issues.push(issue('TCFG1001', '/tag', `'${request.tag}' names no capability tag`));
      } else {
        const firstEmbedding = registry.candidates
          .filter((candidate) => candidate.kind === 'embedding')
          .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        if (firstEmbedding === undefined) {
          issues.push(issue('TCFG1015', '/tag', 'the registry declares no embedding candidate to complete a tag request'));
        } else {
          profile = {
            id: request.tag,
            kind: 'root',
            description: `tag request '${request.tag}'`,
            roles: {
              chat: {
                capability: request.tag,
                candidate: null,
                prompt: null,
                responseSchema: null,
                tools: [],
                toolsRequired: false,
                inference: null,
                ranker: null,
              },
            },
            embedding: firstEmbedding.id,
            policyComponent: null,
            budget: null,
          };
        }
      }
      overrides = request.overrides;
    }

    if (profile !== null) {
      const specs: Record<string, RoleSpec> = {};
      for (const [roleName, spec] of Object.entries(profile.roles)) specs[roleName] = spec;
      if (overrides !== null) {
        for (const [roleName, override] of Object.entries(overrides)) {
          if (specs[roleName] === undefined) {
            issues.push(issue('TCFG1020', `/overrides/${roleName}`, `'${roleName}' names no role of the requested profile`));
            continue;
          }
          specs[roleName] = applyOverride(specs[roleName], override, `/overrides/${roleName}`, issues);
        }
      }

      // overrides may introduce references the profile did not carry
      for (const [roleName, spec] of Object.entries(specs)) {
        const resolved = resolveRole(registry, host, roleName, spec, `/roles/${roleName}`);
        issues.push(...resolved.issues);
        if (resolved.role !== null) roles[roleName] = resolved.role;
      }

      const rankers = new Map<string, string>();
      for (const spec of Object.values(specs)) {
        if (spec.ranker !== null) {
          const component = registry.components.find((item) => item.id === spec.ranker);
          if (component !== undefined) rankers.set(component.id, component.revision);
        }
      }
      if (rankers.size > 1) {
        issues.push(issue('TCFG1007', '/roles', `roles reference ${rankers.size} different rankers; a run resolves one`));
      } else if (rankers.size === 1) {
        const [id, revision] = [...rankers.entries()][0];
        const hostComponent = host.components.find((item) => item.id === id);
        if (hostComponent === undefined || hostComponent.revision !== revision) {
          issues.push(issue('TCFG1017', '/roles', `ranker '${id}' at revision ${revision.slice(0, 12)}… is not installed on this host`));
        } else {
          ranker = { id, revision };
        }
      }

      if (profile.policyComponent !== null) {
        const component = registry.components.find((item) => item.id === profile.policyComponent);
        if (component !== undefined) {
          const hostComponent = host.components.find((item) => item.id === component.id);
          if (hostComponent === undefined || hostComponent.revision !== component.revision) {
            issues.push(issue('TCFG1017', '/policyComponent', `policy component '${component.id}' at revision ${component.revision.slice(0, 12)}… is not installed on this host`));
          } else {
            policy = { id: component.id, revision: component.revision };
          }
        }
      }

      const embeddingCandidate = registry.candidates.find((item) => item.id === profile.embedding) as Candidate;
      const availability = embeddingAvailability(embeddingCandidate, host, '/embedding');
      issues.push(...availability.issues);
      if (availability.embedding !== null) embedding = availability.embedding;

      const budgetPreset = profile.budget === null ? null : registry.budgets.find((item) => item.id === profile.budget) ?? null;
      budget = resolveBudget(budgetPreset, host.budget, '/budget', issues);
    }
  }

  if (issues.length > 0) return refuse(issues);
  const unproven = request.kind === 'legacy' && request.embed.state === 'configured-unproven';
  if (embedding === null && !unproven) throw new Error('resolver bug: an ok resolution reached assembly without an embedding identity');

  const orderedRoles: Record<string, EffectiveRole> = {};
  for (const roleName of Object.keys(roles).sort()) orderedRoles[roleName] = roles[roleName];

  const body: Omit<RunIdentity, 'identityId'> = {
    registryRevision,
    hostManifestRevision: await hostManifestRevisionOf(host),
    requested: cloneJson(request) as ProfileRequest,
    roles: orderedRoles,
    embedding,
    components: { policy, ranker },
    budget,
  };
  const identity: RunIdentity = { identityId: await identityIdOf(body), ...body };
  return deepFreeze(cloneJson({ ok: true, identity })) as Resolution;
}
