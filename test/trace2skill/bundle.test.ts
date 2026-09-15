/**
 * Import refuses every unsafe name rather than repairing it, materialization
 * writes into a fresh directory only, and neither ever touches the bytes of
 * the directory it read.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { importBundle, normalizePath, sealSkillBundle, type ImportedFile, type SkillArtifactStore } from '@tangleai/trace2skill';
import { materializeBundle, readBundleDirectory } from '@tangleai/trace2skill/node';
import { FIXTURE, FROZEN_BUNDLE_ID, SCOPE, readFrozenSkill } from './fixture.ts';

const bytes = (text: string) => new TextEncoder().encode(text);
const ROOT = bytes('# Tabular extraction\n\nAnswer one question.\n');
const options = { scopeKey: SCOPE, mode: 'deepening' as const, origin: 'human-import' as const };

async function scratch(): Promise<{ directory: string, cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-skill-'));
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

it('escaping symlinks and traversal are refused', async () => {
  for (const path of ['../escape.md', '/etc/passwd', 'references/a b.md', 'scripts\\run.sh', 'docs/notes.md', '.',
    'references/../../out.md', 'references/a\u0000.md', 'C:/skill/SKILL.md', '', 'references//a.md']) {
    const refused = normalizePath(path);
    assert.ok(!refused.valid, path);
    assert.equal(refused.issues[0].code, 'TT2S1003');
  }
  assert.ok(normalizePath('SKILL.md').valid);
  assert.ok(normalizePath('references/csv-conventions.md').valid);

  const duplicate = await importBundle([
    { path: 'SKILL.md', bytes: ROOT },
    { path: 'references/a.md', bytes: bytes('# a\n') },
    { path: 'references/a.md', bytes: bytes('# b\n') },
  ], options);
  assert.ok(!duplicate.valid);
  assert.equal(duplicate.issues[0].code, 'TT2S1003');

  const oversized = await importBundle([
    { path: 'SKILL.md', bytes: ROOT },
    { path: 'assets/big.txt', bytes: bytes('x'.repeat(2048)) },
  ], { ...options, profile: { id: 'tight', maxFiles: 8, maxFileBytes: 1024, maxTotalBytes: 4096, requiredFrontmatter: [], requiredTools: [] } });
  assert.ok(!oversized.valid);
  assert.equal(oversized.issues[0].code, 'TT2S1003');

  const traversal = await importBundle([{ path: 'SKILL.md', bytes: ROOT }, { path: '../escape.md', bytes: ROOT }], options);
  assert.ok(!traversal.valid);
  assert.equal(traversal.issues[0].code, 'TT2S1003');

  const { directory, cleanup } = await scratch();
  try {
    const source = join(directory, 'skill'), outside = join(directory, 'outside');
    await cp(join(FIXTURE, 'skills/s0-human'), source, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'secret.md'), '# secret\n');
    const before = createHash('sha256').update(await readFile(join(source, 'SKILL.md'))).digest('hex');
    const clean = await readBundleDirectory(source);
    assert.ok(clean.valid, clean.valid ? '' : JSON.stringify(clean.issues));
    const sealed = await importBundle(clean.value, options);
    assert.ok(sealed.valid);
    assert.equal(sealed.value.bundle.id, FROZEN_BUNDLE_ID, 'the frozen directory keeps its registered identity');

    await symlink(join(outside, 'secret.md'), join(source, 'references/leak.md'));
    const escaped = await readBundleDirectory(source);
    assert.ok(!escaped.valid);
    assert.equal(escaped.issues[0].code, 'TT2S1003');
    assert.match(escaped.issues[0].detail, /leaves the directory/);
    assert.equal(createHash('sha256').update(await readFile(join(source, 'SKILL.md'))).digest('hex'), before, 'the source bytes are unchanged');
    assert.equal(await readFile(join(outside, 'secret.md'), 'utf8'), '# secret\n');
  }
  finally { await cleanup(); }
});

it('materializing writes a fresh directory and refuses a populated one', async () => {
  const frozen = await readFrozenSkill();
  const { directory, cleanup } = await scratch();
  try {
    const target = join(directory, 'out');
    const written = await materializeBundle(frozen, target);
    assert.ok(written.valid, written.valid ? '' : JSON.stringify(written.issues));
    assert.deepEqual(written.value, ['SKILL.md', 'references/csv-conventions.md']);
    assert.equal(await readFile(join(target, 'SKILL.md'), 'utf8'), await readFile(join(FIXTURE, 'skills/s0-human/SKILL.md'), 'utf8'));
    const again = await materializeBundle(frozen, target);
    assert.ok(!again.valid, 'a populated target is refused');
    assert.equal(again.issues[0].code, 'TT2S1003');
    assert.equal((await readdir(target)).length, 2);
    const round = await readBundleDirectory(target);
    assert.ok(round.valid);
    const resealed = await importBundle(round.value, options);
    assert.ok(resealed.valid);
    assert.equal(resealed.value.bundle.id, frozen.bundle.id, 'materialize and import round-trip the identity');
  }
  finally { await cleanup(); }
});

it('binary bytes need an injected artifact store and never enter a row', async () => {
  const blob = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
  const files: ImportedFile[] = [{ path: 'SKILL.md', bytes: ROOT }, { path: 'assets/logo.png', bytes: blob }];
  const without = await importBundle(files, options);
  assert.ok(!without.valid);
  assert.equal(without.issues[0].code, 'TT2S1003');

  const held = new Map<string, Uint8Array>();
  const artifacts: SkillArtifactStore = {
    async put(value) { const address = createHash('sha256').update(value).digest('hex'); held.set(address, value); return address; },
    async get(address) { return held.get(address); },
  };
  const imported = await importBundle(files, { ...options, artifacts });
  assert.ok(imported.valid, imported.valid ? '' : JSON.stringify(imported.issues));
  const stored = imported.value.files.find(file => file.path === 'assets/logo.png')!;
  assert.equal(stored.encoding, 'binary');
  assert.equal(stored.content, null, 'a row keeps a hash, never the blob');
  assert.equal(stored.size, blob.length);
  assert.ok(held.has(stored.address!));

  const resealed = await sealSkillBundle(imported.value.files, { ...options, parentId: null });
  assert.ok(resealed.valid);
  assert.equal(resealed.value.bundle.id, imported.value.bundle.id, 'sealing is idempotent over the same files');
});

it('an empty directory and a directory with no root page are refused', async () => {
  const empty = await importBundle([], options);
  assert.ok(!empty.valid);
  assert.equal(empty.issues[0].code, 'TT2S1005');
  const rootless = await importBundle([{ path: 'references/a.md', bytes: bytes('# a\n') }], options);
  assert.ok(!rootless.valid);
  assert.equal(rootless.issues[0].code, 'TT2S1005');
});
