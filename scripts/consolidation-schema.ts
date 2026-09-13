/** Emit the composed memory schema and its declarations from one definition. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { CONSOLIDATION_SCHEMA } from '../packages/core/src/schemas/consolidation-definition.ts';
const outputs = new Map([
  ['packages/core/schemas/consolidation.schema.json', JSON.stringify(CONSOLIDATION_SCHEMA, null, 2) + '\n'],
  ['packages/core/src/schemas/consolidation.gen.ts', emitTypeScript(CONSOLIDATION_SCHEMA, { name: 'ConsolidationContracts' })],
]);
for (const [path, content] of outputs) {
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`regenerate ${path} with node scripts/consolidation-schema.ts`);
  } else await writeFile(path, content);
}
