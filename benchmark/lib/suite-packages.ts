/** Installed foundation and explicitly executed Tangle package identities, name-sorted. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function installedSuitePackages(root: string, tangleNames: readonly string[]): Promise<{ packages: Array<{ name: string; version: string }> }> {
  const jaren = (await readdir(join(root, 'node_modules', '@jarenjs'))).filter(name => !name.startsWith('.'));
  const names = [...jaren.map(name => '@jarenjs/' + name), ...tangleNames.map(name => '@tangleai/' + name)].sort();
  const packages = await Promise.all(names.map(async name => {
    const manifest = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };
    return { name, version: manifest.version };
  }));
  return { packages };
}
