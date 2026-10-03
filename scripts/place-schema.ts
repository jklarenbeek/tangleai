/** Emit composed place contracts and declarations from their single definition. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { PLACE_SCHEMA } from '../packages/core/src/schemas/place-definition.ts';

const outputs = new Map([
  ['packages/core/schemas/place.schema.json', JSON.stringify(PLACE_SCHEMA, null, 2) + '\n'],
  ['packages/core/src/schemas/place.gen.ts', emitTypeScript(PLACE_SCHEMA, { name: 'PlaceContracts' }).trimEnd() + '\n'],
]);
for (const [path, content] of outputs) {
  if (process.argv.includes('--check')) {
    if (await readFile(path, 'utf8') !== content) throw new Error(`regenerate ${path} with node scripts/place-schema.ts`);
  } else await writeFile(path, content);
}
