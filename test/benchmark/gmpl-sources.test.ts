import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glob, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { win32, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gmplPromptPaths, gmplPromptStage, gmplPromptFiles } from '../../scripts/gmpl-sources.ts';
import { gmplSchemaOf } from '@tangleai/gmpl';
import { sourceManifest } from '../../benchmark/lib/source-manifest.ts';
const exec = promisify(execFile);
async function sourceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'tangle source é-'));
  const git = (...args: string[]) => exec('git', args, { cwd: root });
  await mkdir(join(root, 'packages/sample/src'), { recursive: true });
  await writeFile(join(root, '.gitignore'), 'dist/\ncache/\nforced.ts\n');
  await writeFile(join(root, 'packages/sample/src/main.ts'), 'export const value = 1;\n');
  await git('init', '--quiet'); await git('add', '.');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Create source fixture');
  return { root, git, close: () => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }) };
}
test('native Windows and POSIX prompt inventories produce the same fourteen supported stages', async () => {
  const paths: string[] = [];
  for await (const path of glob('prompts/gmpl/**/*.toml')) paths.push(path.replaceAll('\\', '/'));
  assert.equal(paths.length, 15);
  const posix = gmplPromptPaths(paths), windows = gmplPromptPaths(paths.map(path => win32.normalize(path)));
  assert.equal(posix.length, 14); assert.deepEqual(windows, posix);
  assert.deepEqual(await gmplPromptFiles(), posix);
  for (const path of posix) {
    const stage = gmplPromptStage(path);
    assert.equal(gmplPromptStage(win32.normalize(path)), stage);
    assert.ok(gmplSchemaOf(stage as Parameters<typeof gmplSchemaOf>[0]));
  }
});
test('source manifests canonicalize and deduplicate native repository separators', async () => {
  const paths = ['package.json', 'packages/core/package.json'];
  const posix = await sourceManifest(process.cwd(), paths);
  const mixed = await sourceManifest(process.cwd(), [...paths, ...paths.map(path => win32.normalize(path))]);
  assert.deepEqual(mixed.files, posix.files); assert.equal(mixed.sha256, posix.sha256);
});
test('source manifest directory roots also retain platform-independent names', async () => {
  const posix = await sourceManifest(process.cwd(), [], ['packages/core/src']);
  const windows = await sourceManifest(process.cwd(), [], [win32.normalize('packages/core/src')]);
  assert.deepEqual(windows.files, posix.files); assert.equal(windows.sha256, posix.sha256);
});
test('ignored compiled declarations cannot change effective source receipts', async t => {
  const fixture = await sourceFixture(); t.after(fixture.close);
  const before = await sourceManifest(fixture.root, [], ['packages']);
  await mkdir(join(fixture.root, 'packages/sample/dist/types'), { recursive: true });
  await writeFile(join(fixture.root, 'packages/sample/dist/types/main.d.ts'), 'export declare const value: 1;\n');
  const after = await sourceManifest(fixture.root, [], ['packages']);
  assert.deepEqual(after.files, before.files);
  assert.equal(after.sha256, before.sha256);
  assert.equal(after.clean, true);
});
test('source receipts include effective edits, new source and tracked files despite ignore rules', async t => {
  const fixture = await sourceFixture(); t.after(fixture.close);
  const before = await sourceManifest(fixture.root, [], ['packages']);
  await writeFile(join(fixture.root, 'packages/sample/src/main.ts'), 'export const value = 2;\n');
  const edited = await sourceManifest(fixture.root, [], ['packages']);
  assert.notEqual(edited.sha256, before.sha256); assert.equal(edited.head, before.head);
  await writeFile(join(fixture.root, 'packages/sample/src/new.ts'), 'export const fresh = true;\n');
  const fresh = await sourceManifest(fixture.root, [], ['packages']);
  assert.notEqual(fresh.sha256, edited.sha256);
  assert.ok(fresh.files.some(file => file.path.endsWith('/new.ts')));
  await writeFile(join(fixture.root, 'packages/sample/src/forced.ts'), 'export const kept = true;\n');
  await fixture.git('add', '--force', 'packages/sample/src/forced.ts');
  const forced = await sourceManifest(fixture.root, [], ['packages']);
  assert.ok(forced.files.some(file => file.path.endsWith('/forced.ts')));
  assert.notEqual(forced.sha256, fresh.sha256);
  assert.equal(forced.clean, false);
  await rm(join(fixture.root, 'packages/sample/src/main.ts'));
  const deleted = await sourceManifest(fixture.root, [], ['packages']);
  assert.ok(!deleted.files.some(file => file.path.endsWith('/main.ts')));
  assert.notEqual(deleted.sha256, forced.sha256);
});
test('explicit ignored inputs remain bound and missing source inputs still fail', async t => {
  const fixture = await sourceFixture(); t.after(fixture.close);
  await mkdir(join(fixture.root, 'cache'));
  await writeFile(join(fixture.root, 'cache/pin.json'), '{"identity":1}\n');
  const source = await sourceManifest(fixture.root, ['cache/pin.json'], ['packages']);
  assert.ok(source.files.some(file => file.path === 'cache/pin.json'));
  await assert.rejects(sourceManifest(fixture.root, [], ['missing-root']), /ENOENT/);
  await assert.rejects(sourceManifest(fixture.root, ['missing.json']), /ENOENT/);
});
