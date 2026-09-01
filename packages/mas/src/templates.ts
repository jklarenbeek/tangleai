/**
 * Template instantiation — schema-validated parameters, compiled RFC
 * 6902 copy-on-write, declared targets only.
 *
 * A `MasTemplateVersion` is an immutable workflow fragment, a closed
 * parameter schema and ordered binding declarations. Instantiation
 * validates the parameters with the suite validator, builds a patch
 * consisting ONLY of declared target pointers, applies it with
 * `compileJSONPatch` (never text replacement over serialized JSON),
 * recomputes the instance version, and proves with `createJSONPatch`
 * that every changed pointer sits at or below a declared target. A
 * parameter cannot change a node kind, add a node/edge/tool, target an
 * undeclared pointer, or raise a cap above the fragment's own value;
 * provenance records the template version and parameter revision in
 * compile metadata, outside the hashed semantic payload.
 */

import { compileJSONPatch, createJSONPatch, type JsonPatchOperation } from '@jarenjs/json/patch';

import { masIssue, refuse, type MasIssue, type MasValidated } from './errors.ts';
import { masRevisionOf, masTemplateVersionIdOf, masWorkflowVersionIdOf } from './identity.ts';
import { compileEmbeddedSchema, validateTemplateShape, validateWorkflowShape } from './schema.ts';
import type { MasTemplate, MasWorkflow } from './contracts.gen.ts';

function pointerValue(document: unknown, pointer: string): unknown {
  if (pointer === '') return document;
  let current: unknown = document;
  for (const segment of pointer.slice(1).split('/')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  return current;
}

const IGNORED_CHANGES = ['/versionId'];

export interface InstantiatedTemplate {
  workflow: MasWorkflow;
  templateVersionId: string;
  parametersRevision: string;
}

export async function instantiateMasTemplate(template: unknown, parameters: unknown): Promise<MasValidated<InstantiatedTemplate>> {
  const shape = validateTemplateShape(template);
  if (!shape.valid) return shape;
  const document = shape.value as MasTemplate;
  const templateVersionId = await masTemplateVersionIdOf(document as unknown as Record<string, unknown>);
  if (templateVersionId !== document.versionId) {
    return refuse([masIssue('TMAS1002', '/versionId', 'the template does not hash to its claimed version')]);
  }

  const parameterCheck = compileEmbeddedSchema(document.parameters.schema);
  if (parameterCheck === null || !parameterCheck(parameters).valid) {
    return refuse([masIssue('TMAS1001', '/parameters', 'the parameters do not validate against the template parameter schema')]);
  }
  const parametersRevision = await masRevisionOf(parameters);

  const issues: MasIssue[] = [];
  const operations: JsonPatchOperation[] = [];
  for (const [index, binding] of document.bindings.entries()) {
    const value = pointerValue(parameters, binding.parameterPointer);
    if (value === undefined) continue; // an optional parameter leaves its target as authored
    if (binding.mode === 'caps') {
      const current = pointerValue(document.fragment, binding.targetPointer);
      if (typeof current === 'number' && typeof value === 'number' && value > current) {
        issues.push(masIssue('TMAS1008', `/bindings/${index}`, `a parameter cannot raise the cap at '${binding.targetPointer}' (${current} -> ${value})`));
        continue;
      }
    }
    operations.push({ op: 'replace', path: binding.targetPointer, value });
  }
  if (issues.length > 0) return refuse(issues);

  const apply = compileJSONPatch(operations, { values: 'fresh' }) as (document: unknown) => unknown;
  let instance: Record<string, unknown>;
  try {
    instance = apply(document.fragment) as Record<string, unknown>;
  } catch (error) {
    const cause = error as { code?: string, docPath?: string, message?: string };
    return refuse([{
      code: 'TMAS1004',
      path: '/bindings',
      detail: `the compiled binding patch does not apply: ${cause.code ?? ''} ${cause.message ?? ''}`,
      cause: { code: cause.code ?? 'unknown', docPath: cause.docPath ?? '', message: cause.message ?? '' },
    }]);
  }

  // Prove the instance differs from the source only under declared targets.
  const changes = createJSONPatch(document.fragment, instance);
  const declared = document.bindings.map((binding) => binding.targetPointer);
  for (const change of changes) {
    if (IGNORED_CHANGES.some((ignored) => change.path === ignored || change.path.startsWith(`${ignored}/`))) continue;
    const covered = declared.some((target) => change.path === target || change.path.startsWith(`${target}/`));
    if (!covered) {
      return refuse([masIssue('TMAS1004', '/bindings', `instantiation changed '${change.path}', which no declared binding targets`)]);
    }
  }

  instance.versionId = await masWorkflowVersionIdOf(instance);
  instance.compile = {
    ...(instance.compile as Record<string, unknown>),
    sourceDesignRevision: await masRevisionOf({ templateVersionId, parametersRevision }),
  };
  const workflowShape = validateWorkflowShape(instance);
  if (!workflowShape.valid) {
    return refuse(workflowShape.issues.map((issue) => masIssue(issue.code, `/fragment${issue.path}`, `the instantiated workflow does not validate: ${issue.detail}`)));
  }
  return {
    valid: true,
    value: { workflow: workflowShape.value, templateVersionId, parametersRevision },
  };
}
