import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import ts from 'typescript';
const root = new URL('../../', import.meta.url);
const sourceFiles = (directory: URL) => ts.sys.readDirectory(fileURLToPath(new URL('src/', directory)), ['.ts']);
const withinPackage = (directory: URL, path: string) => {
  const local = relative(fileURLToPath(directory), path);
  return local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
};
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const allowed = {
  models: ['@jarenjs/core', '@jarenjs/validate'],
  context: ['@jarenjs/core', '@jarenjs/validate', '@tangleai/models'],
  agents: ['@jarenjs/contract', '@jarenjs/core', '@jarenjs/validate', '@tangleai/context', '@tangleai/models'],
};
describe('mechanism ownership includes static, dynamic and declaration imports', () => {
  for (const [owner, dependencies] of Object.entries(allowed)) it(`${owner} has exactly its permitted cycle-free package edges`, async () => {
    const directory = new URL(`packages/${owner}/`, root);
    const manifest = JSON.parse(read(`packages/${owner}/package.json`));
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), dependencies);
    for (const field of ['peerDependencies', 'optionalDependencies', 'bundledDependencies']) assert.equal(manifest[field], undefined);
    const files = sourceFiles(directory);
    assert.ok(files.length > 0);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const specifiers = new Set<string>();
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.add(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifiers.add(node.arguments[0].text);
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifiers.add(node.argument.literal.text);
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      for (const comment of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) for (const match of comment[0].matchAll(/import\((['"])([^'"]+)\1\)/g)) specifiers.add(match[2]!);
      for (const specifier of specifiers) {
        if (specifier.startsWith('.')) { assert.ok(withinPackage(directory, resolve(file, '..', specifier))); continue; }
        const pkg = specifier.split('/').slice(0, 2).join('/');
        assert.ok(dependencies.includes(pkg), `${file}: undeclared or policy dependency ${specifier}`);
        assert.ok(!specifier.includes('/src/'), `${file}: private package import ${specifier}`);
      }
    }
    const receipt = JSON.parse(read('docs/migrations/jaren-ai/manifest.json'));
    const expected = receipt.rootSymbols.filter((symbol: { destination: { entry: string } }) => symbol.destination.entry.startsWith(`@tangleai/${owner}/`)).map((symbol: { name: string }) => symbol.name).sort();
    assert.deepEqual(Object.keys(await import(`@tangleai/${owner}`)).sort(), expected);
  });
});

it('ownership scans decode escaped filesystem directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle ownership é-'));
  try {
    await mkdir(join(directory, 'src'));
    await writeFile(join(directory, 'src', 'sample.ts'), 'export const sample = true;\n');
    const url = pathToFileURL(directory + '/');
    assert.equal(sourceFiles(url).length, 1);
    assert.equal(withinPackage(url, join(directory, 'src', 'sample.ts')), true);
    assert.equal(withinPackage(url, directory + '-sibling/file.ts'), false);
    assert.equal(withinPackage(url, resolve(directory, '..')), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
