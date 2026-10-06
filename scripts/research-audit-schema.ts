/** Emit audit declarations from their closed report contract. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { RESEARCH_AUDIT_SCHEMA } from '../benchmark/lib/research-audit-schema.ts';
import { researchReportDeclarationSchema } from './research-schema-dependencies.ts';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('Usage: research-audit-schema.ts [--check]');
const source = 'benchmark/schemas/research-audit.schema.json';
for (const [path, bytes] of [[source, JSON.stringify(RESEARCH_AUDIT_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research-audit.types.ts', emitTypeScript(researchReportDeclarationSchema(RESEARCH_AUDIT_SCHEMA),
    { name: 'ResearchAuditReport', source }).trimEnd() + '\n']]) {
  if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Research audit schema drift: ' + path); }
  else await writeFile(path, bytes);
}
