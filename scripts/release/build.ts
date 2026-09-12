/** Compile the publication boundary without changing workspace source exports. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import ts from 'typescript';
import { ROOT, config, readJson, writeJson, npm, inputHash, integrity, git, isMain, type Manifest } from './common.ts';

export interface Artifact {
  name: string; version: string; filename: string; integrity: string;
  exports: Record<string, string | Record<string, string>>;
}
export interface Artifacts {
  schemaVersion: 1; version: string; commit: string; inputHash: string; packages: Artifact[];
}
/** TypeScript can drop JSON import attributes while emitting declarations.
 * Installed NodeNext consumers still require those attributes on value imports. */
export const jsonDeclarationAttributes: ts.TransformerFactory<ts.SourceFile | ts.Bundle> = context => source => {
  const visit: ts.Visitor = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text.endsWith('.json') && !node.attributes && !node.importClause?.isTypeOnly) {
      return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, node.moduleSpecifier,
        context.factory.createImportAttributes(context.factory.createNodeArray([
          context.factory.createImportAttribute(context.factory.createIdentifier('type'), context.factory.createStringLiteral('json')),
        ])));
    }
    return ts.visitEachChild(node, visit, context);
  };
  return ts.visitNode(source, visit) as ts.SourceFile | ts.Bundle;
};
export function distributionManifest(pkg: Manifest): Manifest {
  const exports = Object.fromEntries(Object.entries(pkg.exports ?? {}).map(([name, target]) => {
    assert.equal(typeof target, 'string', `${pkg.name}: workspace exports must point directly to TypeScript or assets`);
    const path = target as string;
    assert.match(path, /^\.\/(?:src\/[\w/.-]+\.ts|(?:schemas|artifacts)\/[\w.-]+\.json|styles\/[\w/.-]+\.css|package\.json)$/);
    assert.ok(!path.includes('..'), 'Export paths cannot traverse outside the package');
    return [name, path.endsWith('.ts') ? { types: path.replace(/\.ts$/, '.d.ts'), import: path.replace(/\.ts$/, '.js'), default: path.replace(/\.ts$/, '.js') } : path];
  }));
  const result = { ...pkg, main: './src/index.js', types: './src/index.d.ts', exports };
  delete result.scripts;
  delete result.devDependencies;
  return result;
}
export async function buildPackages(root = ROOT) {
  const cfg = config(root);
  const main = readJson(resolve(root, 'package.json'));
  const destination = resolve(root, 'dist/npm');
  const releaseDir = resolve(root, 'dist/release');
  rmSync(resolve(root, 'dist/compiled'), { recursive: true, force: true });
  rmSync(destination, { recursive: true, force: true });
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  const loaded = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent({ ...loaded.config, include: ['packages/*/src/**/*.ts', 'components/*/src/**/*.ts'] }, ts.sys, root, {
    noEmit: false, declaration: true, declarationMap: false, sourceMap: false,
    rewriteRelativeImportExtensions: true, rootDir: root, outDir: resolve(root, 'dist/compiled'),
    incremental: false,
    newLine: ts.NewLineKind.LineFeed,
  });
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n',
  }));
  const emitted = program.emit(undefined, undefined, undefined, undefined, { afterDeclarations: [jsonDeclarationAttributes] });
  assert.equal(emitted.emitSkipped, false, 'Package emission failed');
  assert.equal(emitted.diagnostics.length, 0, 'Package emission diagnostics');
  const artifacts: Artifacts = { schemaVersion: 1, version: main.version, commit: git(root, 'rev-parse', 'HEAD'), inputHash: inputHash(root), packages: [] };
  for (const dir of cfg.packages) {
    const source = resolve(root, dir);
    const output = resolve(destination, basename(dir));
    const sourceManifest = readJson(resolve(source, 'package.json'));
    const pkg = distributionManifest(sourceManifest);
    cpSync(resolve(root, 'dist/compiled', dir, 'src'), resolve(output, 'src'), { recursive: true });
    if (existsSync(resolve(source, 'docs'))) cpSync(resolve(source, 'docs'), resolve(output, 'docs'), { recursive: true });
    if (existsSync(resolve(source, 'styles'))) cpSync(resolve(source, 'styles'), resolve(output, 'styles'), { recursive: true });
    for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
      assert.ok(existsSync(resolve(source, file)), `${dir}: missing ${file}`);
      cpSync(resolve(source, file), resolve(output, file));
    }
    if (existsSync(resolve(source, 'artifacts'))) cpSync(resolve(source, 'artifacts'), resolve(output, 'artifacts'), { recursive: true });
    if (existsSync(resolve(source, 'schemas'))) cpSync(resolve(source, 'schemas'), resolve(output, 'schemas'), { recursive: true });
    writeJson(resolve(output, 'package.json'), pkg);
    const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', releaseDir], { root, cwd: output, capture: true }));
    assert.equal(packed.length, 1);
    const pack = packed[0];
    assert.equal(pack.name, pkg.name);
    assert.equal(pack.version, main.version);
    const files = new Set<string>(pack.files.map((file: { path: string }) => file.path));
    for (const required of ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json']) assert.ok(files.has(required), `${pkg.name}: ${required} missing from tarball`);
    for (const file of files) {
      assert.ok(!file.endsWith('.ts') || file.endsWith('.d.ts'), `${pkg.name}: raw TypeScript leaked into npm package`);
      assert.ok(file === 'package.json' || ['README.md', 'LICENSE', 'CHANGELOG.md'].includes(file) || /^src\/.+\.(js|d\.ts)$/.test(file) || /^(?:schemas|artifacts)\/.+\.json$/.test(file) || /^styles\/.+\.css$/.test(file) || /^docs\/.+\.md$/.test(file), `${pkg.name}: unexpected packed file ${file}`);
    }
    for (const target of Object.values(pkg.exports ?? {})) {
      for (const file of typeof target === 'string' ? [target] : Object.values(target)) assert.ok(files.has(file.slice(2)), `${pkg.name}: missing export ${file}`);
    }
    const bytes = readFileSync(resolve(releaseDir, pack.filename));
    assert.equal(integrity(bytes), pack.integrity);
    artifacts.packages.push({ name: pkg.name, version: pkg.version, filename: pack.filename, integrity: pack.integrity, exports: pkg.exports! });
  }
  assert.equal(readdirSync(releaseDir).filter(p => p.endsWith('.tgz')).length, cfg.packages.length);
  writeJson(resolve(releaseDir, 'artifacts.json'), artifacts);
  console.log(`Built ${artifacts.packages.length} JavaScript/declaration tarballs for ${main.version}.`);
  return artifacts;
}
if (isMain(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Unknown build argument');
  await buildPackages();
}
