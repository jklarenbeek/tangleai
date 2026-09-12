import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import * as foundations from '../../scripts/jaren-artifacts.ts';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fixture(run: (root: string, manifest: any, write: (path: string, data: string) => void) => void) {
  const root = mkdtempSync(resolve(tmpdir(), 'tangle-foundation-negative-'));
  const write = (path: string, data: string) => { mkdirSync(dirname(resolve(root, path)), { recursive:true }); writeFileSync(resolve(root, path), data); };
  const bytes = Buffer.from('a qualified immutable test archive');
  const packageJson = JSON.stringify({ name:'@jarenjs/core', version:'0.83.3', type:'module', exports:'./src/index.js' });
  const manifest = { schemaVersion:1, mode:'candidate-artifacts', legacyAiAllowed:false,
    source:{ commit:'a'.repeat(40), version:'0.83.3', node:process.versions.node, npm:'11.12.1', patchSha256:hash(''), state:'uncommitted candidate' },
    packages:[{ name:'@jarenjs/core', version:'0.83.3', directory:'packages/core', filename:'jarenjs-core-0.83.3.tgz', sha256:hash(bytes),
      integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'), edges:{}, files:{ 'package.json':hash(packageJson), 'src/index.js':hash('export const value = 1;') } }] };
  write('docs/migrations/jaren-ai/foundations.patch', '');
  write('docs/migrations/jaren-ai/foundations.json', JSON.stringify(manifest));
  write('dist/jaren/jarenjs-core-0.83.3.tgz', bytes.toString());
  write('node_modules/@jarenjs/core/package.json', packageJson);
  write('node_modules/@jarenjs/core/src/index.js', 'export const value = 1;');
  try { run(root, manifest, write); } finally { rmSync(root, { recursive:true, force:true }); }
}
const update = (write: (p:string,d:string)=>void, manifest: any) => write('docs/migrations/jaren-ai/foundations.json', JSON.stringify(manifest));

test('qualified installed files pass twice without mutation', () => fixture(root => {
  const before = readFileSync(resolve(root, foundations.ARTIFACT_MANIFEST));
  foundations.verifyFoundationArtifacts(root, true); foundations.verifyFoundationArtifacts(root, true);
  assert.deepEqual(readFileSync(resolve(root, foundations.ARTIFACT_MANIFEST)), before);
}));
test('committed foundation source needs no patch and retains immutable installed verification', () => fixture((root, manifest, write) => {
  manifest.source.state = 'committed'; update(write, manifest);
  assert.deepEqual(foundations.readFoundationArtifacts(root), manifest);
  foundations.verifyFoundationArtifacts(root, true);
  foundations.verifyFoundationArtifacts(root, true);
  assert.equal(readFileSync(resolve(root, 'docs/migrations/jaren-ai/foundations.patch'), 'utf8'), '');
}));
test('a committed source receipt refuses an additional patch even with a matching digest', () => fixture((root, manifest, write) => {
  manifest.source.state = 'committed'; manifest.source.patchSha256 = hash('uncommitted change');
  write('docs/migrations/jaren-ai/foundations.patch', 'uncommitted change'); update(write, manifest);
  assert.throws(() => foundations.readFoundationArtifacts(root), /Committed foundation source cannot include a patch/);
}));
for (const alteration of ['missing archive','altered archive','altered installed file','extra installed file','unrecorded archive','unrecorded installed foundation','nested legacy AI']) {
  test(`refuses ${alteration} without repairing it`, () => fixture((root, _manifest, write) => {
    if (alteration === 'missing archive') rmSync(resolve(root,'dist/jaren/jarenjs-core-0.83.3.tgz'));
    if (alteration === 'altered archive') write('dist/jaren/jarenjs-core-0.83.3.tgz','changed');
    if (alteration === 'altered installed file') write('node_modules/@jarenjs/core/src/index.js','changed');
    if (alteration === 'extra installed file') write('node_modules/@jarenjs/core/src/hidden.js','export const hidden = true;');
    if (alteration === 'unrecorded archive') write('dist/jaren/jarenjs-ai-0.83.3.tgz','old');
    if (alteration === 'unrecorded installed foundation') write('node_modules/@jarenjs/ai/package.json','{}');
    if (alteration === 'nested legacy AI') write('node_modules/some-package/node_modules/@jarenjs/ai/package.json','{}');
    assert.throws(() => foundations.verifyFoundationArtifacts(root, true), /missing tarball|mismatch|differ|unrecorded|Legacy|closure|inventory/i);
    assert.throws(() => foundations.verifyFoundationArtifacts(root, true));
  }));
}
for (const alteration of ['legacy permission','legacy package','escaping file','absolute file','unrecorded edge','legacy alias edge','Tangle edge','invalid digest']) {
  test(`rejects manifest ${alteration}`, () => fixture((root, manifest, write) => {
    const pkg = manifest.packages[0];
    if (alteration === 'legacy permission') manifest.legacyAiAllowed = true;
    if (alteration === 'legacy package') { pkg.name='@jarenjs/ai'; pkg.filename='jarenjs-ai-0.83.3.tgz'; }
    if (alteration === 'escaping file') pkg.files['../secret'] = 'a'.repeat(64);
    if (alteration === 'absolute file') pkg.files['/tmp/secret'] = 'a'.repeat(64);
    if (alteration === 'unrecorded edge') pkg.edges.dependencies = { '@jarenjs/missing':'^0.83.3' };
    if (alteration === 'legacy alias edge') pkg.edges.optionalDependencies = { alias:'npm:@jarenjs/ai@0.83.3' };
    if (alteration === 'Tangle edge') pkg.edges.devDependencies = { '@tangleai/core':'0.20.1' };
    if (alteration === 'invalid digest') pkg.files['src/index.js'] = 'invalid';
    update(write, manifest);
    assert.throws(() => foundations.readFoundationArtifacts(root));
  }));
}

test('a wrong gitlink or checked-out source pin is refused even when archives exist', () => fixture((root, manifest, write) => {
  const git = (cwd:string, ...args:string[]) => execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  write('vendor/jarenjs/package.json','{"version":"0.83.3"}');
  const source = resolve(root,'vendor/jarenjs');
  git(source,'init','--quiet'); git(source,'add','package.json');
  git(source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture source');
  manifest.source.commit = git(source,'rev-parse','HEAD'); update(write,manifest);
  git(root,'init','--quiet'); git(root,'update-index','--add','--cacheinfo',`160000,${manifest.source.commit},vendor/jarenjs`);
  const verifyPin = (foundations as unknown as { verifyFoundationSourcePin:(root:string,manifest:any)=>void }).verifyFoundationSourcePin;
  assert.equal(typeof verifyPin,'function');
  verifyPin(root,manifest);
  const originalArchive = readFileSync(resolve(root,'dist/jaren/jarenjs-core-0.83.3.tgz'),'utf8');
  manifest.packages.push({ ...manifest.packages[0], name:'@jarenjs/app', directory:'packages/app', filename:'jarenjs-app-0.83.3.tgz' });
  write('dist/jaren/jarenjs-core-0.83.3.tgz','changed while another archive is missing');
  update(write,manifest);
  assert.throws(() => foundations.bootstrapFoundations(root), /tarball SHA-256 mismatch/);
  assert.equal(readFileSync(resolve(root,'dist/jaren/jarenjs-core-0.83.3.tgz'),'utf8'),'changed while another archive is missing');
  manifest.packages.pop(); update(write,manifest); write('dist/jaren/jarenjs-core-0.83.3.tgz',originalArchive);
  git(root,'update-index','--cacheinfo',`160000,${'b'.repeat(40)},vendor/jarenjs`);
  assert.throws(() => verifyPin(root,manifest), /pin|gitlink/i);
  assert.throws(() => foundations.bootstrapFoundations(root), /pin|gitlink/i);
  git(root,'update-index','--cacheinfo',`160000,${manifest.source.commit},vendor/jarenjs`);
  write('vendor/jarenjs/package.json','{"version":"0.83.4"}'); git(source,'add','package.json');
  git(source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Wrong source');
  assert.throws(() => verifyPin(root,manifest), /pin/i);
}));
