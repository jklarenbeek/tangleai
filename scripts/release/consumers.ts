/** Consumers install real tarballs outside the checkout; no workspace symlinks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { ROOT, config, npm, readJson, writeJson, inputHash, integrity, sha256, isMain } from './common.ts';
import type { Artifacts } from './build.ts';
import { readFoundationArtifacts, verifyFoundationArtifacts } from '../jaren-artifacts.ts';
import { checkProgramBundle } from '../check-program-bundle.ts';

export function readArtifacts(root = ROOT) {
  const directory = resolve(root, 'dist/release');
  const artifacts = readJson<Artifacts>(resolve(directory, 'artifacts.json'));
  const cfg = config(root);
  assert.equal(artifacts.schemaVersion, 1);
  assert.equal(artifacts.version, readJson(resolve(root, 'package.json')).version);
  assert.equal(artifacts.inputHash, inputHash(root), 'Build inputs changed; rebuild and retest the tarballs');
  assert.deepEqual(artifacts.packages.map(p => p.name), cfg.packages.map(dir => readJson(resolve(root, dir, 'package.json')).name), 'Artifact publication allowlist mismatch');
  for (const pkg of artifacts.packages) {
    assert.match(pkg.filename, /^tangleai-[a-z]+-\d+\.\d+\.\d+\.tgz$/);
    assert.equal(pkg.version, artifacts.version);
    assert.equal(integrity(readFileSync(resolve(directory, pkg.filename))), pkg.integrity, `${pkg.name}: tarball changed`);
  }
  return artifacts;
}
export async function testConsumers(root = ROOT, options: { registry?: boolean; runtimeOnly?: boolean } = {}) {
  const artifacts = readArtifacts(root);
  const cfg = config(root);
  const bun = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(bun, cfg.bun, 'Use the pinned Bun release for consumer verification');
  const directory = mkdtempSync(resolve(tmpdir(), 'tangle-npm-consumer-'));
  try {
    const dependencies = Object.fromEntries(artifacts.packages.map(pkg => [pkg.name, options.registry ? pkg.version : `file:${resolve(root, 'dist/release', pkg.filename)}`]));
    const foundations = options.registry ? null : readFoundationArtifacts(root);
    if (foundations) {
      verifyFoundationArtifacts(root);
      for (const pkg of foundations.packages) dependencies[pkg.name] = `file:${resolve(root, 'dist/jaren', pkg.filename)}`;
    }
    writeJson(resolve(directory, 'package.json'), {
      name: 'tangle-release-consumer', version: '0.0.0', private: true, type: 'module', dependencies,
      devDependencies: options.runtimeOnly ? {} : {
        typescript: readJson(resolve(root, 'node_modules/typescript/package.json')).version,
        '@types/node': readJson(resolve(root, 'node_modules/@types/node/package.json')).version,
      },
    });
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', cfg.registry], { root, cwd: directory });
    if (foundations) {
      cpSync(resolve(root, 'docs/migrations/jaren-ai'), resolve(directory, 'docs/migrations/jaren-ai'), { recursive: true });
      cpSync(resolve(root, 'dist/jaren'), resolve(directory, 'dist/jaren'), { recursive: true });
      verifyFoundationArtifacts(directory, true);
    }
    writeJson(resolve(directory, 'artifacts.json'), artifacts);
    const migrationPath = resolve(root, 'docs/migrations/jaren-ai/manifest.json');
    const migration = existsSync(migrationPath) ? readJson<{ declarations: Array<{ symbols: Array<{ name: string; destination: { entry: string } }> }>; rootSymbols: Array<{ name: string; destination: { entry: string } }> }>(migrationPath) : null;
    if (migration) writeJson(resolve(directory, 'migration.json'), migration);
    cpSync(resolve(root, 'examples/outcomes.ts'), resolve(directory, 'outcomes-example.ts'));
    cpSync(resolve(root, 'test/release/fixtures/consumer.mjs'), resolve(directory, 'consumer.mjs'));
    for (const command of [process.execPath, 'bun']) execFileSync(command, ['consumer.mjs'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    cpSync(resolve(root, 'test/assert-result.ts'), resolve(directory, 'assert-result.ts'));
    writeFileSync(resolve(directory, 'editor-adapters.test.ts'), readFileSync(resolve(root, 'test/jaren/editor-adapters.test.ts'), 'utf8').replace("from '../assert-result.ts'", "from './assert-result.ts'"));
    execFileSync(process.execPath, ['--test', 'editor-adapters.test.ts'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    execFileSync('bun', ['test', 'editor-adapters.test.ts'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    cpSync(resolve(root, 'test/assistant/dom.stub.ts'), resolve(directory, 'dom.stub.ts'));
    const assistantTests = readFileSync(resolve(root, 'test/assistant/component.test.ts'), 'utf8')
      .replace("from '../assert-result.ts'", "from './assert-result.ts'")
      .replace("new URL('../../components/assistant/styles/assistant.css', import.meta.url)", "new URL(import.meta.resolve('@tangleai/assistant/styles/assistant.css'))");
    writeFileSync(resolve(directory, 'assistant.test.ts'), assistantTests);
    execFileSync(process.execPath, ['--test', 'assistant.test.ts'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    execFileSync('bun', ['test', 'assistant.test.ts'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    if (!options.runtimeOnly) {
      checkProgramBundle(directory, root);
      const imports: string[] = [];
      let count = 0;
      for (const pkg of artifacts.packages) for (const [key, target] of Object.entries(pkg.exports)) {
        if (typeof target === 'string' && target.endsWith('.css')) continue;
        const name = pkg.name + (key === '.' ? '' : key.slice(1));
        const json = typeof target === 'string' && target.endsWith('.json');
        imports.push(`import ${json ? '' : '* as '}entry${count} from ${JSON.stringify(name)}${json ? ' with { type: "json" }' : ''};\nexport type Entry${count} = typeof entry${count};`);
        count++;
      }
      cpSync(resolve(root, 'test/release/fixtures/outcomes-types.ts'), resolve(directory, 'outcomes-types.ts'));
      imports.push("import './outcomes-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/assistant-types.ts'), resolve(directory, 'assistant-types.ts'));
      cpSync(resolve(root, 'test/linq/program-types.ts'), resolve(directory, 'program-types.ts'));
      cpSync(resolve(root, 'test/jaren/editor-types.ts'), resolve(directory, 'editor-types.ts'));
      cpSync(resolve(root, 'test/jaren/mechanism-types.ts'), resolve(directory, 'mechanism-types.ts'));
      cpSync(resolve(root, 'test/jaren/program-result-types.ts'), resolve(directory, 'program-result-types.ts'));
      imports.push("import './program-types.js'; import './editor-types.js'; import './assistant-types.js';");
      cpSync(resolve(root, 'test/jaren/packed-mechanism-types.ts'), resolve(directory, 'packed-mechanism-types.ts'));
      imports.push("import './mechanism-types.js'; import './program-result-types.js'; import './packed-mechanism-types.js';");
      imports.push(`import { estimateTokens } from '@tangleai/core';\nconst count: number = estimateTokens('typed consumer');\n// @ts-expect-error public declarations must reject a numeric token input\nestimateTokens(42);\nvoid count;`);
      if (migration) {
        const qualified = new Set(artifacts.packages.map(pkg => pkg.name));
        for (const declaration of migration.declarations) for (const symbol of declaration.symbols) {
          if (!qualified.has(symbol.destination.entry.split('/').slice(0, 2).join('/'))) continue;
          imports.push(`export type { ${symbol.name} as Receipt${count++} } from ${JSON.stringify(symbol.destination.entry)};`);
        }
      }
      writeFileSync(resolve(directory, 'consumer.mts'), imports.join('\n'));
      writeJson(resolve(directory, 'tsconfig.json'), { compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        noEmit: true, skipLibCheck: false, resolveJsonModule: true, types: ['node'], allowImportingTsExtensions: true,
      }, files: ['consumer.mts'] });
      execFileSync(process.execPath, [resolve(directory, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      cpSync(resolve(root, 'test/release/fixtures/browser.mjs'), resolve(directory, 'browser.mjs'));
      execFileSync('bun', ['build', 'browser.mjs', '--target=browser', '--format=iife', '--outfile=browser.js'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      const browser = { crypto: globalThis.crypto, console, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, performance, setTimeout, clearTimeout, tangleConsumer: undefined as any };
      vm.runInNewContext(readFileSync(resolve(directory, 'browser.js'), 'utf8'), browser, { timeout: 30_000 });
      assert.equal(browser.tangleConsumer.tokens, 2);
      assert.equal(JSON.stringify(browser.tangleConsumer.program), JSON.stringify({ steps: [{ op: 'stat', from: 'data', as: 'meta' }, { op: 'answer', from: 'meta' }] }));
      assert.equal(browser.tangleConsumer.adapters.every((adapter: unknown) => typeof adapter === 'function'), true);
      assert.equal((await browser.tangleConsumer.store.list()).length, 0);
      assert.equal((await browser.tangleConsumer.outcomeStore.memories.list()).length, 0);
      assert.equal(typeof browser.tangleConsumer.outcomeContract.revision, 'function');
      assert.equal((await browser.tangleConsumer.embedder.embed(['browser consumer']))[0].length, browser.tangleConsumer.embedder.dims);
      assert.equal(typeof browser.tangleConsumer.mermaid, 'string');
      cpSync(resolve(root, 'test/release/fixtures/assistant-browser.mjs'), resolve(directory, 'assistant-browser.mjs'));
      execFileSync('bun', ['build', 'assistant-browser.mjs', '--target=browser', '--outdir=browser-host'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      writeFileSync(resolve(directory, 'browser-host/index.html'), '<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href=assistant-browser.css><style>.ai-panel{position:relative!important;inset:auto!important}.assistant-slot{max-width:100%}</style><main class=assistant-slot id=host-0></main><main class=assistant-slot id=host-1></main><script type=module src=assistant-browser.js></script>');
      if (process.env.TANGLE_CONSUMER_OUTPUT) cpSync(resolve(directory, 'browser-host'), process.env.TANGLE_CONSUMER_OUTPUT, { recursive: true });
    }
    const verification = {
      schemaVersion: 1, version: artifacts.version, inputHash: artifacts.inputHash,
      artifactsHash: sha256(readFileSync(resolve(root, 'dist/release/artifacts.json'))),
      node: process.version, bun, declarations: !options.runtimeOnly, browser: !options.runtimeOnly,
      registry: options.registry ?? false,
    };
    if (!options.registry && !options.runtimeOnly) writeJson(resolve(root, 'dist/release/verification.json'), verification);
    console.log(`Verified ${options.registry ? 'registry' : 'packed'} consumers: Node, Bun${options.runtimeOnly ? '' : ', declarations and browser'}.`);
    return verification;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => ['--registry', '--runtime-only'].includes(arg)), 'Unknown consumer check option');
  await testConsumers(ROOT, { registry: process.argv.includes('--registry'), runtimeOnly: process.argv.includes('--runtime-only') });
}
