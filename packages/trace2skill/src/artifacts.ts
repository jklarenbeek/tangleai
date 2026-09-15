/**
 * The compiled prompt set every role defaults to.
 *
 * A run never reads a pack from a source path: the packs are compiled once by
 * the repository's build and an installed consumer imports the resulting JSON,
 * so the prompt a role renders and the revision its idempotency keys name are
 * the same immutable document everywhere. A host that wants different prompts
 * compiles its own packs and passes the artifacts in.
 */
import catalog from '../artifacts/prompts.json' with { type: 'json' };
import { immutableJson } from './identity.ts';
import type { Trace2SkillPromptArtifact, Trace2SkillPromptCatalog, Trace2SkillPromptRole } from './contracts.gen.ts';

/** The published catalogue: one compiled pack per addressed role. */
export const TRACE2SKILL_PROMPTS: Trace2SkillPromptCatalog = immutableJson(catalog as unknown as Trace2SkillPromptCatalog);

const byRole = new Map<Trace2SkillPromptRole, Trace2SkillPromptArtifact>(
  TRACE2SKILL_PROMPTS.prompts.map(prompt => [prompt.role, prompt]));

/** The compiled pack for one role. A role with no pack is a build error, not a runtime choice. */
export function trace2SkillPrompt(role: Trace2SkillPromptRole): Trace2SkillPromptArtifact {
  const artifact = byRole.get(role);
  if (artifact === undefined) throw new Error(`the compiled prompt set carries no ${role} pack`);
  return artifact;
}
