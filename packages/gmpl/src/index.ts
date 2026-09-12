/** GMPL content and pure host bindings. Execution belongs to @tangleai/mas. */
export type * from './contracts.gen.ts';
export type * from './errors.ts';
export {gmplSchema,gmplSchemaOf,validateGmplShape} from './schema.ts';
export {gmplRevisionOf,gmplVersionOf,gmplTextDigest} from './identity.ts';
export {compileGmplPromptPack,renderGmplPrompt,validateGmplPromptArtifact} from './prompts.ts';
export type {CompileGmplPromptOptions} from './prompts.ts';
export {createGmplCatalog,gmplCatalogDocument,createGmplDomainBinding,createGmplRecipe,resolveGmplParameters,GMPL_LIMITS} from './catalog.ts';
export type {GmplCatalog} from './catalog.ts';
export {validateGmplEvidence,mergeGmplFindings} from './evidence.ts';
export {materializeGmplTemplate,instantiateGmplPattern} from './specialize.ts';
export type {GmplHostSnapshot,GmplMaterializedTemplate} from './specialize.ts';
export {createGmplHostBindings} from './host-bindings.ts';
import artifactDocument from '../artifacts/catalog.json' with {type:'json'};
import {immutableJson} from './identity.ts';
import type {GmplCatalogDocument} from './contracts.gen.ts';
export const gmplArtifacts: GmplCatalogDocument = immutableJson(artifactDocument as GmplCatalogDocument);

export {GMPL_STAGES} from './defaults.ts';
export type {GmplAnswerProjector} from './projection.ts';
