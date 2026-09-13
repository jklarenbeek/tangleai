import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glob } from 'node:fs/promises';
import { win32 } from 'node:path';
import { gmplPromptPaths, gmplPromptStage, gmplPromptFiles } from '../../scripts/gmpl-sources.ts';
import { gmplSchemaOf } from '@tangleai/gmpl';
import { sourceManifest } from '../../benchmark/lib/source-manifest.ts';
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
