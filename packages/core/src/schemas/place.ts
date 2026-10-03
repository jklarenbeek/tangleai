/** Closed place values; geometry, provenance and matching policy belong to memory. */
import { JarenValidator } from '@jarenjs/validate';
import placeSchema from '../../schemas/place.schema.json' with { type: 'json' };
import type { PlaceCode, PlaceReason } from './place.gen.ts';
export { placeSchema };
export type * from './place.gen.ts';
export type PlaceSchemaName = keyof typeof placeSchema.$defs;
type Validation = { valid: boolean; errors?: unknown[] };
const validators = new Map<PlaceSchemaName, (value: unknown) => Validation>();

/** The schema owns the only code/reason table; runtime refusals use that table. */
export const placeReasons: Readonly<Record<PlaceCode, PlaceReason>> = Object.freeze(Object.fromEntries(
  placeSchema.$defs.placeRefusal.oneOf.map(branch => [branch.properties.code.enum[0], branch.properties.reason.enum[0]]),
) as Record<PlaceCode, PlaceReason>);

export function validatePlaceShape(name: PlaceSchemaName, value: unknown): Validation {
  let validate = validators.get(name);
  if (!validate) {
    const owner = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validate = owner.compile({ $defs: placeSchema.$defs, $ref: `#/$defs/${name}` }) as (value: unknown) => Validation;
    validators.set(name, validate);
  }
  return validate(value);
}
