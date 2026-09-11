/** Consumers install real tarballs outside the checkout; no workspace symlinks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { ROOT, config, npm, readJson, writeJson, inputHash, integrity, sha256, isMain } from './common.ts';
import type { Artifacts } from './build.ts';

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
    writeJson(resolve(directory, 'package.json'), {
      name: 'tangle-release-consumer', version: '0.0.0', private: true, type: 'module', dependencies,
      devDependencies: options.runtimeOnly ? {} : {
        typescript: readJson(resolve(root, 'node_modules/typescript/package.json')).version,
        '@types/node': readJson(resolve(root, 'node_modules/@types/node/package.json')).version,
      },
    });
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', cfg.registry], { root, cwd: directory });
    writeJson(resolve(directory, 'artifacts.json'), artifacts);
    cpSync(resolve(root, 'test/release/fixtures/consumer.mjs'), resolve(directory, 'consumer.mjs'));
    for (const command of [process.execPath, 'bun']) execFileSync(command, ['consumer.mjs'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    if (!options.runtimeOnly) {
      const imports: string[] = [];
      let count = 0;
      for (const pkg of artifacts.packages) for (const [key, target] of Object.entries(pkg.exports)) {
        const name = pkg.name + (key === '.' ? '' : key.slice(1));
        const json = typeof target === 'string' && target.endsWith('.json');
        imports.push(`import ${json ? '' : '* as '}entry${count} from ${JSON.stringify(name)}${json ? ' with { type: "json" }' : ''};\nexport type Entry${count} = typeof entry${count};`);
        count++;
      }
      imports.push(`import { estimateTokens } from '@tangleai/core';\nconst count: number = estimateTokens('typed consumer');\n// @ts-expect-error public declarations must reject a numeric token input\nestimateTokens(42);\nvoid count;`);
      writeFileSync(resolve(directory, 'consumer.mts'), imports.join('\n'));
      writeJson(resolve(directory, 'tsconfig.json'), { compilerOptions: {
        target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
        noEmit: true, skipLibCheck: false, resolveJsonModule: true, types: ['node'],
      }, files: ['consumer.mts'] });
      execFileSync(process.execPath, [resolve(directory, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      cpSync(resolve(root, 'test/release/fixtures/browser.mjs'), resolve(directory, 'browser.mjs'));
      execFileSync('bun', ['build', 'browser.mjs', '--target=browser', '--format=iife', '--outfile=browser.js'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      const browser = { crypto: globalThis.crypto, console, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, performance, setTimeout, clearTimeout, tangleConsumer: undefined as any };
      vm.runInNewContext(readFileSync(resolve(directory, 'browser.js'), 'utf8'), browser, { timeout: 30_000 });
      assert.equal(browser.tangleConsumer.tokens, 2);
      assert.equal((await browser.tangleConsumer.store.list()).length, 0);
      assert.equal((await browser.tangleConsumer.embedder.embed(['browser consumer']))[0].length, browser.tangleConsumer.embedder.dims);
      assert.equal(typeof browser.tangleConsumer.mermaid, 'string');
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
