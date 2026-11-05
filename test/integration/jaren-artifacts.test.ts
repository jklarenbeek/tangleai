import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
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

test('the bootstrap runs npm through the npm that launched it, never a shell, so Windows can run it', () => {
  const cli = '/opt/npm/lib/node_modules/npm/bin/npm-cli.js';
  assert.deepEqual(foundations.npmInvocation({ npm_execpath: cli }, 'win32', 'C:\\node\\node.exe'), { file: 'C:\\node\\node.exe', prefix: [cli] });
  assert.deepEqual(foundations.npmInvocation({ npm_execpath: 'C:\\npm\\bin\\npm-cli.js' }, 'win32', 'node.exe'), { file: 'node.exe', prefix: ['C:\\npm\\bin\\npm-cli.js'] });
  assert.deepEqual(foundations.npmInvocation({}, 'linux', '/usr/bin/node'), { file: 'npm', prefix: [] });
  assert.deepEqual(foundations.npmInvocation({ npm_execpath: '/usr/lib/node_modules/pnpm/bin/pnpm.cjs' }, 'linux'), { file: 'npm', prefix: [] }, 'another package manager is not npm');
  assert.throws(() => foundations.npmInvocation({}, 'win32'), /run this through npm/);
});

const recorded = () => {
  const manifest = foundations.readFoundationArtifacts()!;
  return manifest.packages.filter(pkg => existsSync(foundations.artifactPath(foundations.ROOT, pkg))).map(pkg => ({ pkg, bytes: readFileSync(foundations.artifactPath(foundations.ROOT, pkg)) }));
};
/** A ustar block with its checksum, as npm's tar writes one. */
const header = (name: string, size: number, type = '0') => {
  const block = Buffer.alloc(512);
  block.write(name, 0, 'latin1'); block.write('000644 \0', 100, 'latin1'); block.write(size.toString(8).padStart(11, '0') + ' ', 124, 'latin1');
  block.write(type, 156, 'latin1'); block.write('ustar\u000000', 257, 'latin1');
  block.fill(0x20, 148, 156);
  block.write(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + ' \0', 148, 'latin1');
  return block;
};
const archive = (...blocks: Buffer[]) => Buffer.concat([...blocks, Buffer.alloc(1024)]);

test('the Node tar reader answers every recorded file digest of the qualified foundation', () => {
  const archives = recorded();
  for (const { pkg, bytes } of archives) {
    const entries = foundations.tarEntries(gunzipSync(bytes));
    assert.deepEqual(entries.map(entry => entry.name).sort(), Object.keys(pkg.files).map(file => `package/${file}`).sort(), pkg.name);
    for (const entry of entries) assert.equal(hash(entry.content), pkg.files[entry.name.slice('package/'.length)], `${pkg.name}: ${entry.name}`);
  }
});

test('a Windows pack, which loses the executable bit git records, is restored to the recorded bytes', () => {
  const vendor = resolve(foundations.ROOT, 'vendor/jarenjs');
  let restored = 0;
  for (const { pkg, bytes } of recorded()) {
    const tar = Buffer.from(gunzipSync(bytes));
    const executables = new Set(foundations.tarEntries(tar).filter(entry => entry.mode & 0o111).map(entry => entry.name.slice('package/'.length)));
    if (existsSync(resolve(vendor, 'package.json')))
      assert.deepEqual([...foundations.executablesOf(vendor, pkg.directory)].sort(), [...executables].sort(), `${pkg.name}: the index names the executables Linux packs`);
    assert.equal(foundations.normalizeModes(bytes, executables), bytes, `${pkg.name}: a Linux pack keeps npm's bytes`);
    if (executables.size === 0) continue;
    // NTFS keeps no executable bit, so npm on Windows writes 0644 for these
    for (const entry of foundations.tarEntries(tar)) {
      const block = tar.subarray(entry.offset, entry.offset + 512);
      block.write((entry.mode & ~0o111).toString(8).padStart(6, '0') + ' \0', 100, 'latin1');
      block.fill(0x20, 148, 156);
      block.write(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + ' \0', 148, 'latin1');
    }
    const windows = gzipSync(tar, { level: 9 }); windows[9] = 0xff;
    assert.notEqual(hash(windows), pkg.sha256, `${pkg.name}: the Windows pack differs before normalizing`);
    const normalized = foundations.normalizeModes(windows, executables);
    assert.equal(hash(normalized), pkg.sha256, `${pkg.name}: normalized bytes`);
    assert.equal('sha512-' + createHash('sha512').update(normalized).digest('base64'), pkg.integrity);
    restored++;
  }
  if (recorded().length > 0) assert.ok(restored > 0, 'the qualified foundation ships executable bins');
});

test('the tar reader refuses what npm never packs instead of guessing', () => {
  const content = Buffer.alloc(512, 0x61);
  assert.equal(foundations.tarEntries(archive(header('package/a.js', 3), content)).length, 1);
  assert.throws(() => foundations.tarEntries(archive(header('package/link', 0, '2'))), /entry type '2'/);
  assert.throws(() => foundations.tarEntries(archive(header('PaxHeader', 0, 'x'))), /entry type 'x'/);
  const tampered = header('package/a.js', 3); tampered[0] = 0x71;
  assert.throws(() => foundations.tarEntries(archive(tampered, content)), /checksum/);
  assert.throws(() => foundations.tarEntries(header('package/a.js', 3)), /Truncated/);
});
