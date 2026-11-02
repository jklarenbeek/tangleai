import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { importSpecifiers } from '../import-specifiers.ts';

it('Jaren AI integrations depend only on public engine/editor and mechanism entries', () => {
  const root = 'packages/jaren', pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  let checked = 0;
  for (const file of readdirSync(join(root, 'src')).filter(name => /\.ts$/.test(name))) {
    const path = join(root, 'src', file);
    const specifiers = importSpecifiers(path).filter(entry => entry.kind === 'static' || entry.kind === 'type').map(entry => entry.specifier);
    for (const specifier of specifiers) {
      if (specifier.startsWith('.')) { assert.match(specifier, /^\.\/[\w-]+\.ts$/); continue; }
      const name = specifier.split('/').slice(0, 2).join('/');
      assert.ok(pkg.dependencies[name], `${path}: undeclared ${name}`);
      assert.match(name, /^@(?:jarenjs\/(?:core|validate|json|app|flow|db|studio|linq)|tangleai\/(?:models|context|agents))$/);
      assert.doesNotMatch(specifier, /\/src\/|\/dist\/|website|vendor/);
      assert.ok(import.meta.resolve(specifier), `${path}: public entry missing`); checked++;
    }
  }
  assert.ok(checked > 25, 'The authoring, spatial and editor integration closure was inspected.');
});
