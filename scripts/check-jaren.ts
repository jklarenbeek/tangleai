/** Keep published runtime dependencies and the auditable source pin in step. */
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFoundationArtifacts, verifyFoundationArtifacts, verifyFoundationSourcePin, artifactSpecifier } from './jaren-artifacts.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const candidate = readFoundationArtifacts(root);
if (candidate) { verifyFoundationSourcePin(root, candidate); verifyFoundationArtifacts(root, true); }
const version = candidate?.source.version ?? '0.83.3';
const commit = candidate?.source.commit ?? '3491513e164dc30e429c84e709bd738841f4df16';
const artifacts = new Map(candidate?.packages.map(pkg => [pkg.name, pkg]) ?? []);
const read = async (path: string) => JSON.parse(await readFile(root + path, 'utf8'));
const manifests = ['package.json', 'benchmark/package.json'];
for (const parent of ['packages', 'components', 'apps']) {
  for (const entry of await readdir(root + parent, { withFileTypes: true })) {
    if (entry.isDirectory()) manifests.push(`${parent}/${entry.name}/package.json`);
  }
}
let references = 0;
for (const path of manifests) {
  const pkg = await read(path);
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg[section] ?? {})) {
      assert.ok(name !== '@jarenjs/ai' && !(typeof range === 'string' && range.includes('@jarenjs/ai')), `${path}: Legacy AI dependency is forbidden`);
      if (!name.startsWith('@jarenjs/')) continue;
      const artifact = artifacts.get(name);
      const expected = path === 'package.json' && artifact ? artifactSpecifier(artifact) : version;
      assert.equal(range, expected, `${path}: ${name} must be exactly ${expected}`);
      if (candidate) assert.ok(artifact, `${path}: unrecorded candidate foundation ${name}`);
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
  const pkg = raw as { version: string; resolved?: string };
  const name = path.slice(path.lastIndexOf('@jarenjs/'));
  if (candidate) {
    const artifact = artifacts.get(name);
    assert.ok(artifact, `${path}: outside qualified candidate closure`);
    assert.equal(pkg.resolved, artifactSpecifier(artifact), `${path}: lockfile artifact source drift`);
    assert.notEqual(name, '@jarenjs/ai', 'Legacy AI cannot enter the cutover closure');
    assert.equal((raw as {integrity?:string}).integrity, artifact.integrity, `${path}: lockfile artifact integrity drift`);
  }
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
console.log(`JarenJS ${version} (${candidate ? `verified candidate tarballs; source pin is the ${candidate.source.state === 'committed' ? 'committed' : 'base'} revision` : 'npm'}): ${references} exact references, ${installed} installed packages, source ${commit.slice(0, 12)}`);
