/** The website consumes Tangle workspace source and installed JarenJS packages. */
import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyPageSources(repository: string, resolveModule = (name: string) => import.meta.resolve(name)) {
  const root = await realpath(repository);
  const page = JSON.parse(await readFile(join(root, 'apps/pages/package.json'), 'utf8'));
  for (const [name, version] of Object.entries(page.dependencies)) {
    const entry = await realpath(fileURLToPath(resolveModule(name)));
    if (name.startsWith('@tangleai/')) {
      const expected = await realpath(join(root, 'packages', name.slice('@tangleai/'.length), 'src/index.ts'));
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
  return { tangle: 'workspace', jarenjs: 'npm' } as const;
}
