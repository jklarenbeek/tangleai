import { JarenValidator } from '@jarenjs/validate';
import { toEpoch } from '@jarenjs/core/series';
import schema from '../schemas/trading.schema.json' with { type: 'json' };
import { immutableTradingJson } from './identity.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRecord } from './contracts.gen.ts';

export const tradingSchema = immutableTradingJson(schema);
export type TradingSchemaName = keyof typeof schema.$defs;
type Validator = (value: unknown) => { valid: boolean; errors?: Array<{ instancePath?: string; message?: string; params?: { missingProperty?: string } }> };
const schemas = new Map<TradingSchemaName, Record<string, unknown>>(), validators = new Map<TradingSchemaName, Validator>();
const recordSchemas = new Map<string, TradingSchemaName>();
for (const [name, definition] of Object.entries(schema.$defs)) {
  const kind = (definition as { properties?: { kind?: { const?: string; enum?: string[] } } }).properties?.kind;
  for (const value of kind?.const ? [kind.const] : kind?.enum ?? []) recordSchemas.set(value, name as TradingSchemaName);
}
export function validateTradingRecordShape(input: unknown): TradingOutcome<TradingRecord> {
  const kind = input && typeof input === 'object' && 'kind' in input ? input.kind : undefined;
  const name = typeof kind === 'string' ? recordSchemas.get(kind) : undefined;
  return name ? validateTradingShape<TradingRecord>(name, input) : tradingRefuse('TTRD1001', '/kind', 'Unknown trading record kind');
}
export function tradingSchemaOf(name: TradingSchemaName): Record<string, unknown> {
  let found = schemas.get(name);
  if (!found) { found = immutableTradingJson({ $id: `https://tangleai.dev/schemas/trading/${name}`, ...schema.$defs[name], $defs: schema.$defs }); schemas.set(name, found); }
  return found;
}
export function validateTradingShape<T>(name: TradingSchemaName, input: unknown): TradingOutcome<T> {
  try {
    const value = immutableTradingJson(input);
    let validate = validators.get(name);
    if (!validate) {
      validate = new JarenValidator({ collectErrors: true, skipErrors: false, unknownFormats: 'ignore' }).compile(tradingSchemaOf(name)) as Validator;
      validators.set(name, validate);
    }
    const result = validate(value);
    if (!result.valid) {
      const error = result.errors?.[0], missing = error?.params?.missingProperty;
      const path = (error?.instancePath ?? '') + (missing === undefined ? '' : '/' + missing.replaceAll('~', '~0').replaceAll('/', '~1'));
      return tradingRefuse('TTRD1001', path, error?.message ?? `Invalid ${name}`);
    }
    return { valid: true, value: value as T };
  } catch (cause) { return tradingRefuse('TTRD1001', '', `Invalid ${name}`, cause); }
}
/** Temporal meaning is checked numerically, including equivalent UTC offsets. */
export function validateTradingRecordSemantics(record: TradingRecord): TradingOutcome<TradingRecord> {
  for (const field of ['eventAt', 'availableAt', 'openAt', 'closeAt', 'cutoffAt'] as const) {
    if (field in record) try { toEpoch((record as unknown as Record<string, string>)[field]); }
    catch (cause) { return tradingRefuse('TTRD1001', `/${field}`, 'Expected an RFC 3339 instant', cause); }
  }
  if ('availableAt' in record && toEpoch(record.availableAt) < toEpoch(record.eventAt))
    return tradingRefuse('TTRD1001', '/availableAt', 'Availability cannot precede the event');
  if (record.kind === 'session' && toEpoch(record.closeAt) <= toEpoch(record.openAt))
    return tradingRefuse('TTRD1001', '/closeAt', 'A session must end after it opens');
  if (record.kind === 'bar' && (record.high < Math.max(record.open, record.close) || record.low > Math.min(record.open, record.close)))
    return tradingRefuse('TTRD1001', '/high', 'OHLC prices must lie within the declared range');
  if (record.kind === 'corporate-action' && (record.action === 'split' ? record.ratio === null || record.cashPerShare !== null : record.cashPerShare === null || record.ratio !== null))
    return tradingRefuse('TTRD1001', '/action', 'Corporate action fields do not match their kind');
  return { valid: true, value: record };
}
