/** Closed consolidation payloads; evidence/activation policy belongs to memory. */
import { JarenValidator } from '@jarenjs/validate';
import { CONSOLIDATION_SCHEMA } from './consolidation-definition.ts';
export { CONSOLIDATION_SCHEMA };
export type * from './consolidation.gen.ts';
export type ConsolidationSchemaName = keyof typeof CONSOLIDATION_SCHEMA.$defs;
type Validation = { valid: boolean; errors?: unknown[] };
const validators = new Map<ConsolidationSchemaName, (value: unknown) => Validation>();
export function validateConsolidationShape(name: ConsolidationSchemaName, value: unknown): Validation {
  let validate = validators.get(name);
  if (!validate) {
    const owner = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validate = owner.compile({ $defs: CONSOLIDATION_SCHEMA.$defs, $ref: `#/$defs/${name}` }) as (value: unknown) => Validation;
    validators.set(name, validate);
  }
  return validate(value);
}
