/** Emit the research report while resolving records only in declaration output. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { researchReportDeclarationSchema } from './research-schema-dependencies.ts';
import { RESEARCH_REPORT_SCHEMA } from '../benchmark/lib/research-schema.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: research-schema.ts [--check]');
const reportPath = 'benchmark/schemas/research.schema.json';
const outputs = new Map([
  [reportPath, JSON.stringify(RESEARCH_REPORT_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research.types.ts', emitTypeScript(researchReportDeclarationSchema(RESEARCH_REPORT_SCHEMA),
    { name: 'ResearchReport', source: reportPath }).trimEnd() + '\n'],
]);
for (const [path, bytes] of outputs) {
  if (args.includes('--check')) {
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Research schema drift: ' + path);
  } else await writeFile(path, bytes);
}
