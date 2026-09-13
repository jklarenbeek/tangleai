/** Source receipts hash effective bytes, including reviewed uncommitted work. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';

const exec = promisify(execFile);
export async function sourceManifest(root: string, paths: readonly string[], roots: readonly string[] = []) {
  const names = new Set(paths.map(path => path.replaceAll('\\', '/')));
  async function scan(dir: string): Promise<void> {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(path);
      else if (/\.(ts|json)$/.test(entry.name)) names.add(path);
    }
  }
  for (const dir of roots) await scan(dir.replaceAll('\\', '/'));
  const head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const clean = (await exec('git', ['status', '--porcelain'], { cwd: root })).stdout.trim() === '';
  const files = await Promise.all([...names].sort().map(async path => ({ path,
    sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') })));
  return { head, clean, files, sha256: await canonicalSha256({ head, files }) };
}
