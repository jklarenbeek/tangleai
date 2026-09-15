/**
 * One schema authority for every evolve record.
 *
 * Canonicalization runs first, so a non-JSON input (a cycle, a class, a
 * non-finite number) is refused as a shape failure rather than reaching
 * the validator. A validated value is cloned and deeply frozen: a record
 * this module returns cannot be edited behind its identity.
 */

import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';
import evolveSchema from '../schemas/evolve.schema.json' with { type: 'json' };
import { refuseOne, ok, type EvolveOutcome } from './errors.ts';

export { evolveSchema };

type ShapeValidator = (value: unknown) => { valid: boolean, errors?: unknown[] };

const validators = new Map<string, ShapeValidator>();

function validatorFor(name: string): ShapeValidator {
  let validate = validators.get(name);
  if (!validate) {
    const compiler = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
    validate = compiler.compile({ $defs: evolveSchema.$defs, $ref: '#/$defs/' + name }) as ShapeValidator;
    validators.set(name, validate);
  }
  return validate;
}

/** Validate against one named definition. The refusal names the definition. */
export function checkShape<T>(name: string, value: unknown, path = ''): EvolveOutcome<T> {
  try {
    canonicalizeJson(value);
  }
  catch {
    return refuseOne<T>('TEVO1001', path, 'Only finite JSON data is accepted for ' + name + '.');
  }
  const result = validatorFor(name)(value);
  if (!result.valid) return refuseOne<T>('TEVO1001', path, 'Invalid ' + name + ' shape.');
  return ok(deepFreeze(cloneJson(value)) as T);
}

/** The record union — any evolve record, identified by its own `kind`. */
export function checkRecordShape<T>(value: unknown, path = ''): EvolveOutcome<T> {
  return checkShape<T>('evolveRecord', value, path);
}
