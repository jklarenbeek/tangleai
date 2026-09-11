/** Keep published runtime dependencies and the auditable source pin in step. */
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = '0.83.2';
const commit = 'f21b18fa123a6c72a0ca31dbad374ec5a8bf78ff';
const read = async (path: string) => JSON.parse(await readFile(root + path, 'utf8'));
const manifests = ['package.json', 'benchmark/package.json'];
for (const parent of ['packages', 'apps']) {
  for (const entry of await readdir(root + parent, { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(`${parent}/${entry.name}/package.json`);
  }
}
let references = 0;
for (const path of manifests) {
  const pkg = await read(path);
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      if (!name.startsWith('@jarenjs/')) continue;
      assert.equal(range, version, `${path}: ${name} must be exactly ${version}`);
      references++;
    }
  }
}
const lock = await read('package-lock.json');
for (const path of manifests) {
  const entry = path === 'package.json' ? '' : path.slice(0, -'/package.json'.length);
  const pkg = await read(path);
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(lock.packages[entry]?.[section], pkg[section], `${path}: lockfile dependency declarations`);
  }
}
let installed = 0;
for (const [path, raw] of Object.entries(lock.packages)) {
  if (!/(?:^|\/)node_modules\/@jarenjs\/[^/]+$/.test(path)) continue;
  const pkg = raw as { version: string };
  assert.equal(pkg.version, version, `${path}: lockfile version`);
  assert.equal((await read(`${path}/package.json`)).version, version, `${path}: installed version`);
  installed++;
}
assert.ok(installed > 0 && references > 0);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
assert.match(git('ls-files', '--stage', 'vendor/jarenjs'), new RegExp(`^160000 ${commit} 0\\s+vendor/jarenjs$`));
if (await stat(root + 'vendor/jarenjs/package.json').then(() => true, () => false)) {
  assert.equal(git('-C', 'vendor/jarenjs', 'rev-parse', 'HEAD'), commit);
  assert.equal((await read('vendor/jarenjs/package.json')).version, version);
}
console.log(`JarenJS ${version}: ${references} exact references, ${installed} installed packages, source ${commit.slice(0, 12)}`);
