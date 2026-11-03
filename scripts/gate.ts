/**
 * The change gate: every step of `npm run check` except the suite, then the
 * test files a change can reach, then the Bun leg of each reached test that the
 * packed-consumer stage copies, then that packed stage itself when a copied
 * test, its harness, its fixtures or a manifest changed. A test reaches its
 * static import closure (relative imports and workspace exports, never Jaren or
 * Node; a module named in a literal is followed too, since tests run fixtures
 * as subprocesses), every repository file, directory or glob that closure
 * names, and what `DECLARED` adds for it. A change to an input of every test,
 * or one that no test claims, runs the whole suite and says which path forced
 * it. `node scripts/gate.ts` gates the working tree against `HEAD`;
 * `--base <ref>` gates everything since that ref; `--print [path …]` shows the
 * selection for those paths (or for the change) without running it. Each step
 * runs through the `npm` on `PATH`, as `npm run check` would.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, matchesGlob, relative, resolve, sep } from 'node:path';
import { importSpecifiers, stringLiterals } from '../test/import-specifiers.ts';
import { ROOT, git, isMain } from './release/common.ts';
import { runRuntimeFixture } from './runtime-fixture.ts';

/** Inputs of every test: the Node pin, the dependency graph, Jaren, the compiler settings and the runner. */
const EVERY_TEST = ['.nvmrc', 'package.json', 'package-lock.json', 'tsconfig.json', 'vendor/jarenjs', 'scripts/test.ts'];
/** Read by no test: the order the runner starts files in, and editor state (a directory ends in `/`). */
const NO_TEST = ['scripts/test-durations.json', '.vscode/'];
/** What the packed-consumer stage builds from or copies, besides the tests it copies. */
const PACKED = [/^package(-lock)?\.json$/, /^(packages|components|apps)\/[^/]+\/package\.json$/, /^scripts\/release\/(build|consumers)\.ts$/, /^test\/release\/fixtures\//];
/**
 * Reads the static walk cannot see, found by tracing every test's module loads
 * and file reads: directories listed under computed names, source manifests over
 * computed roots, fixtures named in code. Directories end in `/` and globs start
 * with `glob:`; an entry only ever widens what a test reaches.
 */
const DECLARED: Record<string, string[]> = {
  'test/agents/relevance-pressure.test.ts': ['benchmark/fixtures/relevance-tiny/'],
  'test/assistant/import-graph.test.ts': ['components/', 'packages/'],
  'test/benchmark/config-conformance.test.ts': ['examples/', 'scripts/'],
  'test/benchmark/evolve.test.ts': ['apps/', 'benchmark/', 'packages/', 'scripts/'],
  'test/benchmark/gmpl-conformance.test.ts': ['prompts/gmpl/'],
  'test/benchmark/gmpl-locomo.test.ts': ['examples/', 'prompts/gmpl/'],
  'test/benchmark/gmpl-sources.test.ts': ['prompts/gmpl/'],
  'test/benchmark/hera-qa.test.ts': ['packages/core/schemas/', 'packages/evolve/schemas/', 'packages/evolve/src/', 'packages/experiential/schemas/', 'packages/grounding/profiles/', 'packages/jaren/src/', 'packages/linq/package.json', 'packages/linq/src/', 'packages/outcomes/schemas/', 'packages/outcomes/src/', 'packages/research/schemas/', 'packages/trace2skill/src/'],
  'test/benchmark/outcome-conformance.test.ts': ['packages/context/src/', 'packages/core/schemas/', 'packages/core/src/', 'packages/documents/src/', 'packages/evolve/schemas/', 'packages/evolve/src/', 'packages/experiential/schemas/', 'packages/grounding/profiles/', 'packages/hera/schemas/', 'packages/hera/src/', 'packages/jaren/src/', 'packages/linq/package.json', 'packages/linq/src/', 'packages/memory/schemas/', 'packages/pipeline/package.json', 'packages/pipeline/src/', 'packages/research/schemas/', 'packages/trace2skill/src/'],
  'test/benchmark/policy-default.test.ts': ['benchmark/results/'],
  'test/benchmark/priha.test.ts': ['packages/core/schemas/', 'packages/core/src/', 'packages/evolve/schemas/', 'packages/evolve/src/', 'packages/experiential/schemas/', 'packages/hera/schemas/', 'packages/hera/src/', 'packages/jaren/src/', 'packages/linq/package.json', 'packages/linq/src/', 'packages/memory/schemas/', 'packages/outcomes/schemas/', 'packages/outcomes/src/', 'packages/research/schemas/', 'packages/trace2skill/src/'],
  'test/benchmark/research-domains.test.ts': ['packages/research/src/stages/'],
  'test/benchmark/research-source.test.ts': ['LICENSE'],
  'test/benchmark/temporal-imports.test.ts': ['benchmark/lib/', 'benchmark/schemas/', 'packages/agents/src/', 'packages/context/src/', 'packages/core/schemas/', 'packages/core/src/', 'packages/memory/src/', 'packages/models/src/', 'packages/pipeline/src/'],
  'test/context/documentation.test.ts': ['packages/agents/README.md', 'packages/context/README.md', 'packages/jaren/README.md', 'packages/models/README.md'],
  'test/context/howto-vector.test.ts': ['packages/context/src/', 'packages/models/src/'],
  'test/context/ledger.test.ts': ['packages/agents/src/'],
  'test/context/recall-quality-artifacts.test.ts': ['benchmark/recall-quality-pressure-hash.json', 'benchmark/recall-quality-pressure-live.json', 'benchmark/recall-quality-scifact-live.json', 'benchmark/recall-quality.schema.json'],
  'test/context/retention.test.ts': ['benchmark/patch-decoding-live.json', 'benchmark/patch-decoding-preparatory.json', 'benchmark/retention-result.json', 'benchmark/retention-result.schema.json'],
  'test/hera/mutate.test.ts': ['test/hera/'],
  'test/hera/topology.test.ts': ['test/hera/'],
  'test/jaren/authoring-evidence.test.ts': ['benchmark/programmind-authoring-fixture.json', 'benchmark/programmind-authoring-live.json', 'benchmark/programmind-authoring-remeasured-live.json'],
  'test/mas/builder.test.ts': ['benchmark/fixtures/mas/'],
  'test/mas/lowering.test.ts': ['benchmark/fixtures/mas/'],
  'test/mas/mermaid.test.ts': ['benchmark/fixtures/mas/'],
  'test/mas/registry.test.ts': ['benchmark/fixtures/mas/'],
  'test/mas/schema.test.ts': ['benchmark/fixtures/mas/'],
  'test/mas/validation.test.ts': ['benchmark/fixtures/mas/'],
  'test/models/deps.test.ts': ['packages/agents/package.json', 'packages/agents/src/', 'packages/context/package.json', 'packages/context/src/', 'packages/models/package.json', 'packages/models/src/'],
  'test/models/repair-record.test.ts': ['test/models/'],
  'test/release/docs.test.ts': ['glob:packages/*/README.md', 'glob:packages/*/docs/**', 'glob:packages/*/package.json'],
  'test/release/push-policy.test.ts': ['.bun-version'],
  'test/release/release.test.ts': ['.changeset/config.json', 'apps/', 'benchmark/package.json'],
  'test/research/control-plane-parity.test.ts': ['packages/research/src/stages/'],
  'test/research/health.test.ts': ['packages/research/src/stages/'],
  'test/store/mas-terminal.test.ts': ['benchmark/fixtures/mas/'],
  'test/trading/index.test.ts': ['packages/agents/package.json', 'packages/agents/src/', 'packages/context/package.json', 'packages/context/src/', 'packages/gmpl/artifacts/', 'packages/gmpl/schemas/', 'packages/gmpl/src/', 'packages/mas/schemas/', 'packages/mas/src/', 'packages/models/package.json', 'packages/models/src/', 'packages/trading/artifacts/', 'packages/trading/schemas/', 'packages/trading/src/'],
};
/** The tests the packed-consumer stage copies, each also run there under Bun. */
export const COPIED = [...new Set(stringLiterals(join(ROOT, 'scripts/release/consumers.ts')).filter(text => /^test\/.+\.test\.ts$/.test(text)))].sort();

const rel = (absolute: string) => relative(ROOT, absolute).split(sep).join('/');
const workspaces = new Map<string, { directory: string, manifest: string, exports: Record<string, string> }>();
for (const group of ['packages', 'components', 'apps']) for (const name of readdirSync(join(ROOT, group))) {
  const manifest = `${group}/${name}/package.json`;
  if (!existsSync(join(ROOT, manifest))) continue;
  const parsed = JSON.parse(readFileSync(join(ROOT, manifest), 'utf8'));
  workspaces.set(parsed.name, { directory: `${group}/${name}`, manifest, exports: parsed.exports ?? {} });
}

/**
 * The repository paths a literal names: a file when it has a separator or an
 * extension, a directory when it spells at least two segments, or a glob
 * (`glob:` and the pattern) whose static prefix is a directory. Bare words
 * (`docs`, `src`) name nothing.
 */
function named(text: string, directory: string): string[] {
  const wildcard = text.search(/[*?{[]/), path = wildcard >= 0 ? text.slice(0, wildcard).replace(/[^/]*$/, '') : text;
  if (!path || text.length > 240 || /[\s\0-\x1f:]|^\//.test(text) || !(path.includes('/') || /\.[a-z0-9]{1,8}$/i.test(path))) return [];
  const segments = path.split('/').filter(segment => segment && segment !== '.' && segment !== '..').length;
  const found: string[] = [];
  for (const base of path.startsWith('.') ? [directory] : [ROOT, directory]) {
    const absolute = resolve(base, path);
    if (!absolute.startsWith(ROOT) || /^(node_modules|vendor)\//.test(rel(absolute))) continue;
    const stat = statSync(absolute, { throwIfNoEntry: false });
    if (wildcard >= 0) { if (stat?.isDirectory() && segments) found.push('glob:' + rel(resolve(base, text))); }
    else if (stat?.isFile()) found.push(rel(absolute));
    else if (stat?.isDirectory() && segments >= 2) found.push(rel(absolute) + '/');
  }
  return found;
}

const edges = new Map<string, { modules: string[], paths: string[] }>();
/** What one module loads (with the manifest each workspace import resolves through) and the paths it names. */
function edgesOf(file: string) {
  let found = edges.get(file);
  if (found) return found;
  found = { modules: [], paths: [] };
  const absolute = join(ROOT, file);
  if (/\.(ts|mts|js|mjs)$/.test(file) && existsSync(absolute)) {
    for (const { specifier, kind } of importSpecifiers(absolute)) {
      if (kind !== 'static' && kind !== 'dynamic') continue;
      const workspace = /^(@tangleai\/[^/]+)(\/.*)?$/.exec(specifier), target = workspace && workspaces.get(workspace[1]!);
      if (target) {
        found.paths.push(target.manifest);
        const subpath = target.exports['.' + (workspace![2] ?? '')];
        if (subpath) found.modules.push(rel(resolve(ROOT, target.directory, subpath)));
      } else if (specifier.startsWith('.')) found.modules.push(rel(resolve(dirname(absolute), specifier)));
    }
    for (const text of stringLiterals(absolute)) found.paths.push(...named(text, dirname(absolute)));
  }
  edges.set(file, found);
  return found;
}

/**
 * Every repository path a test file can read: its import closure, the paths
 * that closure names (directories end in `/`) and what `DECLARED` records for
 * it. A named module is followed like an import, since a test may run it as a
 * subprocess.
 */
export function inputs(test: string): Set<string> {
  const modules = new Set<string>(), reached = new Set<string>(), pending = [test];
  while (pending.length) {
    const file = pending.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    reached.add(file);
    const { modules: next, paths } = edgesOf(file);
    for (const path of paths) reached.add(path);
    pending.push(...next, ...paths.filter(path => /\.(ts|mts|js|mjs)$/.test(path)));
  }
  for (const path of DECLARED[test] ?? []) reached.add(path);
  return reached;
}

const globs = new WeakMap<Set<string>, string[]>();
/** Whether a path is among what a test reaches: itself, under a reached directory, or matched by a reached glob. */
export function claims(reached: Set<string>, path: string) {
  let patterns = globs.get(reached);
  if (!patterns) globs.set(reached, patterns = [...reached].filter(input => input.startsWith('glob:')).map(input => input.slice(5)));
  return reached.has(path) || path.split('/').slice(0, -1).some((_, index, parts) => reached.has(parts.slice(0, index + 1).join('/') + '/'))
    || patterns.some(pattern => matchesGlob(path, pattern));
}

/** The test files a set of changed paths can reach, or all of them with the paths that forced it. */
export function select(changed: string[]) {
  const tests = globSync('test/**/*.test.ts', { cwd: ROOT }).sort(), reach = new Map(tests.map(test => [test, inputs(test)]));
  const chosen = new Set<string>(), reasons: string[] = [];
  let full = false;
  for (const path of changed) {
    if (NO_TEST.some(entry => entry.endsWith('/') ? path.startsWith(entry) : path === entry)) { reasons.push(`${path}: read by no test`); continue; }
    if (EVERY_TEST.some(input => path === input || path.startsWith(input + '/'))) { full = true; reasons.push(`${path}: an input of every test`); continue; }
    const claimed = tests.filter(test => claims(reach.get(test)!, path));
    if (!claimed.length) { full = true; reasons.push(`${path}: claimed by no test`); continue; }
    for (const test of claimed) chosen.add(test);
    reasons.push(`${path}: ${claimed.length} test file${claimed.length === 1 ? '' : 's'}`);
  }
  return { full, tests: full ? tests : [...chosen].sort(), reasons };
}

/** Minutes the selection takes by the recorded file times: its longest file, or its share of the workers. */
function minutes(tests: string[]) {
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts/test-durations.json'), 'utf8')), times = tests.map(test => record.seconds[test] ?? 0);
  return Math.ceil(Math.max(0, ...times, times.reduce((sum, time) => sum + time, 0) / record.workers) / 60);
}

/** The gate's arguments: `--base <ref>` (default `HEAD`), `--print`, and paths to gate in place of the change, in any order. */
export function parse(args: string[]) {
  const at = args.indexOf('--base'), value = at >= 0 ? at + 1 : -1, base = at >= 0 ? args[value] : 'HEAD';
  assert.ok(args.every((arg, index) => ['--print', '--base'].includes(arg) || !arg.startsWith('-') || index === value) && base && !base.startsWith('-'),
    'Use node scripts/gate.ts [--base <ref>] [--print] [path …]');
  return { base, print: args.includes('--print'), paths: args.filter((arg, index) => !arg.startsWith('-') && index !== value) };
}

if (isMain(import.meta.url)) {
  const { base, print, paths: given } = parse(process.argv.slice(2));
  const changed = given.length ? given
    : [...new Set([...git(ROOT, 'diff', '--name-only', '--no-renames', base).split('\n'), ...git(ROOT, 'ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean))].sort();
  const { full, tests, reasons } = select(changed), bun = tests.filter(test => COPIED.includes(test));
  const packed = changed.some(path => COPIED.includes(path) || PACKED.some(pattern => pattern.test(path)));
  console.log(changed.length ? `Change gate for ${changed.length} path${changed.length === 1 ? '' : 's'}${given.length ? '' : ` against ${base}`}:` : `No changes against ${base}: the checks only.`);
  for (const reason of reasons) console.log(`  ${reason}`);
  if (changed.length) console.log(`${full ? 'The whole suite' : `${tests.length} test files`} (~${minutes(tests)} min), ${bun.length} under Bun too; packed stage: ${packed ? 'yes' : 'no'}.`);
  if (!print) {
    const run = (command: string, ...rest: string[]) => execFileSync(command, rest, { cwd: ROOT, stdio: 'inherit' });
    const steps: string[] = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.check.split(' && ');
    assert.ok(steps.includes('npm test'), 'npm run check no longer runs the suite as npm test; update the gate');
    run('sh', '-c', steps.filter(step => step !== 'npm test').join(' && '));
    if (tests.length) run('npm', 'test', ...(full ? [] : ['--', ...tests]));
    for (const test of bun) {
      const { stdout, stderr } = await runRuntimeFixture('bun', ['test', test], { cwd: ROOT, timeout: 600_000 });
      process.stdout.write(stdout); process.stderr.write(stderr);
    }
    if (packed) {
      console.log('The packed stage rebuilds dist/release, so the next closeout runs its full verify.');
      run('npm', 'run', 'release:build');
      run('npm', 'run', 'release:test');
    }
    console.log('Change gate passed.');
  }
}
