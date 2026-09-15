/**
 * The skill package's root import, in a browser context: compiling a prompt
 * pack and a directory patch with no filesystem, no store adapter and no
 * provider. Everything that touches `node:fs` lives behind `./node`, so a
 * bundle that reached for it would fail to build rather than fail at runtime.
 */
import {
  MINIMAL_SKILL_PROFILE, applyCompiled, compilePatch, compileTrace2SkillPack, draftsOf, importBundle,
  renderTrace2SkillPrompt, trace2SkillPrompt, validateFormat,
  TRACE2SKILL_PROMPT_CONTRACTS, TRACE2SKILL_PROMPT_ROLES,
} from '@tangleai/trace2skill';

const PACK = [
  '[meta]',
  'id = "browser-check"',
  'version = "1.0.0"',
  'role = "merge"',
  '',
  '[system]',
  'content = "You consolidate proposals into one patch."',
  '',
  '[user]',
  'content = "{{evidence}}"',
].join('\n');

const page = (text) => new TextEncoder().encode(text);

export async function qualifyTrace2SkillBrowser() {
  const root = [
    '# Reading a small table',
    '',
    '## Reading the table',
    '',
    'The first line is a header and is never a row.',
    '',
  ].join('\n');
  const imported = await importBundle([{ path: 'SKILL.md', bytes: page(root) }], { scopeKey: 'browser', mode: 'deepening', origin: 'human-import' });
  if (!imported.valid) throw new Error(JSON.stringify(imported.issues));
  const snapshot = imported.value;
  const frozen = { bundle: snapshot.bundle, files: draftsOf(snapshot.files) };

  const compiled = compilePatch(frozen, {
    id: '0'.repeat(64), runId: '0'.repeat(64), baseHash: frozen.bundle.id,
    sourceRolloutIds: [], sourcePatchIds: [], supportCount: 1,
    reasoning: 'the rule the directory does not yet state',
    operations: [{
      op: 'insert_after', path: 'SKILL.md', group: 'g-1',
      anchor: 'The first line is a header and is never a row.',
      content: 'An empty line is never a row either.',
    }],
    changelog: [], validation: { state: 'pending', issues: [] },
  }, { profile: MINIMAL_SKILL_PROFILE });
  if (!compiled.valid) throw new Error(JSON.stringify(compiled.issues));
  const applied = applyCompiled(frozen.files, compiled.value, MINIMAL_SKILL_PROFILE);
  if (!applied.valid) throw new Error(JSON.stringify(applied.issues));
  const format = validateFormat(applied.value, MINIMAL_SKILL_PROFILE);

  const pack = await compileTrace2SkillPack(PACK, { ...TRACE2SKILL_PROMPT_CONTRACTS.merge, role: 'merge' });
  if (!pack.valid) throw new Error(JSON.stringify(pack.issues));
  const rendered = renderTrace2SkillPrompt(pack.value, { evidence: '{"patches":[]}' });
  if (!rendered.valid) throw new Error(JSON.stringify(rendered.issues));

  return {
    bundleId: snapshot.bundle.id,
    hunks: compiled.value.hunks.length,
    withheld: compiled.value.withheld.length,
    lines: applied.value[0].content.split('\n').length,
    formatValid: format.valid,
    packRevision: pack.value.revision,
    rendered: rendered.value.user,
    publishedRoles: TRACE2SKILL_PROMPT_ROLES.length,
    executorRevision: trace2SkillPrompt('executor').revision,
  };
}
