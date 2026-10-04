/** Consumers install real tarballs outside the checkout; no workspace symlinks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { ROOT, config, npm, readJson, writeJson, inputHash, integrity, sha256, isMain } from './common.ts';
import type { Artifacts } from './build.ts';
import { readFoundationArtifacts, verifyFoundationArtifacts } from '../jaren-artifacts.ts';
import { checkProgramBundle } from '../check-program-bundle.ts';
import { runRuntimeFixture } from '../runtime-fixture.ts';

export function readArtifacts(root = ROOT) {
  const directory = resolve(root, 'dist/release');
  const artifacts = readJson<Artifacts>(resolve(directory, 'artifacts.json'));
  const cfg = config(root);
  assert.equal(artifacts.schemaVersion, 1);
  assert.equal(artifacts.version, readJson(resolve(root, 'package.json')).version);
  assert.equal(artifacts.inputHash, inputHash(root), 'Build inputs changed; rebuild and retest the tarballs');
  assert.deepEqual(artifacts.packages.map(p => p.name), cfg.packages.map(dir => readJson(resolve(root, dir, 'package.json')).name), 'Artifact publication allowlist mismatch');
  for (const pkg of artifacts.packages) {
    assert.match(pkg.filename, /^tangleai-[a-z][a-z0-9]*-\d+\.\d+\.\d+\.tgz$/);
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
  async function sqliteFixture(runtime: string, args: string[]) {
    const { stdout, stderr } = await runRuntimeFixture(runtime, args, { cwd: directory, timeout: 120_000 });
    process.stdout.write(stdout); process.stderr.write(stderr);
  }
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
    const exampleSource = readFileSync(resolve(root, 'examples/gmpl.ts'), 'utf8');
    writeFileSync(resolve(directory, 'gmpl-example.mjs'), ts.transpileModule(exampleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    cpSync(resolve(root, 'examples/fixtures/gmpl-domains.json'), resolve(directory, 'fixtures/gmpl-domains.json'));
    cpSync(resolve(root, 'test/release/fixtures/gmpl-consumer.mjs'), resolve(directory, 'gmpl-consumer.mjs'));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'gmpl-consumer.mjs']);
    await sqliteFixture('bun', ['gmpl-consumer.mjs']);
    for (const file of ['trading-consumer.mjs', 'trading-browser.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'trading-consumer.mjs']);
    await sqliteFixture('bun', ['trading-consumer.mjs']);
    writeFileSync(resolve(directory, 'research-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/research.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['research-consumer.mjs', 'research-browser.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'research-consumer.mjs']);
    await sqliteFixture('bun', ['research-consumer.mjs']);
    writeFileSync(resolve(directory, 'grounding-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/grounding.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['grounding-consumer.mjs', 'grounding-browser.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'grounding-consumer.mjs']);
    await sqliteFixture('bun', ['grounding-consumer.mjs']);
    writeFileSync(resolve(directory, 'lightrag-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/lightrag.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['lightrag-consumer.mjs', 'lightrag-browser.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'lightrag-consumer.mjs']);
    await sqliteFixture('bun', ['lightrag-consumer.mjs']);
    writeFileSync(resolve(directory, 'hera-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/hera.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['hera-consumer.mjs', 'hera-browser.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'hera-consumer.mjs']);
    await sqliteFixture('bun', ['hera-consumer.mjs']);
    // Bundle the authored walkthrough's private fixture helpers; keep every
    // package external so the runtime exercises only installed JavaScript.
    execFileSync('bun', ['build', 'examples/forecast.ts', '--target=node', '--format=esm', '--packages=external', '--outfile='+resolve(directory,'forecast-example.mjs')], { cwd: root,stdio: 'inherit',timeout: 120_000 });
    assert.ok(!readFileSync(resolve(directory,'forecast-example.mjs'),'utf8').includes(root), 'Forecast consumer must not retain checkout-absolute imports');
    cpSync(resolve(root,'benchmark/fixtures/forecast'),resolve(directory,'benchmark/fixtures/forecast'),{recursive:true});
    for (const file of ['forecast-consumer.mjs','forecast-browser.mjs']) cpSync(resolve(root,'test/release/fixtures',file),resolve(directory,file));
    await sqliteFixture(process.execPath,['--no-experimental-strip-types','forecast-consumer.mjs']);
    await sqliteFixture('bun',['forecast-consumer.mjs']);
    writeFileSync(resolve(directory, 'temporal-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/temporal.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['temporal-browser.mjs', 'temporal-consumer.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'temporal-consumer.mjs']);
    await sqliteFixture('bun', ['temporal-consumer.mjs']);
    cpSync(resolve(root, 'benchmark/fixtures/place/gazetteer.json'), resolve(directory, 'place-gazetteer.json'));
    for (const file of ['place-browser.mjs', 'place-consumer.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'place-consumer.mjs']);
    await sqliteFixture('bun', ['place-consumer.mjs']);
    mkdirSync(resolve(directory, 'place-example'));
    cpSync(resolve(root, 'examples/place-gazetteer.json'), resolve(directory, 'place-example/place-gazetteer.json'));
    writeFileSync(resolve(directory, 'place-example/place-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/place.ts'), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    cpSync(resolve(root, 'test/release/fixtures/place-example-consumer.mjs'), resolve(directory, 'place-example-consumer.mjs'));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'place-example-consumer.mjs']);
    await sqliteFixture('bun', ['place-example-consumer.mjs']);
    writeFileSync(resolve(directory, 'trace2skill-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/trace2skill.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['trace2skill-browser.mjs', 'trace2skill-consumer.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'trace2skill-consumer.mjs']);
    await sqliteFixture('bun', ['trace2skill-consumer.mjs']);
    writeFileSync(resolve(directory, 'consolidation-example.mjs'), ts.transpileModule(readFileSync(resolve(root, 'examples/consolidation.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    for (const file of ['consolidation-browser.mjs', 'consolidation-consumer.mjs']) cpSync(resolve(root, 'test/release/fixtures', file), resolve(directory, file));
    await sqliteFixture(process.execPath, ['--no-experimental-strip-types', 'consolidation-consumer.mjs']);
    await sqliteFixture('bun', ['consolidation-consumer.mjs']);
    cpSync(resolve(root, 'examples/outcomes.ts'), resolve(directory, 'outcomes-example.ts'));
    writeFileSync(resolve(directory, 'supervised-store.ts'), readFileSync(resolve(root, 'examples/supervised-store.ts'), 'utf8')
      .replace("from './outcomes.ts'", "from './outcomes-example.ts'"));
    cpSync(resolve(root, 'test/release/fixtures/consumer.mjs'), resolve(directory, 'consumer.mjs'));
    for (const command of [process.execPath, 'bun']) execFileSync(command, ['consumer.mjs'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
    cpSync(resolve(root, 'test/store/native-foundation.test.ts'), resolve(directory, 'native-foundation.test.ts'));
    await sqliteFixture(process.execPath, ['--test', 'native-foundation.test.ts']);
    await sqliteFixture('bun', ['test', 'native-foundation.test.ts']);
    cpSync(resolve(root, 'examples/physical-migration.ts'), resolve(directory, 'physical-migration.ts'));
    writeFileSync(resolve(directory, 'physical-migration.test.ts'), readFileSync(resolve(root, 'test/store/physical-migration.test.ts'), 'utf8')
      .replace("from '../../examples/physical-migration.ts'", "from './physical-migration.ts'"));
    await sqliteFixture(process.execPath, ['--test', 'physical-migration.test.ts']);
    await sqliteFixture('bun', ['test', 'physical-migration.test.ts']);
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
      cpSync(resolve(root, 'test/release/fixtures/gmpl-types.ts'), resolve(directory, 'gmpl-types.ts'));
      imports.push("import './gmpl-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/trading-types.ts'), resolve(directory, 'trading-types.ts'));
      imports.push("import './trading-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/research-types.ts'), resolve(directory, 'research-types.ts'));
      imports.push("import './research-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/grounding-types.ts'), resolve(directory, 'grounding-types.ts'));
      imports.push("import './grounding-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/lightrag-types.ts'), resolve(directory, 'lightrag-types.ts'));
      imports.push("import './lightrag-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/hera-types.ts'), resolve(directory, 'hera-types.ts'));
      imports.push("import './hera-types.js';");
      cpSync(resolve(root,'test/release/fixtures/forecast-types.ts'),resolve(directory,'forecast-types.ts'));
      imports.push("import './forecast-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/outcomes-types.ts'), resolve(directory, 'outcomes-types.ts'));
      imports.push("import './outcomes-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/temporal-types.ts'), resolve(directory, 'temporal-types.ts'));
      imports.push("import './temporal-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/place-types.ts'), resolve(directory, 'place-types.ts'));
      imports.push("import './place-types.js';");
      imports.push("import './supervised-store.ts';");
      imports.push("import './native-foundation.test.ts';");
      imports.push("import './physical-migration.test.ts';");
      cpSync(resolve(root, 'test/release/fixtures/assistant-types.ts'), resolve(directory, 'assistant-types.ts'));
      cpSync(resolve(root, 'test/linq/program-types.ts'), resolve(directory, 'program-types.ts'));
      cpSync(resolve(root, 'test/jaren/editor-types.ts'), resolve(directory, 'editor-types.ts'));
      cpSync(resolve(root, 'test/jaren/mechanism-types.ts'), resolve(directory, 'mechanism-types.ts'));
      cpSync(resolve(root, 'test/jaren/program-result-types.ts'), resolve(directory, 'program-result-types.ts'));
      imports.push("import './program-types.js'; import './editor-types.js'; import './assistant-types.js';");
      cpSync(resolve(root, 'test/jaren/packed-mechanism-types.ts'), resolve(directory, 'packed-mechanism-types.ts'));
      imports.push("import './mechanism-types.js'; import './program-result-types.js'; import './packed-mechanism-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/consolidation-types.ts'), resolve(directory, 'consolidation-types.ts'));
      imports.push("import './consolidation-types.js';");
      cpSync(resolve(root, 'test/release/fixtures/trace2skill-types.ts'), resolve(directory, 'trace2skill-types.ts'));
      imports.push("import './trace2skill-types.js';");
      imports.push(`import { estimateTokens } from '@tangleai/core';\nconst count: number = estimateTokens('typed consumer');\n// @ts-expect-error public declarations must reject a numeric token input\nestimateTokens(42);\nvoid count;`);
      imports.push(`import { kMeans } from '@tangleai/core/clustering';\nconst clusters = kMeans([[0], [10]], 2, { initialization: 'random', random: () => 0 });\nkMeans([[0], [10]], 2, { initialization: 'kmeans++' });\n// @ts-expect-error initializers are a closed public union\nkMeans([[0], [10]], 2, { initialization: 'invented' });\nconst assignments: number[] = clusters.assignments;\nvoid assignments;`);
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
      cpSync(resolve(root, 'test/release/fixtures/gmpl-browser.mjs'), resolve(directory, 'gmpl-browser.mjs'));
      cpSync(resolve(root, 'test/release/fixtures/trace2skill-browser.mjs'), resolve(directory, 'trace2skill-browser.mjs'));
      cpSync(resolve(root, 'test/release/fixtures/browser.mjs'), resolve(directory, 'browser.mjs'));
      execFileSync('bun', ['build', 'browser.mjs', '--target=browser', '--format=iife', '--outfile=browser.js'], { cwd: directory, stdio: 'inherit', timeout: 120_000 });
      const browser = { crypto: globalThis.crypto, atob, btoa, console, structuredClone, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal, Request, Response, Headers, ReadableStream, DOMException, performance, setTimeout, clearTimeout, queueMicrotask, tangleConsumer: undefined as any };
      Object.assign(browser, { window: browser, self: browser });
      vm.runInNewContext(readFileSync(resolve(directory, 'browser.js'), 'utf8'), browser, { timeout: 30_000 });
      const gmplBrowser = await browser.tangleConsumer.gmpl;
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.place)), { entries: 71, grounded: 1, cells: 9, claim: true,
        refusal: 'TPLC1007', cause: 'AI0230', movementMetres: 13393632, citedSources: 2, nearby: ['shibuya-q595153'] });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.trading)), { writes: 9, replayWrites: 0, quantity: 10, refused: 1, missing: 1 });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.research)), { state: 'LITERATURE_GATE', attempts: 1,
        replayed: true, bytes: [97, 98, 99], artifactId: 'art-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', refusal: 'TRSH1001' });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.researchDiscovery)),
        { doi: '10.5555/packed', rawHash: true, requests: 1, misses: 0, networkCalls: 0 });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.researchReasoning)),
        { packs: 7, participants: 3, separateSynthesizer: true, generatedPlanSchema: true });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.researchExecution)),
        { status: 'ok', value: 2, signature: true, physical: 1, isolated: false, forged: 'TRSH1006', network: 'TRSH1010' });
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.researchAnalysis)),
        { support: 'not-supported', underpowered: true, decision: 'Stop', candidates: 1, reviewers: 2 });
      const groundingBrowser = await browser.tangleConsumer.grounding;
      const graphBrowser = await browser.tangleConsumer.lightrag;
      const graphPreparation = await browser.tangleConsumer.lightragPreparation;
      assert.deepEqual(JSON.parse(JSON.stringify(graphPreparation)), { entities: 2, relations: 1, claims: 3, embeddingCalls: 2, calls: 2, decisions: 0, partial: false, lookups: 1, packs: 4, valid: true });
      assert.equal(graphBrowser.writes, 5);
      assert.equal(graphBrowser.replayWrites, 0);
      assert.equal(graphBrowser.newClaims, 1);
      assert.equal(graphBrowser.revision, 1);
      assert.equal(graphBrowser.entities, 1);
      assert.equal(graphBrowser.fold, 'cedar');
      assert.equal(graphBrowser.shape, true);
      assert.equal(groundingBrowser.webCalls, 4);
      assert.equal(groundingBrowser.webRequests, 3);
      assert.equal(groundingBrowser.webCandidates, 1);
      assert.equal(groundingBrowser.answerCalls, 1);
      assert.equal(groundingBrowser.answerDisposition, 'answer');
      assert.equal(groundingBrowser.writes, 1);
      assert.equal(groundingBrowser.replayWrites, 0);
      assert.equal(groundingBrowser.status, 'open');
      assert.equal(groundingBrowser.emergency, 'emergency-route');
      assert.match(groundingBrowser.revision, /^[a-f0-9]{64}$/);
      const heraBrowser = await browser.tangleConsumer.hera;
      const forecastBrowser = await browser.tangleConsumer.forecast;
      assert.equal(forecastBrowser.writes,1);
      assert.equal(forecastBrowser.versions,1);
      assert.equal(forecastBrowser.status,'provisional');
      assert.equal(forecastBrowser.refusal,'TFCT1008');
      assert.match(forecastBrowser.contractRevision,/^[a-f0-9]{64}$/);
      assert.equal(heraBrowser.packs, 13);
      assert.equal(heraBrowser.roles, 8);
      assert.equal(heraBrowser.staleRefused, true);
      assert.match(heraBrowser.rendered, /Literal \{\{question\}\}/);
      assert.deepEqual(JSON.parse(JSON.stringify(await browser.tangleConsumer.lightragRetrieval)),{entities:1,citations:1,localCalls:1,withinBudget:true,noOriginal:true,sameCitations:true,timingsOmitted:true,answer:{disposition:'no-model',citation:'consumer-chunk',rendered:true,sharedSchema:true}});
      const temporalBrowser = await browser.tangleConsumer.temporal;
      const consolidationBrowser = await browser.tangleConsumer.consolidation;
      const skillBrowser = await browser.tangleConsumer.trace2skill;
      assert.equal(skillBrowser.hunks, 1);
      assert.equal(skillBrowser.withheld, 0);
      assert.equal(skillBrowser.formatValid, true);
      assert.equal(skillBrowser.publishedRoles, 5);
      assert.match(skillBrowser.rendered, /"patches"/);
      assert.match(skillBrowser.packRevision, /^[0-9a-f]{12,}$/);
      assert.equal(consolidationBrowser.sources, 2);
      assert.equal(consolidationBrowser.artifacts, 1);
      assert.equal(consolidationBrowser.replayWrites, 0);
      assert.equal(temporalBrowser.occurrences, 3);
      assert.equal(temporalBrowser.citations, 2);
      assert.match(temporalBrowser.rendered, /Elm/);
      assert.equal(gmplBrowser.packs, 14);
      assert.ok(gmplBrowser.nodes > 3);
      assert.match(gmplBrowser.rendered, /Literal \{\{text\}\}/);
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
  } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}
if (isMain(import.meta.url)) {
  assert.ok(process.argv.slice(2).every(arg => ['--registry', '--runtime-only'].includes(arg)), 'Unknown consumer check option');
  await testConsumers(ROOT, { registry: process.argv.includes('--registry'), runtimeOnly: process.argv.includes('--runtime-only') });
}
