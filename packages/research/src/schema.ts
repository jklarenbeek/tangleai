import { JarenValidator } from '@jarenjs/validate';
import { gmplSchemaDefinition } from '@tangleai/gmpl';
import { trace2SkillSchemaOf } from '@tangleai/trace2skill';
import { outcomesSchema } from '@tangleai/outcomes';
import schema from '../schemas/research.schema.json' with { type: 'json' };
import { researchRefuse, researchValidationIssues } from './errors.ts';
import type { ResearchOutcome } from './errors.ts';
import { immutableResearchJson } from './identity.ts';

export const researchSchemaReferences = immutableResearchJson([
  trace2SkillSchemaOf('authoredPatch'),
  gmplSchemaDefinition(outcomesSchema, 'json', 'https://tangleai.dev/schemas/outcomes/json'),
]);
export const researchSchema = immutableResearchJson(schema);
export type ResearchSchemaName = keyof typeof schema.$defs;
type Validator = (value: unknown) => { valid: boolean; errors?: Array<{
  instancePath?: string; message?: string; params?: { missingProperty?: string; additionalProperty?: string };
}> };
const schemas = new Map<ResearchSchemaName, Record<string, unknown>>();
const validators = new Map<ResearchSchemaName, Validator>();

export function researchSchemaOf(name: ResearchSchemaName): Record<string, unknown> {
  let found = schemas.get(name);
  if (!found) {
    found = gmplSchemaDefinition(schema, name, `https://tangleai.dev/schemas/research-records/${name}`);
    schemas.set(name, found);
  }
  return found;
}
export function validateResearchShape<T = unknown>(name: ResearchSchemaName, input: unknown): ResearchOutcome<T> {
  if (!Object.hasOwn(schema.$defs, name)) return researchRefuse('TRSH1001', '/kind', 'Unknown research record kind.');
  let value: unknown;
  try { value = immutableResearchJson(input); }
  catch (cause) { return researchRefuse('TRSH1001', '', 'Research records must be finite JSON.', cause); }
  let validate = validators.get(name);
  if (!validate) {
    const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validator.addSchema(researchSchemaReferences);
    validate = validator.compile(researchSchemaOf(name)) as Validator;
    validators.set(name, validate);
  }
  const result = validate(value);
  if (result.valid) return { valid: true, value: value as T };
  return { valid: false, issues: researchValidationIssues(result.errors) };
}
