/** Emit matrix declarations from the same closed schema used by the instrument. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { RESEARCH_ABLATION_SCHEMA } from '../benchmark/lib/research-ablation-schema.ts';
import { researchReportDeclarationSchema } from './research-schema-dependencies.ts';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('Usage: research-ablation-schema.ts [--check]');
const source = 'benchmark/schemas/research-ablation.schema.json';
for (const [path, bytes] of [[source, JSON.stringify(RESEARCH_ABLATION_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research-ablation.types.ts', emitTypeScript(researchReportDeclarationSchema(RESEARCH_ABLATION_SCHEMA),
    { name: 'ResearchAblationReport', source }).trimEnd() + '\n']]) {
  if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Research ablation schema drift: ' + path); }
  else await writeFile(path, bytes);
}
