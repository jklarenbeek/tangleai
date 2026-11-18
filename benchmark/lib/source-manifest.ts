/**
 * Source receipts hash effective bytes, including reviewed uncommitted work.
 *
 * A package manifest or the lockfile is hashed without Tangle's own version
 * strings (each package's `version` and every `@tangleai/*` pin), which move
 * with every release and change nothing a generator reads: a version-only
 * bump re-identifies no artifact. Every other byte stays in, Jaren's pins
 * included, so a dependency move still does.
 */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';

const exec = promisify(execFile);

const OWN = /^@tangleai\//;
const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;
/** One manifest without its own version and its `@tangleai/*` pins. */
function withoutOwnVersions(manifest: any) {
  if (manifest === null || typeof manifest !== 'object') return manifest;
  const out = { ...manifest };
  delete out.version;
  for (const section of SECTIONS) if (out[section] && typeof out[section] === 'object')
    out[section] = Object.fromEntries(Object.entries(out[section]).map(([name, range]) => [name, OWN.test(name) ? '*' : range]));
  return out;
}
/** The bytes a source receipt hashes for `path`: a manifest or the lockfile without Tangle's version strings. */
export function identityBytes(path: string, bytes: Buffer): Buffer | string {
  const name = path.split('/').at(-1);
  if (name !== 'package.json' && name !== 'package-lock.json') return bytes;
  let parsed: any;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return bytes; }
  if (name === 'package.json') return JSON.stringify(withoutOwnVersions(parsed));
  const lock = withoutOwnVersions(parsed);
  if (lock.packages && typeof lock.packages === 'object')
    // a workspace's entry carries its version and pins; an installed package (under node_modules) is a dependency's own
    lock.packages = Object.fromEntries(Object.entries(lock.packages).map(([key, entry]) => [key, key.includes('node_modules/') ? entry : withoutOwnVersions(entry)]));
  return JSON.stringify(lock);
}
export async function sourceManifest(root: string, paths: readonly string[], roots: readonly string[] = []) {
  const names = new Set(paths.map(path => path.replaceAll('\\', '/')));
  const directories = [...new Set(roots.map(path => path.replaceAll('\\', '/')))];
  await Promise.all(directories.map(async dir => {
    if (!(await stat(join(root, dir))).isDirectory()) throw new TypeError(`source root must be a directory: ${dir}`);
  }));
  if (directories.length) {
    // Include reviewed source edits while excluding ignored build/cache outputs.
    // Tracked files remain inputs even when an ignore rule matches their names.
    const list = (flags: string[]) => exec('git', ['--literal-pathspecs', 'ls-files', ...flags, '-z', '--', ...directories],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    const [inventory, missing] = await Promise.all([list(['--cached', '--others', '--exclude-standard']), list(['--deleted'])]);
    const deleted = new Set(missing.stdout.split('\0'));
    for (const path of inventory.stdout.split('\0')) if (/\.(ts|json)$/.test(path) && !deleted.has(path)) names.add(path);
  }
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const clean = (await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() === '';
  const files = await Promise.all([...names].sort().map(async path => ({ path,
    sha256: createHash('sha256').update(identityBytes(path, await readFile(join(root, path)))).digest('hex') })));
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}
