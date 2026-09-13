/** Source receipts hash effective bytes, including reviewed uncommitted work. */
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';

const exec = promisify(execFile);
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
    sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') })));
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}
