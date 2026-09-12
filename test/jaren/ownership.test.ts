import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

it('Jaren AI integrations depend only on public engine/editor and mechanism entries', () => {
  const root = 'packages/jaren', pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  let checked = 0;
  for (const file of readdirSync(join(root, 'src')).filter(name => /\.ts$/.test(name))) {
    const path = join(root, 'src', file), source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifiers.push(node.argument.literal.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
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
