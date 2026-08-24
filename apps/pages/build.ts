/**
 * Build the pages site into apps/pages/dist — run with `bun
 * apps/pages/build.ts` (Bun is the toolchain here: it bundles the TS
 * app, including the @tangleai packages, into one browser ESM file).
 * Asset URLs are relative, so the same dist works under any base path
 * (GitHub Pages serves it under /tangleai/).
 */

import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// the one Bun API this script uses, declared locally instead of pulling
// in @types/bun for a single call
declare const Bun: {
  build(options: {
    entrypoints: string[], target: string, format: string,
  }): Promise<{ success: boolean, logs: unknown[], outputs: Array<{ text(): Promise<string> }> }>,
};

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const repo = join(here, '..', '..');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const built = await Bun.build({
  entrypoints: [join(here, 'src', 'main.ts')],
  target: 'browser',
  format: 'esm',
});
if (!built.success) {
  console.error(built.logs.join('\n'));
  process.exit(1);
}
await writeFile(join(dist, 'app.js'), await built.outputs[0].text());

await cp(join(here, 'static'), dist, { recursive: true });

const vendor = [
  'node_modules/@jarenjs/mermaid/styles/mermaid.css',
  'node_modules/@jarenjs/charts/styles/charts.css',
];
let css = '';
for (const path of vendor) css += await readFile(join(repo, path), 'utf8');
await writeFile(join(dist, 'vendor.css'), css);

await writeFile(join(dist, '.nojekyll'), '');

console.log(`pages built → ${dist}`);
