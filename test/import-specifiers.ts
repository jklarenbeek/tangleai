import { readFileSync } from 'node:fs';
import ts from 'typescript';

export type ImportKind = 'static' | 'dynamic' | 'type' | 'jsdoc';

/**
 * Every module specifier a TypeScript source names, in visit order with repeats,
 * then the `import('…')` references inside JSDoc blocks. `type` is a
 * declaration-level `import type`/`export type … from` or an `import('…')` type
 * node; a declaration whose bindings are all inline `type` still loads its module
 * under `verbatimModuleSyntax`, so it is `static`.
 */
export function importSpecifiers(file: string): { specifier: string, kind: ImportKind }[] {
  const source = readFileSync(file, 'utf8');
  const found: { specifier: string, kind: ImportKind }[] = [];
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      found.push({ specifier: node.moduleSpecifier.text, kind: node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword ? 'type' : 'static' });
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      found.push({ specifier: node.moduleSpecifier.text, kind: node.isTypeOnly ? 'type' : 'static' });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push({ specifier: node.arguments[0].text, kind: 'dynamic' });
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push({ specifier: node.argument.literal.text, kind: 'type' });
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  for (const comment of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) for (const match of comment[0].matchAll(/import\((['"])([^'"]+)\1\)/g)) found.push({ specifier: match[2]!, kind: 'jsdoc' });
  return found;
}
