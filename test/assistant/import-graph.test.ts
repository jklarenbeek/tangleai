import { it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSpecifiers } from '../import-specifiers.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const MECHANISMS = ['@tangleai/agents', '@tangleai/context', '@tangleai/models'];
const WITH_MECHANISMS = ['.', './component'];
const VIEW_ONLY = ['./view'];
const PACKS = ['./messages/ar', './messages/de', './messages/es', './messages/fr', './messages/nl', './messages/pt'];
const workspaces = new Map<string, { directory: string, exports: Record<string, string> }>();
for (const group of ['packages', 'components']) for (const name of readdirSync(join(root, group))) {
  const path = join(root, group, name, 'package.json');
  if (!existsSync(path)) continue;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  workspaces.set(manifest.name, { directory: join(root, group, name), exports: manifest.exports ?? {} });
}
const assistant = workspaces.get('@tangleai/assistant')!;

function target(specifier: string, from: string): string | null {
  if (specifier.startsWith('.')) return resolve(dirname(from), specifier);
  const match = /^(@tangleai\/[^/]+)(\/.*)?$/.exec(specifier);
  if (!match) return null;
  const workspace = workspaces.get(match[1]!), subpath = workspace?.exports['.' + (match[2] ?? '')];
  assert.ok(workspace && subpath, `${from}: ${specifier} is not a workspace export`);
  return resolve(workspace.directory, subpath);
}

/** Runtime edges only, through workspace manifests, stopping at Jaren and Node. */
function walk(entry: string) {
  const seen = new Set<string>(), tangle = new Set<string>(), jaren = new Set<string>(), pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file) || !/\.(ts|js)$/.test(file)) continue;
    assert.ok(existsSync(file), `missing module ${file}`);
    seen.add(file);
    for (const { specifier, kind } of importSpecifiers(file)) {
      if (kind !== 'static' && kind !== 'dynamic') continue;
      if (specifier.startsWith('@jarenjs/')) { jaren.add(specifier); continue; }
      const next = target(specifier, file);
      if (!next) continue;
      if (specifier.startsWith('@tangleai/')) tangle.add(specifier.split('/').slice(0, 2).join('/'));
      pending.push(next);
    }
  }
  return { files: [...seen], tangle: [...tangle].sort(), jaren: [...jaren].sort() };
}
function reach(entry: string) {
  const { files, tangle, jaren } = walk(entry);
  return { modules: files.length, tangle, jaren };
}

it('import specifiers separate runtime edges from type-only ones', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-specifiers-'));
  try {
    const file = join(directory, 'kinds.ts');
    await writeFile(file, [
      "import type { A } from 'declared-type';", "import { type B } from 'inline-type';", "export type { C } from 'exported-type';",
      "export * from 'exported';", "import 'side-effect';", "const load = () => import('dynamic');",
      "type D = import('type-node').D;", "/** {@link import('documented')} */", 'export { load, type D };', '',
    ].join('\n'));
    assert.deepEqual(importSpecifiers(file).map(entry => `${entry.kind} ${entry.specifier}`), [
      'type declared-type', 'static inline-type', 'type exported-type', 'static exported', 'static side-effect',
      'dynamic dynamic', 'type type-node', 'jsdoc documented',
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('the root and component entries reach the model, agent and context mechanisms', t => {
  const entries = Object.entries(assistant.exports).filter(([, path]) => path.endsWith('.ts'));
  assert.deepEqual(entries.map(([name]) => name), [...WITH_MECHANISMS, ...VIEW_ONLY, './messages', ...PACKS]);
  for (const name of WITH_MECHANISMS) {
    const graph = reach(resolve(assistant.directory, assistant.exports[name]!));
    t.diagnostic(`${name}: ${graph.modules} workspace modules; ${graph.tangle.join(', ')}; ${graph.jaren.length} Jaren entries`);
    assert.deepEqual(graph.tangle, MECHANISMS, name);
  }
});

it('the message catalogues and the panel projection reach no Tangle package', t => {
  for (const [name, path] of [['./messages', assistant.exports['./messages']!], ...PACKS.map(pack => [pack, assistant.exports[pack]!]),
    ['projection', './src/viewmodel.ts']] as const) {
    const graph = reach(resolve(assistant.directory, path));
    t.diagnostic(`${name}: ${graph.modules} workspace modules; ${graph.jaren.join(', ')}`);
    assert.deepEqual(graph.tangle, [], name);
  }
  for (const pack of PACKS) assert.deepEqual(reach(resolve(assistant.directory, assistant.exports[pack]!)), { modules: 1, tangle: [], jaren: [] }, `${pack} is text and Intl only`);
});

it('a graph without Tangle imports reaches no Tangle package', () => {
  const graph = reach(join(root, 'test/fixtures/import-graph/entry.ts'));
  assert.deepEqual(graph, { modules: 2, tangle: [], jaren: ['@jarenjs/core/message'] });
});

it('view-only assistant entries reach no model, agent or context module', t => {
  for (const name of VIEW_ONLY) {
    const path = assistant.exports[name];
    assert.ok(path, `${name} is exported`);
    const graph = reach(resolve(assistant.directory, path));
    t.diagnostic(`${name}: ${graph.modules} workspace modules; ${graph.jaren.join(', ')}`);
    assert.deepEqual(graph.tangle.filter(reached => MECHANISMS.includes(reached)), [], name);
  }
});

it('the view reaches only the shared rules, projection, catalogue and mount modules, and Jaren entries it renders with', () => {
  const graph = walk(resolve(assistant.directory, assistant.exports['./view']!));
  const source = resolve(assistant.directory, 'src');
  assert.deepEqual(graph.files.map(file => file.slice(source.length + 1)).sort(), ['messages.ts', 'mount.ts', 'state.ts', 'view.ts', 'viewmodel.ts', 'views.ts']);
  assert.deepEqual(graph.tangle, []);
  const allowed = /^@jarenjs\/(?:app|md\/component|md\/plugins|mermaid\/plugin|core\/.+)$/;
  assert.deepEqual(graph.jaren.filter(specifier => !allowed.test(specifier)), []);
  // the host owns the run: nothing in the view keeps time, polls or fetches
  for (const file of graph.files)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(?:setTimeout|setInterval|setImmediate|requestAnimationFrame|queueMicrotask|fetch)\s*\(|\bDate\.now\b|\bnew Date\b|\bperformance\./, file);
});

it('the README names every subpath the package exports', () => {
  const readme = readFileSync(join(assistant.directory, 'README.md'), 'utf8');
  const missing = Object.keys(assistant.exports).filter(name => name !== '.' && name !== './package.json')
    .filter(name => !readme.includes(`\`${name.slice(1)}\``) && !readme.includes(`@tangleai/assistant${name.slice(1)}`));
  assert.deepEqual(missing, []);
});
