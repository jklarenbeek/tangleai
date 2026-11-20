/**
 * Build the pages site into apps/pages/dist — run with `bun
 * apps/pages/build.ts` (Bun is the toolchain here: it bundles the TS
 * app, including the @tangleai packages, into one browser ESM file).
 * Asset URLs are relative, so the same dist works under any base path
 * (GitHub Pages serves it under /tangleai/).
 */

import { cp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifyPageSources } from './source.ts';
import { HEADLINES, groupOf, readerIndex, type ReaderSource } from './src/os/reader-model.ts';

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

// the desktop: its page entry, and the document module host as a CLASSIC
// script — a sandboxed (opaque-origin) frame cannot load a module script
// from a server that sends no CORS headers
const os = await Bun.build({ entrypoints: [join(here, 'src', 'os', 'main.ts')], target: 'browser', format: 'esm' });
if (!os.success) throw new Error(os.logs.join('\n'));
await writeFile(join(dist, 'os.js'), await os.outputs[0].text());
const moduleHost = await Bun.build({ entrypoints: [join(repo, 'components', 'os', 'src', 'module-host.ts')], target: 'browser', format: 'iife' });
if (!moduleHost.success) throw new Error(moduleHost.logs.join('\n'));
await writeFile(join(dist, 'os-module-host.js'), await moduleHost.outputs[0].text());

for (const name of ['data-worker', 'project-worker']) {
  const worker = await Bun.build({ entrypoints: [join(here, 'src/demos/playground', `${name}.ts`)], target: 'browser', format: 'esm' });
  if (!worker.success) throw new Error(worker.logs.join('\n'));
  await writeFile(join(dist, `${name}.js`), await worker.outputs[0].text());
}
for (const asset of ['sqlite3.wasm', 'sqlite3-opfs-async-proxy.js'])
  await cp(join(repo, 'node_modules/@sqlite.org/sqlite-wasm/dist', asset), join(dist, asset));

await cp(join(here, 'static'), dist, { recursive: true });
await cp(join(repo, 'components/os/styles/os.css'), join(dist, 'os.css'));
await cp(join(repo, 'components/os/styles/module.css'), join(dist, 'os-module.css'));
// the desktop package as released, for applications that join by URL: the
// one-file module side, the tarball and its manifest
await cp(join(repo, 'releases/os'), join(dist, 'os'), { recursive: true });

const vendor = [
  'node_modules/@jarenjs/mermaid/styles/mermaid.css',
];
let css = '';
for (const name of ['studio', 'play', 'md', 'calc', 'charts']) {
  await cp(join(repo, `node_modules/@jarenjs/${name}/styles`), join(dist, `vendor/${name}`), { recursive: true });
}
await cp(join(repo, 'components/assistant/styles/assistant.css'), join(dist, 'vendor/assistant.css'));
css += ['studio/studio.css', 'studio/data.css', 'play/play.css', 'md/md.css', 'calc/calc.css', 'charts/charts.css', 'assistant.css']
  .map(path => `@import url('./vendor/${path}');\n`).join('');
for (const path of vendor) css += await readFile(join(repo, path), 'utf8');
css += await readFile(join(here, 'src/demos/game/styles.css'), 'utf8');
await writeFile(join(dist, 'vendor.css'), css);

await writeFile(join(dist, '.nojekyll'), '');

// Docs and Benchmarks read the repository's documents from content/, fetched
// when a window opens one: every document the reader offers at its own path,
// the results files the headline charts read, and the index naming them
const markdownUnder = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true }).catch(() => [])) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await markdownUnder(path));
    else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
};
const candidates = ['README.md', ...await markdownUnder('docs')];
for (const area of ['packages', 'components']) {
  for (const entry of await readdir(join(repo, area), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    candidates.push(`${area}/${entry.name}/README.md`, ...await markdownUnder(`${area}/${entry.name}/docs`));
  }
}
const sources: ReaderSource[] = [];
for (const path of [...new Set(candidates)].sort()) {
  if (!groupOf(path)) continue;
  const text = await readFile(join(repo, path), 'utf8').catch(() => null);
  if (text === null) continue;
  const packageName = /^(packages|components)\/[^/]+\/README\.md$/.test(path)
    ? JSON.parse(await readFile(join(repo, dirname(path), 'package.json'), 'utf8').catch(() => '{}')).name
    : undefined;
  sources.push({ path, text, ...(packageName ? { packageName } : {}) });
}
const readerIndexDoc = readerIndex(sources);
for (const { path } of readerIndexDoc.documents) {
  await mkdir(join(dist, 'content', dirname(path)), { recursive: true });
  await cp(join(repo, path), join(dist, 'content', path));
}
for (const path of [...new Set(Object.values(HEADLINES).flatMap(h => h.results))].sort()) {
  await mkdir(join(dist, 'content', dirname(path)), { recursive: true });
  await cp(join(repo, path), join(dist, 'content', path));
}
await writeFile(join(dist, 'content', 'index.json'), JSON.stringify(readerIndexDoc, null, 2) + '\n');

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
// what the desktop's About shows beside the release identity (build.json is
// compared exactly by the live-site check, so it carries nothing extra)
await writeFile(join(dist, 'os-build.json'), JSON.stringify({
  jaren: JSON.parse(await readFile(join(repo, 'node_modules/@jarenjs/app/package.json'), 'utf8')).version,
}, null, 2) + '\n');
