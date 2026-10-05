/** Emit the domain report and its fixture contracts from their one schema owner. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { RESEARCH_DOMAINS_SCHEMA } from '../benchmark/lib/research-domains-schema.ts';
import { researchReportDeclarationSchema } from './research-schema-dependencies.ts';
import { ARC_MANIFEST_SCHEMA, ARC_TOPIC_SCHEMA } from '../benchmark/lib/research-arc-schema.ts';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw Error('Usage: research-domains-schema.ts [--check]');
const source = 'benchmark/schemas/research-domains.schema.json';
await mkdir('benchmark/fixtures/research/external', { recursive: true });
for (const [path, bytes] of [[source, JSON.stringify(RESEARCH_DOMAINS_SCHEMA, null, 2) + '\n'],
  ['benchmark/schemas/arc-bench-topic.schema.json', JSON.stringify(ARC_TOPIC_SCHEMA, null, 2) + '\n'],
  ['benchmark/fixtures/research/external/arc-bench.manifest.schema.json', JSON.stringify(ARC_MANIFEST_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research-domains.types.ts', emitTypeScript(researchReportDeclarationSchema(RESEARCH_DOMAINS_SCHEMA),
    { name: 'ResearchDomainsReport', source }).trimEnd() + '\n']]) {
  if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Research domain schema drift: ' + path); }
  else await writeFile(path, bytes);
}
