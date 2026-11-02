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
const VIEW_ONLY = ['./view'];
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
function reach(entry: string) {
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
  return { modules: seen.size, tangle: [...tangle].sort(), jaren: [...jaren].sort() };
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

it('every assistant script entry reaches the model, agent and context mechanisms today', t => {
  const entries = Object.entries(assistant.exports).filter(([, path]) => path.endsWith('.ts'));
  assert.deepEqual(entries.map(([name]) => name), ['.', './component']);
  for (const [name, path] of entries) {
    const graph = reach(resolve(assistant.directory, path));
    t.diagnostic(`${name}: ${graph.modules} workspace modules; ${graph.tangle.join(', ')}; ${graph.jaren.length} Jaren entries`);
    assert.deepEqual(graph.tangle, MECHANISMS, name);
  }
});

it('a graph without Tangle imports reaches no Tangle package', () => {
  const graph = reach(join(root, 'test/fixtures/import-graph/entry.ts'));
  assert.deepEqual(graph, { modules: 2, tangle: [], jaren: ['@jarenjs/core/message'] });
});

it('view-only assistant entries reach no model, agent or context module', t => {
  for (const name of VIEW_ONLY) {
    const path = assistant.exports[name];
    if (!path) { t.diagnostic(`${name} not exported yet`); continue; }
    const graph = reach(resolve(assistant.directory, path));
    t.diagnostic(`${name}: ${graph.modules} workspace modules; ${graph.jaren.length} Jaren entries`);
    assert.deepEqual(graph.tangle.filter(reached => MECHANISMS.includes(reached)), [], name);
  }
});
