/** The website consumes Tangle workspace source and installed JarenJS packages. */
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFoundationArtifacts, verifyFoundationArtifacts } from '../../scripts/jaren-artifacts.ts';

export async function verifyPageSources(repository: string, resolveModule = (name: string) => import.meta.resolve(name)) {
  const root = await realpath(repository);
  const page = JSON.parse(await readFile(join(root, 'apps/pages/package.json'), 'utf8'));
  const release = JSON.parse(await readFile(join(root, 'release.config.json'), 'utf8'));
  const sources = new Map<string, string>();
  for (const directory of release.packages) {
    const pkg = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'));
    sources.set(pkg.name, join(root, directory, pkg.main));
  }
  for (const [name, version] of Object.entries(page.dependencies)) {
    const entry = await realpath(fileURLToPath(resolveModule(name)));
    if (name.startsWith('@tangleai/')) {
      assert.ok(sources.has(name), `${name}: not in the public workspace source group`);
      const expected = await realpath(sources.get(name)!);
      assert.equal(entry, expected, `${name}: the website must build local Tangle source, not a published package`);
    } else {
      assert.ok(name.startsWith('@jarenjs/'), `Unexpected website runtime dependency ${name}`);
      const packageRoot = join(root, 'node_modules', name);
      assert.equal(await realpath(packageRoot), packageRoot, `${name}: the website must use the npm installation, not a source link`);
      assert.ok(entry.startsWith(packageRoot + sep), `${name}: the website must use the npm installation`);
      const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
      assert.equal(pkg.version, version, `${name}: installed JarenJS version mismatch`);
    }
  }
  // The documented private Pages bootstrap exception is exact and stays outside runtime dependencies.
  const sqlite = '@sqlite.org/sqlite-wasm', sqliteRoot = join(root, 'node_modules', sqlite);
  assert.equal(page.devDependencies?.[sqlite], '3.53.0-build1', 'Pages SQLite bootstrap version is unqualified');
  assert.equal(await realpath(sqliteRoot), sqliteRoot, 'Pages SQLite bootstrap must be an installed package');
  const sqlitePackage = JSON.parse(await readFile(join(sqliteRoot, 'package.json'), 'utf8'));
  assert.equal(sqlitePackage.version, page.devDependencies[sqlite], 'Pages SQLite bootstrap installation differs');
  const wasm = await readFile(join(sqliteRoot, 'dist/sqlite3.wasm'));
  assert.equal(wasm.subarray(0, 4).toString('hex'), '0061736d', 'Pages SQLite WASM asset is missing or invalid');
  await readFile(join(sqliteRoot, 'dist/sqlite3-opfs-async-proxy.js'));
  const candidate = readFoundationArtifacts(root);
  if (candidate) {
    verifyFoundationArtifacts(root, true);
    return { tangle:'workspace', jarenjs:'candidate-artifacts', foundation:{ commit:candidate.source.commit, patchSha256:candidate.source.patchSha256 } } as const;
  }
  return { tangle: 'workspace', jarenjs: 'npm' } as const;
}
