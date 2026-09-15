/**
 * Where a run's frozen directory comes from.
 *
 * A run pins one starting directory before its first model call: deepening
 * imports one a human wrote, creation seals the trajectory-blind draft. Both
 * arrive as bytes the caller already gathered — nothing here opens a live
 * source directory, because a directory that can change under a run cannot be
 * the hash every rollout, analysis and merge node names.
 */
import { importBundle, SKILL_ROOT_FILE, type ImportedFile, type SkillArtifactStore, type SkillSnapshot } from './bundle.ts';
import { trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import type { SkillFormatProfile } from './format.ts';
import type { SkillBundle } from './contracts.gen.ts';
import type { Trace2SkillStore } from './store.ts';

export interface ImportS0Options {
  scopeKey: string;
  mode?: SkillBundle['mode'];
  origin?: SkillBundle['origin'];
  parentId?: string | null;
  profile?: SkillFormatProfile;
  artifacts?: SkillArtifactStore;
}

/**
 * Seal a starting directory and store it staged. The stored record wins on a
 * replay of identical bytes and refuses differing ones, so two runs over the
 * same directory share one identity rather than forking it.
 */
export async function importS0(
  store: Trace2SkillStore,
  files: readonly ImportedFile[],
  options: ImportS0Options,
): Promise<Trace2SkillOutcome<SkillSnapshot>> {
  const imported = await importBundle(files, {
    scopeKey: options.scopeKey,
    mode: options.mode ?? 'deepening',
    origin: options.origin ?? 'human-import',
    parentId: options.parentId ?? null,
    profile: options.profile,
    artifacts: options.artifacts,
  });
  if (!imported.valid) return imported;
  const stored = await store.putSnapshot(imported.value);
  if (!stored.valid) return trace2SkillRefusal<SkillSnapshot>(stored.issues);
  return { valid: true, value: { bundle: stored.value, files: imported.value.files } };
}

/**
 * The root page's bytes, which a host composes into a request as data. It is
 * never re-parsed: whatever the directory says is what the executor reads.
 */
export function skillRootText(snapshot: SkillSnapshot): Trace2SkillOutcome<string> {
  const root = snapshot.files.find(file => file.path === SKILL_ROOT_FILE);
  if (root === undefined || root.content === null || root.content.trim() === '')
    return trace2SkillRefuse<string>('TT2S1005', `/files/${SKILL_ROOT_FILE}`, 'the directory has no readable root page');
  return { valid: true, value: root.content };
}
