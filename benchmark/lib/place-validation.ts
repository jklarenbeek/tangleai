/** One schema owner for the sourced fixture and its reconciled report. */
import { runIdentitySchema } from '@tangleai/config';
import { createReportValidator, describeErrors } from './validate.ts';
import schema from '../schemas/place.schema.json' with { type: 'json' };

export const validatePlaceShape = createReportValidator(schema, [runIdentitySchema]);
export function requirePlaceShape<T>(value: unknown): T {
  const result = validatePlaceShape(value);
  if (!result.valid) throw new Error(`place contract: ${describeErrors(result, 3).join('; ')}`);
  return value as T;
}
