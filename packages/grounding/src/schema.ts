import { JarenValidator } from '@jarenjs/validate';
import { dateTimeFormats } from '@jarenjs/formats';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { runIdentitySchema } from '@tangleai/config';
import groundingSchema from '../schemas/grounding.schema.json' with { type: 'json' };
import type * as C from './contracts.gen.ts';
import { groundingRefuse, type GroundingOutcome } from './errors.ts';
import { immutableGroundingJson } from './identity.ts';
export { groundingSchema };
export interface GroundingRecords {
    groundingProfile: C.GroundingProfile; corpusManifest: C.CorpusManifest; groundingSession: C.GroundingSession;
    clarifiedIntent: C.ClarifiedIntent; queryPlan: C.QueryPlan; evidenceCandidate: C.EvidenceCandidate;
    webRetrievalRun: C.WebRetrievalRun; evidenceConflict: C.EvidenceConflict; groundedClaim: C.GroundedClaim;
    groundedAnswer: C.GroundedAnswer; groundingIssue: C.GroundingIssue; groundingSpend: C.GroundingSpend; groundingTrace: C.GroundingTrace;
}
export type GroundingSchemaName = keyof typeof groundingSchema.$defs;
type Validation = { valid: boolean; errors?: Array<{ instancePath?: string; message?: string; params?: { additionalProperty?: string; missingProperty?: string } }> };
const schemas = new Map<GroundingSchemaName, Record<string, unknown>>();
const validators = new Map<GroundingSchemaName, (value: unknown) => Validation>();
export function groundingSchemaOf(name: GroundingSchemaName): Record<string, unknown> {
    if (!Object.hasOwn(groundingSchema.$defs, name)) throw new TypeError('Unknown grounding schema name.');
    let schema = schemas.get(name);
    if (!schema) {
        schema = immutableGroundingJson({ $schema: groundingSchema.$schema, $id: groundingSchema.$id + '/' + name, ...groundingSchema.$defs[name], $defs: groundingSchema.$defs });
        schemas.set(name, schema);
    }
    return schema;
}
export function validateGroundingShape<N extends keyof GroundingRecords>(name: N, value: unknown): GroundingOutcome<GroundingRecords[N]> {
    try {
        canonicalizeJson(value);
        let validate = validators.get(name);
        if (!validate) {
            const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'error' });
            validator.addFormats(dateTimeFormats);
            validator.addSchema([runIdentitySchema as Record<string, unknown>]);
            validate = validator.compile(groundingSchemaOf(name)) as (value: unknown) => Validation;
            validators.set(name, validate);
        }
        const result = validate(value);
        if (!result.valid) {
            const error = result.errors?.[0];
            const path = error?.instancePath ?? '';
            return groundingRefuse('TGRD1001', path, error?.message ?? `Invalid ${name}.`);
        }
        return { valid: true, value: immutableGroundingJson(value) as GroundingRecords[N] };
    } catch (error) { return groundingRefuse('TGRD1001', '', `Invalid ${name}.`, error); }
}
