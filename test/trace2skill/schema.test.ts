/**
 * The closed contracts and the package's shape: an extra member, an unsafe
 * path, an unknown status and a non-hash id are refused, a directory whose id
 * is not its recomputed hash is an identity refusal, importing the root
 * performs no filesystem work, and each logical owner exists exactly once.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { bundleIdOf, trace2SkillSchema, validateTrace2SkillShape, type SkillBundle } from '@tangleai/trace2skill';
import { readFrozenSkill } from './fixture.ts';

const SOURCE = 'packages/trace2skill/src';
const frozen = await readFrozenSkill();

it('the directory contract refuses an extra member, an unsafe path, an unknown status and a non-hash id', () => {
  const bundle = frozen.bundle as unknown as Record<string, unknown>;
  assert.ok(validateTrace2SkillShape<SkillBundle>('skillBundle', bundle).valid);
  for (const broken of [
    { ...bundle, version: 2 },
    { ...bundle, files: [{ path: '/etc/passwd', sha256: 'a'.repeat(64), size: 1 }] },
    { ...bundle, status: 'promoted' },
    { ...bundle, id: 'not-a-hash' },
    { ...bundle, rootFile: 'README.md' },
    { ...bundle, mode: 'sharpening' },
  ]) {
    const refused = validateTrace2SkillShape('skillBundle', broken);
    assert.ok(!refused.valid, JSON.stringify(broken).slice(0, 80));
    assert.equal(refused.issues[0].code, 'TT2S1001');
  }
});

it('a directory whose id is not its recomputed hash is an identity refusal', async () => {
  const recomputed = await bundleIdOf({
    scopeKey: frozen.bundle.scopeKey, mode: frozen.bundle.mode, parentId: frozen.bundle.parentId,
    rootFile: frozen.bundle.rootFile, files: frozen.bundle.files,
  });
  assert.equal(recomputed, frozen.bundle.id);
  const moved = await bundleIdOf({
    scopeKey: frozen.bundle.scopeKey, mode: frozen.bundle.mode, parentId: frozen.bundle.parentId,
    rootFile: frozen.bundle.rootFile, files: [{ path: 'SKILL.md', sha256: 'b'.repeat(64) }],
  });
  assert.notEqual(moved, frozen.bundle.id);
  const { createMemoryTrace2SkillStore } = await import('@tangleai/trace2skill');
  const store = createMemoryTrace2SkillStore();
  const forged = { ...frozen, bundle: { ...frozen.bundle, id: moved } };
  const refused = await store.putSnapshot(forged);
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1002');
});

it('every reserved refusal code is declared by the contract', () => {
  const codes = trace2SkillSchema.$defs.trace2SkillIssue.properties.code.enum;
  assert.deepEqual([...codes], Array.from({ length: 13 }, (_, index) => `TT2S${1001 + index}`));
});

it('importing the root performs no filesystem work and only the node subpath reads files', async () => {
  const modules = (await readdir(SOURCE)).filter(name => name.endsWith('.ts'));
  const reaching: string[] = [];
  for (const name of modules)
    if ((await readFile(join(SOURCE, name), 'utf8')).includes('node:fs')) reaching.push(name);
  assert.deepEqual(reaching, ['node.ts'], 'only the node subpath may reach a filesystem');
  const probe = `
    import { registerHooks } from 'node:module';
    const banned = ['node:fs', 'node:fs/promises', 'fs', 'node:sqlite', 'bun:sqlite', 'node:net', 'node:http', 'node:https', 'node:child_process'];
    const reached = [];
    registerHooks({ resolve(specifier, context, next) {
      if (banned.includes(specifier)) reached.push(context.parentURL + ' -> ' + specifier);
      return next(specifier, context);
    } });
    globalThis.fetch = () => { throw new Error('the root import opened the network'); };
    const loaded = await import('@tangleai/trace2skill');
    if (typeof loaded.compilePatch !== 'function') throw new Error('the barrel is incomplete');
    if (reached.length) throw new Error('the root import graph reaches ' + reached.join(', '));
    process.stdout.write('clean');
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '--eval', probe], { encoding: 'utf8' });
  assert.equal(out, 'clean');
});

it('one path normalizer, one anchor resolver and one format validator exist', () => {
  for (const pattern of ['function normalizePath', 'function resolveAnchor', 'function validateFormat']) {
    const found = execFileSync('grep', ['-rn', pattern, 'packages'], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(found.length, 1, `${pattern} has ${found.length} definitions`);
  }
});
