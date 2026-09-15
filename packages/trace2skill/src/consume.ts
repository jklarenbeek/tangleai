/**
 * Using an evolved directory, outside a run.
 *
 * A host that simply wants the active skill does not need an evolution run:
 * it needs the root page composed into its own system text and one read-only
 * tool for the rest of the directory. That is the whole method at inference
 * time — the directory is preloaded and read directly, with no retrieval
 * index, no recalled skill bank and no similarity between the skill and the
 * task. These are the same two pieces the run's own executor uses, so a host
 * request and a measured row differ in the task, never in how the skill
 * reaches the model.
 */
import { trace2SkillRefuse, type Trace2SkillOutcome } from './errors.ts';
import { skillRootText } from './init.ts';
import type { SkillSnapshot } from './bundle.ts';
import type { Trace2SkillStore } from './store.ts';

/** One file of the active directory, by path. Reachable paths are the directory's own. */
export const SKILL_READ_SCHEMA = Object.freeze({
  type: 'object',
  required: ['path'],
  additionalProperties: false,
  properties: { path: { type: 'string', minLength: 1, maxLength: 512 } },
});

export interface SkillTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: { path: string }): Record<string, unknown>;
}

/**
 * The system text a request carries: the caller's own instructions with the
 * root page appended as data. The page is never re-parsed — whatever the
 * directory says is what the model reads.
 */
export function composeSkillSystem(baseSystem: string, snapshot: SkillSnapshot | null): Trace2SkillOutcome<string> {
  if (snapshot === null) return { valid: true, value: baseSystem };
  const root = skillRootText(snapshot);
  if (!root.valid) return root;
  return { valid: true, value: baseSystem === '' ? root.value : `${baseSystem}\n\n${root.value}` };
}

/**
 * The one read-only tool over the rest of the directory. A page the directory
 * does not carry is a refusal the model can read, not a thrown error, and a
 * page stored by address answers with its receipt rather than inventing bytes.
 */
export function skillReadTool(snapshot: SkillSnapshot): SkillTool {
  const pages = new Map(snapshot.files.map(file => [file.path, file]));
  return {
    name: 'skill_read',
    description: 'Read one file of the active skill directory under references/, scripts/ or assets/.',
    inputSchema: SKILL_READ_SCHEMA as Record<string, unknown>,
    execute: ({ path }: { path: string }): Record<string, unknown> => {
      const page = pages.get(path);
      if (page === undefined) return { error: `the skill directory carries no ${path}`, code: 'TT2S1005' };
      if (page.content === null)
        return { path, mediaType: page.mediaType, encoding: page.encoding, size: page.size, sha256: page.sha256 };
      return { path, content: page.content };
    },
  };
}

/** The directory a scope is currently serving, or a refusal naming the scope that has none. */
export async function activeBundle(store: Trace2SkillStore, scopeKey: string): Promise<Trace2SkillOutcome<SkillSnapshot>> {
  const head = await store.head(scopeKey);
  if (head.versionId === null)
    return trace2SkillRefuse<SkillSnapshot>('TT2S1010', '/head', `${scopeKey} has no active directory`);
  return store.getSnapshot(head.versionId);
}
