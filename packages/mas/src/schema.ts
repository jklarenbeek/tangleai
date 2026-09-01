/**
 * Document validation as values — the schemas are the runtime truth.
 *
 * The JSON Schemas under `schemas/` are the gate: every workflow,
 * registry snapshot, template and runtime record passes the suite
 * validator — including the `$query` cross-field assertions — before
 * anything treats it as MAS data. This module owns the ONE validator
 * instance per schema and turns validator errors into `TMAS1001`
 * shape issues with the validator's own instance pointer; the semantic
 * gates in `validate.ts` own every other code. No hand-written
 * interface mirrors a schema: the TypeScript in `contracts.gen.ts` is
 * generated, and `npm run emit:check` fails when the two drift.
 */

import { JarenValidator } from '@jarenjs/validate';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';

import masWorkflowSchema from '../schemas/mas-workflow.schema.json' with { type: 'json' };
import masRegistrySchema from '../schemas/mas-registry.schema.json' with { type: 'json' };
import masTemplateSchema from '../schemas/mas-template.schema.json' with { type: 'json' };
import masRuntimeSchema from '../schemas/mas-runtime.schema.json' with { type: 'json' };
import { masIssue, refuse, type MasIssue, type MasValidated } from './errors.ts';
import type { MasRegistry, MasTemplate, MasWorkflow } from './contracts.gen.ts';

export { masWorkflowSchema, masRegistrySchema, masTemplateSchema, masRuntimeSchema };

interface ValidatorError {
  keyword?: string;
  instancePath?: string;
  message?: string;
  params?: { additionalProperty?: string };
}

function compile(schema: object, refs: readonly object[] = []): (value: unknown) => { valid: boolean, errors?: ValidatorError[] } {
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  if (refs.length > 0) validator.addSchema(refs as Record<string, unknown>[]);
  const validate = validator.compile(schema as Record<string, unknown>);
  return (value) => validate(value) as { valid: boolean, errors?: ValidatorError[] };
}

const workflowValidator = compile(masWorkflowSchema as object);
const registryValidator = compile(masRegistrySchema as object);
const templateValidator = compile(masTemplateSchema as object);
const runtimeRecordValidators = new Map<string, (value: unknown) => { valid: boolean, errors?: ValidatorError[] }>();

/** Every shape refusal is TMAS1001 at the validator's own pointer. */
function shapeIssues(errors: ValidatorError[] | undefined): MasIssue[] {
  const issues = (errors ?? []).map((error) => {
    const path = error.instancePath ?? '';
    if (error.keyword === 'additionalProperties') {
      const member = error.params?.additionalProperty ?? '';
      return masIssue('TMAS1001', path, `undeclared member '${member}' — the IR closes every object, so a secret, clock or observation has no representable member`);
    }
    return masIssue('TMAS1001', path, error.message ?? 'the document does not validate against its closed schema');
  });
  const unique = new Map(issues.map((item) => [`${item.code} ${item.path} ${item.detail}`, item]));
  return [...unique.values()];
}

/** Validate a workflow document's SHAPE; the value comes back deeply frozen. */
export function validateWorkflowShape(value: unknown): MasValidated<MasWorkflow> {
  const outcome = workflowValidator(value);
  if (!outcome.valid) return refuse(shapeIssues(outcome.errors));
  return { valid: true, value: deepFreeze(cloneJson(value)) as MasWorkflow };
}

/** Validate a registry snapshot document's shape. Embedded workflows and templates are the snapshot constructor's semantic gates. */
export function validateRegistryShape(value: unknown): MasValidated<MasRegistry> {
  const outcome = registryValidator(value);
  if (!outcome.valid) return refuse(shapeIssues(outcome.errors));
  return { valid: true, value: deepFreeze(cloneJson(value)) as MasRegistry };
}

/** Validate a template version document's shape. */
export function validateTemplateShape(value: unknown): MasValidated<MasTemplate> {
  const outcome = templateValidator(value);
  if (!outcome.valid) return refuse(shapeIssues(outcome.errors));
  return { valid: true, value: deepFreeze(cloneJson(value)) as MasTemplate };
}

/**
 * Validate one runtime record against a named `$defs` shape of the
 * runtime schema (`masRun`, `masNodeAttempt`, `masMessage`,
 * `masStateRevision`, `masInteraction`, `masTraceArtifact`). The store
 * adapter calls this before every write so persistence can never invent
 * a shape.
 */
export function validateRuntimeRecord(kind: string, value: unknown): MasValidated<Record<string, unknown>> {
  let validator = runtimeRecordValidators.get(kind);
  if (validator === undefined) {
    validator = compile(
      { $ref: `https://tangleai.dev/schemas/mas-runtime#/$defs/${kind}` },
      [masRuntimeSchema as object],
    );
    runtimeRecordValidators.set(kind, validator);
  }
  const outcome = validator(value);
  if (!outcome.valid) return refuse(shapeIssues(outcome.errors));
  return { valid: true, value: cloneJson(value) as Record<string, unknown> };
}

/**
 * Compile one embedded JSON Schema with the house validator settings;
 * returns null when the schema itself does not compile. Used by the
 * semantic gates for port/input/output/state schemas.
 */
export function compileEmbeddedSchema(schema: unknown): ((value: unknown) => { valid: boolean, errors?: ValidatorError[] }) | null {
  try {
    return compile(schema as object);
  } catch {
    return null;
  }
}
