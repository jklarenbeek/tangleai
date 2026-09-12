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
import { execFileSync } from 'node:child_process';
import { verifyPageSources } from './source.ts';

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
const dependencySources = await verifyPageSources(repo);

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

for (const name of ['data-worker', 'project-worker']) {
  const worker = await Bun.build({ entrypoints: [join(here, 'src/demos/playground', `${name}.js`)], target: 'browser', format: 'esm' });
  if (!worker.success) throw new Error(worker.logs.join('\n'));
  await writeFile(join(dist, `${name}.js`), await worker.outputs[0].text());
}
for (const asset of ['sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'])
  await cp(join(repo, 'node_modules/@sqlite.org/sqlite-wasm/dist', asset), join(dist, asset));

await cp(join(here, 'static'), dist, { recursive: true });

const vendor = [
  'node_modules/@jarenjs/mermaid/styles/mermaid.css',
];
let css = '';
for (const name of ['studio', 'play', 'md']) {
  await cp(join(repo, `node_modules/@jarenjs/${name}/styles`), join(dist, `vendor/${name}`), { recursive: true });
}
await cp(join(repo, 'components/assistant/styles/assistant.css'), join(dist, 'vendor/assistant.css'));
css += ['studio/studio.css', 'studio/data.css', 'play/play.css', 'md/md.css', 'assistant.css']
  .map(path => `@import url('./vendor/${path}');\n`).join('');
for (const path of vendor) css += await readFile(join(repo, path), 'utf8');
css += await readFile(join(here, 'src/demos/game/styles.css'), 'utf8');
await writeFile(join(dist, 'vendor.css'), css);

await writeFile(join(dist, '.nojekyll'), '');

const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const release = JSON.parse(await readFile(join(repo, 'release.config.json'), 'utf8'));
const packages: Record<string, string> = {};
for (const path of release.packages) {
  const pkg = JSON.parse(await readFile(join(repo, path, 'package.json'), 'utf8'));
  packages[pkg.name] = pkg.version;
}
await writeFile(join(dist, 'build.json'), JSON.stringify({
  version: manifest.version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  packages,
  dependencySources,
}, null, 2) + '\n');

console.log(`pages built → ${dist}`);
