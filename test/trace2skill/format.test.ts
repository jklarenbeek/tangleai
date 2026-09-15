/**
 * The format validator: one non-empty root page, links that resolve inside the
 * directory, no duplicate names, size bounds, and the frontmatter keys or
 * declared tools a host profile requires. Content is never rewritten.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { MINIMAL_SKILL_PROFILE, draftsOf, internalLinksOf, validateFormat,
  type SkillFileDraft, type SkillFormatProfile } from '@tangleai/trace2skill';
import { readFrozenSkill } from './fixture.ts';

const frozen = await readFrozenSkill();
const page = (path: string, content: string): SkillFileDraft =>
  ({ path, mediaType: 'text/markdown', encoding: 'utf-8', executable: false, content, address: null, sha256: null, size: null });

it('the frozen directory is valid under the minimal profile', () => {
  const checked = validateFormat(draftsOf(frozen.files));
  assert.ok(checked.valid, checked.valid ? '' : JSON.stringify(checked.issues));
  assert.equal(MINIMAL_SKILL_PROFILE.id, 'minimal');
});

it('a missing or empty root page is refused', () => {
  for (const files of [[page('references/a.md', '# a\n')], [page('SKILL.md', '   \n\n')], []]) {
    const refused = validateFormat(files);
    assert.ok(!refused.valid);
    assert.equal(refused.issues[0].code, 'TT2S1005');
  }
});

it('a link that reaches no file in the directory is refused and an internal one resolves', () => {
  const broken = validateFormat([page('SKILL.md', '# root\n\nSee [units](references/units.md).\n')]);
  assert.ok(!broken.valid);
  assert.equal(broken.issues[0].code, 'TT2S1005');
  assert.match(broken.issues[0].detail, /references\/units\.md/);

  const whole = validateFormat([
    page('SKILL.md', '# root\n\nSee [units](references/units.md).\n'),
    page('references/units.md', '# units\n\nBack to [root](../SKILL.md) and [self](#top).\n'),
  ]);
  assert.ok(whole.valid, whole.valid ? '' : JSON.stringify(whole.issues));

  assert.deepEqual(internalLinksOf('references/units.md', '[a](../SKILL.md) [b](./deep/x.md) [c](#top) [d](https://example.test/x.md) [e](x.md#frag)'),
    ['SKILL.md', 'references/deep/x.md', 'references/x.md']);
});

it('duplicate names and size bounds are refused, and the profile bounds are the ones asked for', () => {
  const duplicate = validateFormat([page('SKILL.md', '# root\n'), page('SKILL.md', '# root\n')]);
  assert.ok(!duplicate.valid);
  assert.equal(duplicate.issues[0].code, 'TT2S1005');

  const tight: SkillFormatProfile = { id: 'tight', maxFiles: 1, maxFileBytes: 8, maxTotalBytes: 8, requiredFrontmatter: [], requiredTools: [] };
  const large = validateFormat([page('SKILL.md', '# root\n'), page('references/a.md', 'x'.repeat(64))], tight);
  assert.ok(!large.valid);
  assert.equal(new Set(large.issues.map(issue => issue.code)).size, 1);
  assert.equal(large.issues[0].code, 'TT2S1005');
  assert.ok(large.issues.length >= 3, 'every bound the directory broke is counted');
});

it('a host profile may require frontmatter keys and declared tools', () => {
  const profile: SkillFormatProfile = { ...MINIMAL_SKILL_PROFILE, id: 'host', requiredFrontmatter: ['name', 'scope'], requiredTools: ['skill_read'] };
  const bare = validateFormat([page('SKILL.md', '# root\n')], profile);
  assert.ok(!bare.valid);
  assert.equal(bare.issues.length, 3);
  const complete = validateFormat([page('SKILL.md', '---\nname: tabular\nscope: tabular-extract\n---\n\n# root\n\nUse `skill_read`.\n')], profile);
  assert.ok(complete.valid, complete.valid ? '' : JSON.stringify(complete.issues));
});

it('an unsafe path inside a directory is refused by the validator too', () => {
  const refused = validateFormat([page('SKILL.md', '# root\n'), page('../escape.md', 'x')]);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1003');
});
