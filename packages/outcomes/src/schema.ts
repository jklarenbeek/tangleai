/** One schema authority. Canonicalization rejects non-JSON input before cloning. */
import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';
import outcomesSchema from '../schemas/outcomes.schema.json' with { type: 'json' };
import { reject } from './errors.ts';
import type { Json, OutcomeRecord, Policy } from './outcomes.contracts.gen.ts';
export { outcomesSchema };
type ShapeValidator = (v: unknown) => {
    valid: boolean;
    errors?: unknown[];
};
const validators = new Map<string, ShapeValidator>();
export function checkShape<T>(name: string, value: unknown): T {
    try {
        canonicalizeJson(value);
    }
    catch {
        reject('OUTC1001', 'Only finite JSON data is accepted.');
    }
    let validate = validators.get(name);
    if (!validate) {
        const v = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
        validate = v.compile({ $defs: outcomesSchema.$defs, $ref: `#/$defs/${name}` }) as ShapeValidator;
        validators.set(name, validate!);
    }
    const result = validate!(value);
    if (!result.valid)
        reject('OUTC1001', `Invalid ${name} data.`);
    return deepFreeze(cloneJson(value)) as T;
}
export function checkTime(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
        reject('OUTC1001', 'Expected a valid normalized UTC instant.');
    return value;
}
export const DEFAULT_OUTCOME_POLICY: Readonly<Policy> = Object.freeze({ maxVersions: 10, maxPayloadBytes: 32768, maxOperations: 32, maxChangedLeaves: 32, maxReflectionBytes: 8192 });
export function jsonBytes(value: Json): number { return new TextEncoder().encode(canonicalizeJson(value)).length; }
export function checkRecordShape(value: unknown): OutcomeRecord { const r = checkShape<OutcomeRecord>('outcomeRecord', value); checkTime(r.recordedAt); return r; }
