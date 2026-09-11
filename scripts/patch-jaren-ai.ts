/** Apply the reviewed upstream AI patch to the exact installed release, once. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PatchManifest {
  package: string;
  version: string;
  patchSha256: string;
  files: Array<{ path: string; before: string | null; after: string }>;
}
const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = new URL('../patches/jarenjs-ai-0.83.2.json', import.meta.url);
const patchPath = fileURLToPath(new URL('../patches/jarenjs-ai-0.83.2.patch', import.meta.url));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Check all preimages before any write. Reapplication is a verified no-op. */
export async function patchJarenAi(options: { check?: boolean; packageRoot?: string } = {}) {
  const packageRoot = resolve(options.packageRoot ?? resolve(root, 'node_modules/@jarenjs/ai'));
  const manifest: PatchManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const patch = await readFile(patchPath);
  assert.equal(sha256(patch), manifest.patchSha256, 'JarenJS AI patch checksum');
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.name, manifest.package, 'JarenJS AI patch package');
  assert.equal(pkg.version, manifest.version, 'JarenJS AI patch requires its exact base version');
  const hashes = async () => Promise.all(manifest.files.map(async (file) => {
    assert.match(file.path, /^(?:src|dist\/types)\/[a-z0-9-]+\.(?:js|d\.ts)$/);
    return readFile(resolve(packageRoot, file.path)).then(sha256, (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  }));
  const current = await hashes();
  const applied = () => current.every((hash, index) => hash === manifest.files[index]!.after);
  if (applied()) return { applied: false, sha256: manifest.patchSha256 };
  if (options.check) throw new Error('JarenJS AI patch is missing or changed; run npm run jaren:patch');
  for (const [index, file] of manifest.files.entries())
    assert.equal(current[index], file.before, `Refusing changed JarenJS AI file ${file.path}; no patch files were written`);
  // Absolute destination plus an allow-listed manifest keeps this usable in
  // installed packages and isolated installation tests, with or without a repo.
  const args = ['apply', '--unsafe-paths', `--directory=${packageRoot}`];
  execFileSync('git', [...args, '--check', patchPath], { cwd: root, stdio: 'pipe' });
  execFileSync('git', [...args, patchPath], { cwd: root, stdio: 'pipe' });
  const after = await hashes();
  for (const [index, file] of manifest.files.entries())
    assert.equal(after[index], file.after, `JarenJS AI patch result ${file.path}`);
  return { applied: true, sha256: manifest.patchSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await patchJarenAi({ check: process.argv.includes('--check') });
  console.log(`JarenJS AI patch ${result.applied ? 'applied' : 'verified'}: ${result.sha256}`);
}
