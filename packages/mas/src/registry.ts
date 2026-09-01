/**
 * Registry snapshots — immutable validated capability data.
 *
 * `createMasRegistrySnapshot` validates the document shape, recomputes
 * every content address it carries (role instruction revisions, tool
 * input-schema revisions, embedded template and subgraph version ids),
 * deep-freezes the result and returns it with its canonical revision.
 * Snapshots hold capability DESCRIPTIONS and immutable references —
 * never a function, credential or mutable global. Host registries bind
 * functions to these ids only after a snapshot validates, and the
 * runtime compiler refuses a binding whose id or revision differs from
 * the pinned snapshot.
 */

import { deepFreeze, cloneJson } from '@jarenjs/core/object';

import { masIssue, refuse, type MasValidated } from './errors.ts';
import { masRegistryRevisionOf, masRevisionOf, masTemplateVersionIdOf, masWorkflowVersionIdOf } from './identity.ts';
import { validateRegistryShape, validateTemplateShape, validateWorkflowShape } from './schema.ts';
import type { MasRegistry, MasWorkflow } from './contracts.gen.ts';

export interface MasRegistrySnapshot {
  revision: string;
  document: MasRegistry;
  /** Embedded subgraph workflows by id, shape-validated with recomputed versions. */
  subgraphs: ReadonlyMap<string, MasWorkflow>;
}

/** Registry sections are sets: the canonical document orders each by id. */
function canonicalizeSections(document: MasRegistry): MasRegistry {
  const byId = <T extends { id: string }>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    ...document,
    roles: byId(document.roles),
    handlers: byId(document.handlers),
    tools: byId(document.tools),
    messageAdapters: byId(document.messageAdapters),
    contextAdapters: byId(document.contextAdapters),
    templates: byId(document.templates),
    subgraphs: byId(document.subgraphs),
  };
}

export async function createMasRegistrySnapshot(value: unknown): Promise<MasValidated<MasRegistrySnapshot>> {
  const shape = validateRegistryShape(value);
  if (!shape.valid) return shape;
  const document = canonicalizeSections(shape.value);
  const issues = [];

  for (const [index, role] of document.roles.entries()) {
    const recomputed = await masRevisionOf(role.instructions);
    if (recomputed !== role.instructionsRevision) {
      issues.push(masIssue('TMAS1002', `/roles/${index}/instructionsRevision`, `'${role.id}' does not hash to its claimed instructions revision`));
    }
  }
  for (const [index, tool] of document.tools.entries()) {
    const recomputed = await masRevisionOf(tool.input);
    if (recomputed !== tool.inputRevision) {
      issues.push(masIssue('TMAS1002', `/tools/${index}/inputRevision`, `'${tool.id}' does not hash to its claimed input schema revision`));
    }
  }

  const subgraphs = new Map<string, MasWorkflow>();
  for (const [index, entry] of document.subgraphs.entries()) {
    const workflowShape = validateWorkflowShape(entry.workflow);
    if (!workflowShape.valid) {
      for (const issue of workflowShape.issues) {
        issues.push(masIssue('TMAS1001', `/subgraphs/${index}/workflow${issue.path}`, issue.detail));
      }
      continue;
    }
    const workflow = workflowShape.value;
    const recomputed = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
    if (recomputed !== workflow.versionId || workflow.versionId !== entry.versionId) {
      issues.push(masIssue('TMAS1002', `/subgraphs/${index}/versionId`, `'${entry.id}' does not recompute to its claimed workflow version`));
      continue;
    }
    subgraphs.set(entry.id, workflow);
  }

  for (const [index, entry] of document.templates.entries()) {
    const templateShape = validateTemplateShape(entry.template);
    if (!templateShape.valid) {
      for (const issue of templateShape.issues) {
        issues.push(masIssue('TMAS1001', `/templates/${index}/template${issue.path}`, issue.detail));
      }
      continue;
    }
    const recomputed = await masTemplateVersionIdOf(templateShape.value as unknown as Record<string, unknown>);
    if (recomputed !== templateShape.value.versionId || templateShape.value.versionId !== entry.versionId) {
      issues.push(masIssue('TMAS1002', `/templates/${index}/versionId`, `'${entry.id}' does not recompute to its claimed template version`));
    }
  }

  if (issues.length > 0) return refuse(issues);
  const revision = await masRegistryRevisionOf(document as unknown as Record<string, unknown>);
  return {
    valid: true,
    value: deepFreeze({ revision, document, subgraphs }) as unknown as MasRegistrySnapshot,
  };
}

/**
 * The credential-free CONFIG catalog the host resolves workflow
 * profile/tool/context requests against. The catalog is data: profile
 * names, the tool ids the host will allow, the context adapter ids the
 * host can serve, and optional host caps a workflow may not exceed.
 */
export interface MasConfigCatalog {
  revision: string;
  profiles: readonly string[];
  tools: readonly string[];
  contexts: readonly string[];
  limits?: Readonly<Record<string, number>>;
}

export async function createMasConfigCatalog(value: unknown): Promise<MasValidated<MasConfigCatalog>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return refuse([masIssue('TMAS1009', '', 'a CONFIG catalog must be an object')]);
  }
  const document = value as Record<string, unknown>;
  const lists: Array<[string, unknown]> = [['profiles', document.profiles], ['tools', document.tools], ['contexts', document.contexts]];
  const issues = [];
  for (const [name, list] of lists) {
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) {
      issues.push(masIssue('TMAS1009', `/${name}`, `the catalog '${name}' member must be an array of names`));
    }
  }
  if (issues.length > 0) return refuse(issues);
  const revision = await masRevisionOf(cloneJson(value));
  const catalog: MasConfigCatalog = {
    revision,
    profiles: [...(document.profiles as string[])],
    tools: [...(document.tools as string[])],
    contexts: [...(document.contexts as string[])],
    ...(document.limits !== undefined ? { limits: cloneJson(document.limits) as Record<string, number> } : {}),
  };
  return { valid: true, value: deepFreeze(catalog) as MasConfigCatalog };
}
