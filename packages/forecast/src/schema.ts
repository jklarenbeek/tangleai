/** Closed schemas are the single record gate, independent of physical storage. */
import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';
import forecastSchema from '../schemas/forecast.schema.json' with { type: 'json' };
import { reject } from './errors.ts';
export { forecastSchema };
type Validator = (value: unknown) => { valid: boolean };
const validators = new Map<string, Validator>();
export function checkShape<T>(name: string, value: unknown): T {
  try { canonicalizeJson(value); }
  catch { reject('TFCT1001', 'Only finite JSON data is accepted.'); }
  if (!Object.hasOwn(forecastSchema.$defs, name)) throw new TypeError('Unknown forecast schema definition.');
  let validate = validators.get(name);
  if (!validate) {
    validate = new JarenValidator({ collectErrors: true, unknownFormats: 'ignore' }).compile({ $defs: forecastSchema.$defs, $ref: '#/$defs/' + name }) as Validator;
    validators.set(name, validate);
  }
  if (!validate(value).valid) reject('TFCT1001', 'Invalid ' + name + ' data.');
  return deepFreeze(cloneJson(value)) as T;
}
export function checkTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    reject('TFCT1001', 'Expected a valid normalized UTC instant.');
  return value;
}
export function forecastBytes(value: unknown): number { return new TextEncoder().encode(canonicalizeJson(value)).length; }
export const DEFAULT_FORECAST_POLICY = Object.freeze({ maxVersions: 10, maxTraceBytes: 262144, maxComponentBytes: 4096, maxHarnessBytes: 32768, maxOperations: 32, maxChangedLeaves: 32 });
