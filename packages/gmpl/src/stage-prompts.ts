/** Participant-specific prompts change domain data, never pattern topology. */
import { equalsJson } from '@jarenjs/core/object';
import type { GmplCatalog } from './catalog.ts';
import type { GmplDomainBinding, GmplPatternRecipe, GmplPromptArtifact } from './contracts.gen.ts';
import { gmplRefuse, type GmplOutcome } from './errors.ts';

const slotted = new Set(['analysis-analyst', 'debate-position', 'debate-rebuttal']);
export function gmplStagePromptId(stage: string, domain: GmplDomainBinding, slot?: number): string {
  return (slot === undefined ? undefined : domain.rolePrompts[`${stage}-${slot}`]) ?? domain.rolePrompts[stage] ?? stage;
}
export function gmplStagePrompts(recipe: GmplPatternRecipe, domain: GmplDomainBinding,
  catalog: GmplCatalog): GmplOutcome<GmplPromptArtifact[]> {
  const prompts = new Map<string, GmplPromptArtifact>();
  const participants = 'participants' in recipe.parameters ? recipe.parameters.participants ?? 2 : 0;
  for (const stage of recipe.stages) {
    const base = catalog.prompt(gmplStagePromptId(stage, domain));
    if (!base) return gmplRefuse('TGMPL1003', '/recipe/stages', `Unknown prompt for ${stage}.`);
    prompts.set(base.id, base);
    if (!slotted.has(stage)) continue;
    for (let slot = 1; slot <= participants; slot++) {
      const prompt = catalog.prompt(gmplStagePromptId(stage, domain, slot));
      if (!prompt) return gmplRefuse('TGMPL1003', `/domain/rolePrompts/${stage}-${slot}`, 'Unknown participant prompt.');
      if (!equalsJson(base.variableSchema, prompt.variableSchema) || !equalsJson(base.outputSchema, prompt.outputSchema))
        return gmplRefuse('TGMPL1004', `/domain/rolePrompts/${stage}-${slot}`, 'Participant prompts must preserve the stage variable and output contracts.');
      prompts.set(prompt.id, prompt);
    }
  }
  return { valid: true, value: [...prompts.values()] };
}
