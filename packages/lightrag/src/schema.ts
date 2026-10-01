import { JarenValidator } from '@jarenjs/validate';
import { dateTimeFormats } from '@jarenjs/formats';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import lightRagSchema from '../schemas/lightrag.schema.json' with { type: 'json' };
import type * as C from './contracts.gen.ts';
import { lightragRefuse, type LightRagOutcome } from './errors.ts';
import { immutableLightRagJson } from './identity.ts';
export { lightRagSchema };
export interface LightRagRecords {
    graphDocumentBinding: C.GraphDocumentBinding;
    graphContributionSnapshot: C.GraphContributionSnapshot;
    graphExtractionReply: C.GraphExtractionReply;
    graphExtractionInput: C.GraphExtractionInput;
    graphProfileInput: C.GraphProfileInput;
    graphProfileReply: C.GraphProfileReply;
    graphCoreferenceInput: C.GraphCoreferenceInput;
    graphCoreferenceReply: C.GraphCoreferenceReply;
    graphKeywordInput: C.GraphKeywordInput;
    graphKeywordReply: C.GraphKeywordReply;
    lightRagPromptPack: C.LightRagPromptPack;
    lightRagPromptArtifact: C.LightRagPromptArtifact;
    lightRagPromptCatalog: C.LightRagPromptCatalog;
    graphContribution: C.GraphContribution;
    graphPreparationFailure: C.GraphPreparationFailure;
    projectionWritePlan: C.ProjectionWritePlan;
    graphContributionInput: C.GraphContributionInput; graphContributionPlan: C.GraphContributionPlan;
    graphEntityClaim: C.GraphEntityClaim; graphRelationClaim: C.GraphRelationClaim;
    graphChunkProfile: C.GraphChunkProfile; graphEntity: C.GraphEntity;
    graphRelation: C.GraphRelation; graphProjection: C.GraphProjection;
    lightRagQueryPlan: C.LightRagQueryPlan; lightRagRetrieval: C.LightRagRetrieval;
    lightRagContextBundle: C.LightRagContextBundle; lightRagAnswerRecord: C.LightRagAnswerRecord;
    lightRagIssue: C.LightRagIssue; lightRagIdentities: C.LightRagIdentities;
    lightRagSpend: C.LightRagSpend; lightRagLimits: C.LightRagLimits;
}
type ShapeName = keyof typeof lightRagSchema.$defs;
type Checked = { valid: boolean; errors?: Array<{ instancePath?: string; message?: string }> };
const schemas = new Map<ShapeName, Record<string, unknown>>();
const validators = new Map<ShapeName, (value: unknown) => Checked>();
export function lightRagSchemaOf(name: ShapeName): Record<string, unknown> {
    if (!Object.hasOwn(lightRagSchema.$defs, name)) throw new TypeError('Unknown graph record shape.');
    let schema = schemas.get(name);
    if (!schema) {
        schema = immutableLightRagJson({ $schema: lightRagSchema.$schema, $id: lightRagSchema.$id + '/' + name,
            ...lightRagSchema.$defs[name], $defs: lightRagSchema.$defs });
        schemas.set(name, schema);
    }
    return schema;
}
export function validateLightRagShape<N extends keyof LightRagRecords>(name: N, value: unknown): LightRagOutcome<LightRagRecords[N]> {
    try {
        canonicalizeJson(value);
        let validate = validators.get(name);
        if (!validate) {
            const compiler = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'error' });
            compiler.addFormats(dateTimeFormats);
            validate = compiler.compile(lightRagSchemaOf(name)) as (value: unknown) => Checked;
            validators.set(name, validate);
        }
        const result = validate(value);
        if (!result.valid) return lightragRefuse('TLRAG1001', result.errors?.[0]?.instancePath ?? '', result.errors?.[0]?.message ?? `Invalid ${name}.`);
        return { valid: true, value: immutableLightRagJson(value) as LightRagRecords[N] };
    } catch (cause) { return lightragRefuse('TLRAG1001', '', `Invalid ${name}.`, cause); }
}
