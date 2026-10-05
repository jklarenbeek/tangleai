/** Generate the referenced lesson measurement contract from one source. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { RESEARCH_LESSONS_SCHEMA } from '../benchmark/lib/research-lessons-schema.ts';
import { researchReportDeclarationSchema } from './research-schema-dependencies.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: research-lessons-schema.ts [--check]');
const source = 'benchmark/schemas/research-lessons.schema.json';
const outputs = new Map([[source, JSON.stringify(RESEARCH_LESSONS_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research-lessons.types.ts', emitTypeScript(researchReportDeclarationSchema(RESEARCH_LESSONS_SCHEMA),
    { name: 'ResearchLessonsReport', source }).trimEnd() + '\n']]);
for (const [path, bytes] of outputs) {
  if (args.includes('--check')) {
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Research lesson schema drift: ' + path);
  } else await writeFile(path, bytes);
}
