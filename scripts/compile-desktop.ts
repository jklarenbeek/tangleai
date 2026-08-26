/** Compile the desktop and always restore the caller's asset stub/content. */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsPath = join(root, 'apps', 'desktop', 'src', 'assets.gen.ts');

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code ?? 'unknown'})`));
    });
  });
}

await run('npm', ['run', 'desktop:ui']);
const originalAssets = await readFile(assetsPath);
try {
  await run(process.execPath, ['scripts/embed-assets.ts']);
  await mkdir(join(root, 'dist'), { recursive: true });
  await run(process.execPath, [
    'build',
    '--compile',
    'apps/desktop/src/main.ts',
    '--outfile',
    'dist/tangle',
  ]);
} finally {
  await writeFile(assetsPath, originalAssets);
}
