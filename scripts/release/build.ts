/** Compile the publication boundary without changing workspace source exports. */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, basename, relative, dirname } from 'node:path';
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
    const path = typeof target === 'string' ? target : target.default;
    assert.equal(typeof path, 'string', `${pkg.name}: source exports need an explicit runtime path`);
    assert.match(path!, /^\.\/(?:src\/[\w/.-]+\.(?:ts|js)|schemas\/[\w.-]+\.json|styles\/[\w/.-]+\.css|package\.json)$/);
    assert.ok(!path!.includes('..'), 'Export paths cannot traverse outside the package');
    if (typeof target !== 'string') {
      assert.match(path!, /\.js$/);
      assert.equal(target.types, path!.replace('./src/', './dist/types/').replace(/\.js$/, '.d.ts'), `${pkg.name}: declaration path must match its JS source`);
      assert.deepEqual(Object.keys(target).sort(), ['default', 'types']);
    }
    return [name, /\.(ts|js)$/.test(path!) ? { types: path!.replace(/\.(ts|js)$/, '.d.ts'), import: path!.replace(/\.ts$/, '.js'), default: path!.replace(/\.ts$/, '.js') } : path];
  }));
  const result = { ...pkg, main: './src/index.js', types: './src/index.d.ts', exports };
  delete result.scripts;
  delete result.devDependencies;
  return result;
}
/** Keep the inherited JS/JSDoc source language and check every emitted declaration.
 * Existing TypeScript retains its strict source gate. JS declaration emission
 * uses the source suite's compiler contract; the following strict program and
 * installed consumers verify the resulting API rather than skipping its files. */
export function buildJavaScriptDeclarations(root = ROOT) {
  const declarations: string[] = [];
  for (const dir of config(root).packages) {
    const pkg = readJson(resolve(root, dir, 'package.json'));
    if (!pkg.main?.endsWith('.js')) continue;
    const source = resolve(root, dir, 'src'), output = resolve(root, dir, 'dist/types');
    rmSync(output, { recursive: true, force: true });
    const files = ts.sys.readDirectory(source, ['.js']);
    assert.ok(files.length > 0, `${pkg.name}: no JS source discovered`);
    const program = ts.createProgram(files, {
      allowJs: true, declaration: true, emitDeclarationOnly: true, noCheck: true,
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      rootDir: source, outDir: output, newLine: ts.NewLineKind.LineFeed,
    });
    const emitted = program.emit();
    if (emitted.diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(emitted.diagnostics, {
      getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
    assert.equal(emitted.emitSkipped, false, `${pkg.name}: declaration emission failed`);
    assert.equal(emitted.diagnostics.length, 0);
    // The inherited program pen has a deliberately authored phantom-binding
    // contract. Preserve such declarations, then check them with every emitted
    // declaration rather than widening their API through JS inference.
    for (const declaration of ts.sys.readDirectory(source, ['.d.ts'])) {
      assert.ok(existsSync(declaration.replace(/\.d\.ts$/, '.js')), `${declaration}: no corresponding JavaScript module`);
      const destination = resolve(output, relative(source, declaration));
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(declaration, destination);
    }
    declarations.push(...ts.sys.readDirectory(output, ['.d.ts']));
  }
  if (declarations.length) {
    const checked = ts.createProgram(declarations, { strict: true, noEmit: true, skipLibCheck: false,
      target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext });
    const diagnostics = ts.getPreEmitDiagnostics(checked);
    if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: path => path, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }));
  }
  console.log(`Emitted and strictly checked ${declarations.length} JS declaration modules.`);
}
export async function buildPackages(root = ROOT) {
  const cfg = config(root);
  buildJavaScriptDeclarations(root);
  const main = readJson(resolve(root, 'package.json'));
  const destination = resolve(root, 'dist/npm');
  const releaseDir = resolve(root, 'dist/release');
  rmSync(destination, { recursive: true, force: true });
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  mkdirSync(releaseDir, { recursive: true });
  const loaded = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent({ ...loaded.config, include: ['packages/*/src/**/*.ts'] }, ts.sys, root, {
    noEmit: false, declaration: true, declarationMap: false, sourceMap: false,
    rewriteRelativeImportExtensions: true, rootDir: resolve(root, 'packages'), outDir: destination,
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
    if (sourceManifest.main?.endsWith('.js')) {
      cpSync(resolve(source, 'src'), resolve(output, 'src'), { recursive: true });
      cpSync(resolve(source, 'dist/types'), resolve(output, 'src'), { recursive: true });
    }
    if (existsSync(resolve(source, 'styles'))) cpSync(resolve(source, 'styles'), resolve(output, 'styles'), { recursive: true });
    for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
      assert.ok(existsSync(resolve(source, file)), `${dir}: missing ${file}`);
      cpSync(resolve(source, file), resolve(output, file));
    }
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
      assert.ok(file === 'package.json' || ['README.md', 'LICENSE', 'CHANGELOG.md'].includes(file) || /^src\/.+\.(js|d\.ts)$/.test(file) || /^schemas\/.+\.json$/.test(file) || /^styles\/.+\.css$/.test(file), `${pkg.name}: unexpected packed file ${file}`);
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
  assert.ok(process.argv.slice(2).every(arg => arg === '--declarations'));
  if (process.argv.includes('--declarations')) buildJavaScriptDeclarations();
  else await buildPackages();
}
