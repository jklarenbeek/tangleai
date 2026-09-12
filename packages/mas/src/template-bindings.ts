/** Semantic specialization policy: modes authorize exact fields, never arbitrary patches. */
import { compileJSONPointer, parseJSONPointer, JSONPOINTER_NOTHING, encodeJSONPointerSegment } from '@jarenjs/json/pointer';
import { compileEmbeddedSchema, validateWorkflowShape } from './schema.ts';
import { masIssue, refuse, type MasIssue, type MasValidated } from './errors.ts';
import type { MasTemplate } from './contracts.gen.ts';

type Mode = MasTemplate['bindings'][number]['mode'];
interface Target { mode: Mode; value: unknown }

/** Uses the suite pointer grammar, preserving absence rather than substituting null. */
export function templatePointerValue(document: unknown, pointer: string): unknown {
  return compileJSONPointer(pointer)(document);
}

export function validateTemplateBindings(template: MasTemplate): MasValidated<MasTemplate> {
  const shape = validateWorkflowShape(template.fragment);
  if (!shape.valid) return refuse(shape.issues.map(i => ({ ...i, path: `/fragment${i.path}` })));
  if (compileEmbeddedSchema(template.parameters.schema) === null) {
    return refuse([masIssue('TMAS1001', '/parameters/schema', 'the parameter schema does not compile')]);
  }
  const targets = new Map<string, Target>();
  const add = (pointer: string, mode: Mode, value: unknown) => targets.set(pointer, { mode, value });
  const limits = (pointer: string, value: object | null) => {
    for (const [name, cap] of Object.entries(value ?? {})) {
      if (typeof cap === 'number' && Number.isFinite(cap)) add(`${pointer}/${encodeJSONPointerSegment(name)}`, 'caps', cap);
    }
  };
  const guardConstants = (value: unknown, pointer: string): void => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const path = `${pointer}/${encodeJSONPointerSegment(key)}`;
      if (key === '$const' && typeof child === 'boolean') add(path, 'branch-enablement', child);
      else if (key !== '$const') guardConstants(child, path);
    }
  };
  limits('/limits', shape.value.limits);
  for (const [index, node] of shape.value.nodes.entries()) {
    const path = `/nodes/${index}`;
    limits(`${path}/limits`, node.limits);
    if (node.kind === 'agent') {
      add(`${path}/role`, 'role', node.role);
      add(`${path}/instructionsRevision`, 'instructions-revision', node.instructionsRevision);
      add(`${path}/profile`, 'profile', node.profile);
      add(`${path}/tools`, 'tools', node.tools);
      add(`${path}/context`, 'context-adapter', node.context);
      add(`${path}/messageAdapter`, 'message-adapter', node.messageAdapter);
    }
    if (node.kind === 'loop') add(`${path}/maxIterations`, 'caps', node.maxIterations);
    if (node.kind === 'switch') for (const [i, branch] of node.branches.entries()) {
      guardConstants(branch.when, `${path}/branches/${i}/when`);
    }
  }
  const issues: MasIssue[] = [];
  const declared: string[] = [];
  for (const [index, binding] of template.bindings.entries()) {
    const at = `/bindings/${index}`;
    try {
      parseJSONPointer(binding.parameterPointer);
      parseJSONPointer(binding.targetPointer);
    } catch (error) {
      issues.push(masIssue('TMAS1004', `${at}/targetPointer`, `invalid binding pointer: ${(error as Error).message}`));
      continue;
    }
    const target = targets.get(binding.targetPointer);
    if (target === undefined || target.mode !== binding.mode) {
      issues.push(masIssue('TMAS1004', `${at}/targetPointer`, 'the mode does not authorize this existing semantic field'));
    }
    if (declared.some(p => p === binding.targetPointer || p.startsWith(`${binding.targetPointer}/`) || binding.targetPointer.startsWith(`${p}/`))) {
      issues.push(masIssue('TMAS1004', `${at}/targetPointer`, 'binding targets must not duplicate or overlap'));
    }
    declared.push(binding.targetPointer);
  }
  return issues.length > 0 ? refuse(issues) : { valid: true, value: template };
}

export function validateTemplateBindingValue(template: MasTemplate, index: number, value: unknown): MasIssue | null {
  if (value === JSONPOINTER_NOTHING) return null;
  const binding = template.bindings[index];
  const current = templatePointerValue(template.fragment, binding.targetPointer);
  const at = `/bindings/${index}`;
  if (binding.mode === 'caps') {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > (current as number)) {
      return masIssue('TMAS1008', at, `a cap must be a nonnegative integer no greater than ${current}`);
    }
  } else if (binding.mode === 'tools' || binding.mode === 'context-adapter') {
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string') || new Set(value).size !== value.length) {
      return masIssue('TMAS1004', at, 'an adapter/tool list must contain distinct ids');
    }
    if (binding.mode === 'tools' && value.some(v => !(current as string[]).includes(v))) {
      return masIssue('TMAS1009', at, 'specialization may only remove already-declared tools');
    }
  } else if (binding.mode === 'branch-enablement') {
    if (typeof value !== 'boolean') return masIssue('TMAS1004', at, 'branch enablement must be a boolean literal');
  } else if (typeof value !== 'string' || value.length === 0) {
    return masIssue('TMAS1004', at, 'this agent field requires a nonempty string');
  }
  return null;
}
