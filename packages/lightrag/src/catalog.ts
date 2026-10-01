/** Compiled prompt data is the complete runtime source of graph instructions. */
import catalog from '../artifacts/prompts.json' with { type: 'json' };
import { validateLightRagShape } from './schema.ts';
import { lightragMust } from './errors.ts';
import type { LightRagPromptArtifact } from './contracts.gen.ts';
export const LIGHTRAG_PROMPTS = lightragMust(validateLightRagShape('lightRagPromptCatalog',catalog));
export function lightRagPrompt(role: LightRagPromptArtifact['role']): LightRagPromptArtifact {
    const artifact=LIGHTRAG_PROMPTS.packs.find(pack=>pack.role===role);
    if(!artifact)throw new TypeError('Unknown compiled graph role.');
    return artifact;
}
