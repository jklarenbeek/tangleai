/** One closed-schema validator for every canonical skill artifact. */
import { JarenValidator } from '@jarenjs/validate';
import { compileJSONPointer } from '@jarenjs/json/pointer';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import trace2SkillSchema from '../schemas/trace2skill.schema.json' with { type: 'json' };
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { immutableJson } from './identity.ts';

export { trace2SkillSchema };
export type Trace2SkillSchemaName = keyof typeof trace2SkillSchema.$defs;
type JsonSchema = Record<string, unknown> | boolean;
type Validator = (value: unknown) => { valid: boolean, errors?: Array<{ instancePath?: string, message?: string }> };

export function compileTrace2SkillSchema(schema: JsonSchema): Validator {
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  return validator.compile(schema as Record<string, unknown>) as Validator;
}

const schemas = new Map<Trace2SkillSchemaName, Record<string, unknown>>();
/** Bundle only reachable local definitions, so a role request exposes no unrelated schema. */
export function trace2SkillSchemaOf(name: Trace2SkillSchemaName): Record<string, unknown> {
  const cached = schemas.get(name);
  if (cached) return cached;
  const defs: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const ref = (value as Record<string, unknown>).$ref;
    if (typeof ref === 'string' && ref.startsWith('#/$defs/')) {
      const key = ref.slice(8);
      if (!Object.hasOwn(defs, key)) { const found = compileJSONPointer(ref.slice(1))(trace2SkillSchema); defs[key] = found; visit(found); }
    }
    Object.values(value).forEach(visit);
  };
  const value = trace2SkillSchema.$defs[name];
  visit(value);
  const result = immutableJson({ $id: `https://tangleai.dev/schemas/trace2skill/${name}`, ...value, $defs: defs });
  schemas.set(name, result);
  return result;
}

const validators = new Map<Trace2SkillSchemaName, Validator>();
export function validateTrace2SkillShape<T>(name: Trace2SkillSchemaName, value: unknown): Trace2SkillOutcome<T> {
  try {
    canonicalizeJson(value);
    let validate = validators.get(name);
    if (!validate) { validate = compileTrace2SkillSchema(trace2SkillSchemaOf(name)); validators.set(name, validate); }
    const result = validate(value);
    if (!result.valid) return trace2SkillRefuse('TT2S1001', result.errors?.[0]?.instancePath ?? '', result.errors?.[0]?.message ?? `invalid ${name}`);
    return { valid: true, value: immutableJson(value) as T };
  }
  catch (error) { return trace2SkillRefuse('TT2S1001', '', `invalid ${name}`, error); }
}
