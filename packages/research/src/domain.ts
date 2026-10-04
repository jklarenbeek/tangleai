/** Immutable research bindings over existing GMPL patterns and MAS plans. */
import { createGmplCatalog, createGmplHostBindings, materializeGmplTemplate, instantiateGmplPattern,
  type GmplCatalogDocument, type GmplHostSnapshot } from '@tangleai/gmpl';
import { createMasRegistrySnapshot, createMasConfigCatalog, type WorkflowLimits } from '@tangleai/mas';
import document from '../artifacts/catalog.json' with { type: 'json' };
import { immutableResearchJson } from './identity.ts';
import { researchFail, researchMasValue } from './workflow-contract.ts';
import { defineResearchDomainBinding, type ResearchPatternPurpose } from './prompt-contracts.ts';

export const researchArtifacts: GmplCatalogDocument = immutableResearchJson(document as unknown as GmplCatalogDocument);
function value<T>(outcome: { valid: true; value: T } | { valid: false; issues: Array<{ code: string; path: string; detail: string }> }): T {
  if (!outcome.valid) researchFail('TRSH1007', outcome.issues[0].path, outcome.issues[0].code + ': ' + outcome.issues[0].detail);
  return outcome.value;
}
export function createResearchDomainBinding(purpose: ResearchPatternPurpose = 'hypothesis') {
  return defineResearchDomainBinding(purpose, researchArtifacts.prompts);
}
export async function createResearchPatternHost(profile: string, limits: WorkflowLimits): Promise<GmplHostSnapshot> {
  return { profile, registry: researchMasValue(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'research-patterns',
    roles: [], handlers: [], tools: [], contextAdapters: [], templates: [], subgraphs: [],
    messageAdapters: [{ id: 'json-schema', version: '0.1' }, ...researchArtifacts.prompts.map(prompt => ({ id: 'gmpl-' + prompt.id, version: prompt.revision }))] })),
    config: researchMasValue(await createMasConfigCatalog({ profiles: [profile], tools: [], contexts: [], limits })) };
}
export async function prepareResearchPattern(purpose: ResearchPatternPurpose, host: GmplHostSnapshot) {
  const catalog = value(await createGmplCatalog(researchArtifacts));
  const domain = value(await createResearchDomainBinding(purpose));
  const recipe = catalog.recipe(purpose === 'hypothesis' ? 'research-debate' : 'research-' + purpose)!;
  const materialized = value(await materializeGmplTemplate(recipe, domain, host, catalog));
  const prepared = value(await instantiateGmplPattern(materialized, {}, host, catalog));
  return { ...prepared, materialized, contentCatalog: catalog, bindings: value(createGmplHostBindings(materialized, catalog)) };
}
export type PreparedResearchPattern = Awaited<ReturnType<typeof prepareResearchPattern>>;
