/** Generate record declarations from the canonical schema and its native owners. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { researchSchema } from '@tangleai/research';
import { researchDeclarationSchema } from './research-schema-dependencies.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: research-contracts.ts [--check]');
const source = 'packages/research/schemas/research.schema.json';
const path = 'packages/research/src/contracts.gen.ts';
const bytes = emitTypeScript(researchDeclarationSchema(researchSchema), { source }).trimEnd() + '\n';
if (args.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw new Error('Research record declarations have drifted.');
} else await writeFile(path, bytes);
