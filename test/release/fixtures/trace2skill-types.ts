import {
  compilePatch, importBundle, planRollback, sealSkillBundle, trace2SkillPrompt,
  type CompiledPatch, type PatchOperation, type SkillBundle, type SkillHead, type SkillSnapshot,
  type Trace2SkillOutcome, type Trace2SkillPromptRole,
} from '@tangleai/trace2skill';
import { createTrace2SkillDbStore } from '@tangleai/store';

const role: Trace2SkillPromptRole = 'executor';
const revision: string = trace2SkillPrompt(role).revision;
void revision; void sealSkillBundle; void createTrace2SkillDbStore; void compilePatch;

const imported: Promise<Trace2SkillOutcome<SkillSnapshot>> = importBundle(
  [{ path: 'SKILL.md', bytes: new TextEncoder().encode('# typed\n') }],
  { scopeKey: 'typed', mode: 'deepening', origin: 'human-import' },
);
void imported.then(outcome => { if (outcome.valid) { const bundle: SkillBundle = outcome.value.bundle; void bundle; } });

const head: SkillHead = { versionId: null, revision: 0 };
const planned: Trace2SkillOutcome<SkillHead> = planRollback(head, head, { bundleId: 'a'.repeat(64), status: 'archived' });
void planned;

const operation: PatchOperation = { op: 'create_file', path: 'references/units.md', group: 'g', content: '# Units\n' };
void operation;
// @ts-expect-error the patch verbs are closed
const unknown: PatchOperation = { op: 'rewrite_everything', path: 'SKILL.md', group: 'g', content: '' };
void unknown;
// @ts-expect-error a bundle mode is deepening or creation
void importBundle([], { scopeKey: 'typed', mode: 'sideways', origin: 'human-import' });
// @ts-expect-error a compiled patch is produced, never authored
const forged: CompiledPatch = { hunks: [] };
void forged;
