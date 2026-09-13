/** Canonical temporal JSON values; calendar and evidence policies belong to memory. */
import { JarenValidator } from '@jarenjs/validate';
import temporalSchema from '../../schemas/temporal.schema.json' with { type: 'json' };
export { temporalSchema };
export type * from './temporal.gen.ts';
export type TemporalSchemaName = keyof typeof temporalSchema.$defs;
type Validation = { valid: boolean; errors?: unknown[] };
const validators = new Map<TemporalSchemaName, (value: unknown) => Validation>();
export function validateTemporalShape(name: TemporalSchemaName, value: unknown): Validation {
  let validate = validators.get(name);
  if (!validate) {
    const owner = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validate = owner.compile({ $defs: temporalSchema.$defs, $ref: `#/$defs/${name}` }) as (value: unknown) => Validation;
    validators.set(name, validate);
  }
  return validate(value);
}
