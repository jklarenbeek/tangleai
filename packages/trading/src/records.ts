import { immutableTradingJson, tradingIdentityOf } from './identity.ts';
import { validateTradingRecordShape, validateTradingRecordSemantics } from './schema.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRecord } from './contracts.gen.ts';

export type TradingRecordKind = TradingRecord['kind'];
export type TradingRecordOf<K extends TradingRecordKind> = TradingRecord & { kind: K };
export type TradingRecordBody<K extends TradingRecordKind> = Omit<TradingRecordOf<K>, 'id' | 'revision' | 'kind'>;

export async function validateTradingRecord(input: unknown): Promise<TradingOutcome<TradingRecord>> {
  const shape = validateTradingRecordShape(input);
  if (!shape.valid) return shape;
  const semantic = validateTradingRecordSemantics(shape.value);
  if (!semantic.valid) return semantic;
  const expected = await tradingIdentityOf(shape.value);
  if (shape.value.id !== expected.id) return tradingRefuse('TTRD1002', '/id', 'Record content does not match its address');
  if (shape.value.revision !== expected.revision) return tradingRefuse('TTRD1002', '/revision', 'Record content does not match its revision');
  return shape;
}
export async function createTradingRecord<K extends TradingRecordKind>(kind: K, input: TradingRecordBody<K>): Promise<TradingOutcome<TradingRecordOf<K>>> {
  try {
    const body = immutableTradingJson({ ...input, kind });
    if (Object.hasOwn(input, 'id') || Object.hasOwn(input, 'revision')) return tradingRefuse('TTRD1001', '/id', 'Constructors assign the content address');
    return await validateTradingRecord({ ...body, ...await tradingIdentityOf(body) }) as TradingOutcome<TradingRecordOf<K>>;
  } catch (cause) { return tradingRefuse('TTRD1001', '', 'Record construction requires finite JSON', cause); }
}
