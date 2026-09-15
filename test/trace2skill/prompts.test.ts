/**
 * The versioned role packs.
 *
 * Two things are proved here that nothing else can prove: that a malformed
 * pack is a value with a pointer rather than a thrown string, and that every
 * byte a run substitutes is data — a trajectory that happens to contain a
 * placeholder is written into the request exactly as it reads, never scanned
 * a second time.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseToml } from '@jarenjs/josl';
import {
  TRACE2SKILL_PROMPTS, TRACE2SKILL_PROMPT_CONTRACTS, TRACE2SKILL_PROMPT_POLICY, TRACE2SKILL_PROMPT_ROLES,
  compileTrace2SkillPack, renderTrace2SkillPrompt, trace2SkillPrompt, trace2SkillPromptCatalog,
  validateTrace2SkillPromptArtifact,
  type Trace2SkillOutcome, type Trace2SkillPromptArtifact, type Trace2SkillPromptRole,
} from '@tangleai/trace2skill';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PACK_DIR = 'prompts/trace2skill';
const LEGACY_DIR = 'benchmark/fixtures/trace2skill/legacy-packs';

const sourceOf = (role: Trace2SkillPromptRole): Promise<string> => readFile(`${ROOT}${PACK_DIR}/${role}.toml`, 'utf8');

const must = <T>(outcome: Trace2SkillOutcome<T>): T => {
  if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues));
  return outcome.value;
};

const refusal = <T>(outcome: Trace2SkillOutcome<T>): { code: string, path: string, detail: string } => {
  assert.equal(outcome.valid, false, 'the pack was expected to be refused');
  return (outcome as { valid: false, issues: Array<{ code: string, path: string, detail: string }> }).issues[0];
};

/** A pack built from parts, so one malformation at a time can be measured. */
function pack(role: Trace2SkillPromptRole, system: string, user: string): string {
  return `[meta]\nid = "${role}"\nversion = "1.0.0"\nrole = "${role}"\n\n[system]\ncontent = """${system}"""\n\n[user]\ncontent = """${user}"""\n`;
}

const compile = (role: Trace2SkillPromptRole, source: string): Promise<Trace2SkillOutcome<Trace2SkillPromptArtifact>> =>
  compileTrace2SkillPack(source, { ...TRACE2SKILL_PROMPT_CONTRACTS[role], role });

it('five packs compile, and two builds of one source are byte-identical', async () => {
  const built: Trace2SkillPromptArtifact[] = [];
  for (const role of TRACE2SKILL_PROMPT_ROLES) {
    const source = await sourceOf(role);
    const once = must(await compile(role, source));
    const twice = must(await compile(role, source));
    assert.equal(JSON.stringify(once), JSON.stringify(twice), `${role} does not build reproducibly`);
    assert.equal(once.policyVersion, TRACE2SKILL_PROMPT_POLICY);
    assert.equal(once.role, role);
    assert.equal(once.revision, trace2SkillPrompt(role).revision, `${role}'s published artifact is not this source`);
    built.push(once);
  }
  assert.equal(built.length, 5);
  const catalog = must(await trace2SkillPromptCatalog(built));
  assert.equal(catalog.revision, TRACE2SKILL_PROMPTS.revision, 'the committed catalogue is not what these sources compile to');
  for (const artifact of built) must(await validateTrace2SkillPromptArtifact(artifact));
});

it('a comment or a line ending moves the source digest and the revision', async () => {
  const source = await sourceOf('merge');
  const base = must(await compile('merge', source));
  const commented = must(await compile('merge', `# one more line of authorship\n${source}`));
  assert.notEqual(commented.sourceDigest, base.sourceDigest, 'a comment left the source digest where it was');
  assert.notEqual(commented.revision, base.revision, 'a comment left the revision where it was');
  const crlf = must(await compile('merge', source.replaceAll('\n', '\r\n')));
  assert.notEqual(crlf.sourceDigest, base.sourceDigest, 'a line ending left the source digest where it was');
  assert.notEqual(crlf.revision, base.revision, 'a line ending left the revision where it was');
  // The compiled contract is the same question asked the same way; only the
  // identity of the bytes that asked it moved.
  assert.equal(JSON.stringify(crlf.userStylesheet), JSON.stringify(base.userStylesheet));
});

it('every malformed pack is a refusal with the pointer it happened at', async () => {
  const cases: Array<[string, string, string]> = [
    ['unclosed conditional', pack('merge', 'static', 'a{{#if evidence}}b'), '/user/content'],
    ['undeclared name', pack('merge', 'static', '{{rollout}}'), '/user/content'],
    ['prohibited name', pack('merge', 'static', '{{__proto__}}'), '/user/content'],
    ['unopened close', pack('merge', 'static', 'a}}b{{evidence}}'), '/user/content'],
    ['unclosed placeholder', pack('merge', 'static', '{{evidence'), '/user/content'],
    ['stray end of block', pack('merge', 'static', '{{evidence}}{{/if}}'), '/user/content'],
    ['placeholder in system', pack('merge', 'static {{evidence}}', '{{evidence}}'), '/system/content'],
    ['unused declaration', pack('executor', 'static', '{{task}}'), '/variables/inputs'],
  ];
  for (const [name, source, pointer] of cases) {
    const role = source.includes('"executor"') ? 'executor' : 'merge';
    const issue = refusal(await compile(role, source));
    assert.equal(issue.code, 'TT2S1001', `${name} refused as ${issue.code}`);
    assert.equal(issue.path, pointer, `${name} refused at ${issue.path}`);
  }
});

it('a pack that is not TOML carries the parser\'s own error, and a mislabeled role is refused', async () => {
  const broken = await compileTrace2SkillPack('[meta\nid = "merge"', { ...TRACE2SKILL_PROMPT_CONTRACTS.merge, role: 'merge' });
  const issue = refusal(broken);
  assert.equal(issue.code, 'TT2S1001');
  assert.equal(issue.path, '');
  const cause = (broken as { valid: false, issues: Array<{ cause?: { message?: string } }> }).issues[0].cause;
  assert.ok(cause !== undefined && String(cause.message).length > 0, 'the JOSL failure did not travel as a cause');

  const mislabeled = refusal(await compile('merge', pack('draft', 'static', '{{evidence}}')));
  assert.equal(mislabeled.code, 'TT2S1001');
  assert.equal(mislabeled.path, '/meta/role');

  const wrongShape = refusal(await compileTrace2SkillPack('[meta]\nid = "merge"\nversion = "1"\nrole = "merge"\n',
    { ...TRACE2SKILL_PROMPT_CONTRACTS.merge, role: 'merge' }));
  assert.equal(wrongShape.code, 'TT2S1001');
});

it('substituted text is data: ten render fixtures write every byte as it reads', async () => {
  const hostile = [
    'a literal {{x}} and a balanced {{#if x}}block{{/if}}',
    'a dollar $ and a path $.variables.evidence',
    '{"nested": {"json": [1, 2, {"deep": true}]}}',
    'line one\nline two\n\tindented',
  ].join('\n');
  const minimal: Record<Trace2SkillPromptRole, Record<string, string>> = {
    'draft': { scope: 'd' },
    'executor': { task: 't' },
    'success-analyst': { evidence: 'e' },
    'error-analyst': { evidence: 'e' },
    'merge': { evidence: 'e' },
  };
  const full: Record<Trace2SkillPromptRole, Record<string, string>> = {
    'draft': { scope: hostile },
    'executor': { task: hostile, inputs: `- ${hostile}` },
    'success-analyst': { evidence: hostile },
    'error-analyst': { evidence: hostile },
    'merge': { evidence: hostile },
  };
  let rendered = 0;
  for (const role of TRACE2SKILL_PROMPT_ROLES) {
    const artifact = trace2SkillPrompt(role);
    const small = must(renderTrace2SkillPrompt(artifact, minimal[role]));
    assert.equal(small.system, artifact.pack.system.content, `${role} rewrote its own system text`);
    assert.ok(!small.user.includes('{{'), `${role} left a placeholder unrendered`);
    rendered++;
    const large = must(renderTrace2SkillPrompt(artifact, full[role]));
    assert.ok(large.user.includes(hostile), `${role} did not write its variable verbatim`);
    assert.ok(large.user.includes('{{x}}') && large.user.includes('$.variables.evidence'),
      `${role} reinterpreted data as template`);
    rendered++;
  }
  assert.equal(rendered, 10);

  // The executor's one conditional: an empty value renders the question alone.
  const executor = trace2SkillPrompt('executor');
  assert.equal(must(renderTrace2SkillPrompt(executor, { task: 'count', inputs: '' })).user, 'count');
  assert.equal(must(renderTrace2SkillPrompt(executor, { task: 'count' })).user, 'count');
  assert.equal(must(renderTrace2SkillPrompt(executor, { task: 'count', inputs: '- a.csv' })).user,
    'count\n\nFiles named by this task:\n- a.csv');

  // A value the closed schema does not describe is a refusal, not a render.
  const refused = renderTrace2SkillPrompt(executor, { task: 'count', unknown: 'x' });
  assert.equal(refused.valid, false);
  assert.equal(refusal(refused).code, 'TT2S1001');
  assert.equal(renderTrace2SkillPrompt(executor, { task: 1 }).valid, false, 'a non-scalar task was rendered');
});

it('an artifact that disagrees with its own pack is refused', async () => {
  const artifact = trace2SkillPrompt('merge');
  const moved = { ...artifact, id: 'somewhere-else' };
  assert.equal(refusal(await validateTrace2SkillPromptArtifact(moved)).code, 'TT2S1002');
  const restamped = { ...artifact, pack: { ...artifact.pack, user: { content: '{{evidence}} and more' } } };
  assert.equal(refusal(await validateTrace2SkillPromptArtifact(restamped)).code, 'TT2S1002');
  const short = await trace2SkillPromptCatalog(TRACE2SKILL_PROMPTS.prompts.slice(0, 4));
  assert.equal(refusal(short).code, 'TT2S1001');
});

it('the pack directory holds exactly five, and the retired packs are fixtures only', async () => {
  const authored = (await readdir(`${ROOT}${PACK_DIR}`)).sort();
  assert.deepEqual(authored, [...TRACE2SKILL_PROMPT_ROLES].map(role => `${role}.toml`).sort());
  const legacy = (await readdir(`${ROOT}${LEGACY_DIR}`)).sort();
  assert.deepEqual(legacy, ['analyst.toml', 'injection.toml', 'merger.toml']);
  // They are readable data and not this method: none of them is a role pack.
  for (const name of legacy) {
    const parsed = parseToml(await readFile(`${ROOT}${LEGACY_DIR}/${name}`, 'utf8')) as Record<string, unknown>;
    assert.ok(Object.hasOwn(parsed, 'messages'), `${name} is not the retired pack shape`);
    assert.equal(await compileTrace2SkillPack(await readFile(`${ROOT}${LEGACY_DIR}/${name}`, 'utf8'),
      { ...TRACE2SKILL_PROMPT_CONTRACTS.merge }).then(outcome => outcome.valid), false,
    `${name} compiled as a role pack`);
  }
});

it('the package holds one placeholder scanner, one TOML reader and one renderer', async () => {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}/${entry.name}`);
      else if (entry.name.endsWith('.ts')) files.push(`${dir}/${entry.name}`);
    }
  };
  await walk(`${ROOT}packages/trace2skill/src`);
  const scanners: string[] = [];
  const tomlReaders: string[] = [];
  const renderers: string[] = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (source.includes(`{{${'#'}if`)) scanners.push(file);
    if (source.includes('parseToml')) tomlReaders.push(file);
    if (source.includes('compileJtltStylesheet')) renderers.push(file);
    assert.ok(!/\bJSON5|\bnew Function\(|require\('toml'\)/.test(source), `${file} reaches for another parser`);
  }
  assert.deepEqual(scanners.map(file => file.slice(ROOT.length)), ['packages/trace2skill/src/prompts.ts']);
  assert.deepEqual(tomlReaders.map(file => file.slice(ROOT.length)), ['packages/trace2skill/src/prompts.ts']);
  assert.deepEqual(renderers.map(file => file.slice(ROOT.length)), ['packages/trace2skill/src/prompts.ts']);
});

it('the committed artifact is exactly what the sources compile to', () => {
  execFileSync(process.execPath, ['scripts/trace2skill-artifacts.ts', '--check'], { cwd: ROOT, encoding: 'utf8' });
});
