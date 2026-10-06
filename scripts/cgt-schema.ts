/** Resolve the identity owner only for native declaration emission. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { runIdentitySchema } from '@tangleai/config';
import schema from '../benchmark/schemas/cgt.schema.json' with { type: 'json' };

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw Error('Usage: cgt-schema.ts [--check]');
const config = JSON.parse(JSON.stringify(runIdentitySchema)
  .replaceAll('"#runIdentity"', '"#/$defs/ConfigRunIdentity"')
  .replaceAll('"#/$defs/', '"#/$defs/Config_'));
const { $defs, $id: _id, $anchor: _anchor, ...configRoot } = config;
const emission = JSON.parse(JSON.stringify(schema)
  .replaceAll('"https://tangleai.dev/schemas/run-identity#/$defs/', '"#/$defs/Config_'));
Object.assign(emission.$defs, Object.fromEntries(Object.entries($defs).map(([key, value]) => ['Config_' + key, value])),
  { Config_ConfigRunIdentity: configRoot });
const path = 'benchmark/lib/cgt.types.ts';
const bytes = emitTypeScript(emission, { name: 'CgtDocuments', source: 'benchmark/schemas/cgt.schema.json' }).trimEnd() + '\n';
if (args.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('CGT declaration drift: ' + path);
} else await writeFile(path, bytes);
