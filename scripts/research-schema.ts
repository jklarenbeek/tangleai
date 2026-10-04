/** Emit record assets and resolve their owners only for native declaration generation. */
import { readFile, writeFile } from 'node:fs/promises';
import { emitTypeScript } from '@jarenjs/emit';
import { runIdentitySchema } from '@tangleai/config';
import { masRuntimeSchema, masWorkflowSchema, masRegistrySchema } from '@tangleai/mas';
import { RESEARCH_RECORD_SCHEMA, RESEARCH_REPORT_SCHEMA, RESEARCH_RECORD_ID } from '../benchmark/lib/research-schema.ts';

const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => arg !== '--check')) throw new Error('Usage: research-schema.ts [--check]');
const reportPath = 'benchmark/schemas/research.schema.json';
const config = JSON.parse(JSON.stringify(runIdentitySchema)
  .replaceAll('"#runIdentity"', '"#/$defs/ConfigRunIdentity"')
  .replaceAll('"#/$defs/', '"#/$defs/Config_'));
// The root anchor names the root schema, not a definition.
const { $defs: configDefs, $id: _id, $anchor: _anchor, ...configRoot } = config;
const emission = JSON.parse(JSON.stringify(RESEARCH_REPORT_SCHEMA)
  .replaceAll('"' + RESEARCH_RECORD_ID + '#/$defs/', '"#/$defs/')
  .replaceAll('"https://tangleai.dev/schemas/run-identity#/$defs/', '"#/$defs/Config_'));
emission.$defs = { ...RESEARCH_RECORD_SCHEMA.$defs, ...emission.$defs,
  ...Object.fromEntries(Object.entries(configDefs).map(([key, value]) => ['Config_' + key, value])),
  Config_ConfigRunIdentity: configRoot };
// Native MAS shapes keep their owner; namespacing is for the generated declaration bundle only.
for (const [prefix, owner] of [['MasRuntime', masRuntimeSchema], ['MasWorkflow', masWorkflowSchema], ['MasRegistry', masRegistrySchema]] as const) {
  const { $defs, $id, ...root } = JSON.parse(JSON.stringify(owner).replaceAll('"#/$defs/', '"#/$defs/' + prefix + '_'));
  emission.$defs[prefix] = root;
  Object.assign(emission.$defs, Object.fromEntries(Object.entries($defs).map(([key, value]) => [prefix + '_' + key, value])));
}
const completeEmission = JSON.parse(JSON.stringify(emission)
  .replaceAll('"https://tangleai.dev/schemas/mas-runtime#/$defs/', '"#/$defs/MasRuntime_')
  .replaceAll('"https://tangleai.dev/schemas/mas-workflow#/$defs/', '"#/$defs/MasWorkflow_')
  .replaceAll('"https://tangleai.dev/schemas/mas-registry#/$defs/', '"#/$defs/MasRegistry_')
  .replaceAll('"https://tangleai.dev/schemas/mas-workflow"', '"#/$defs/MasWorkflow"')
  .replaceAll('"https://tangleai.dev/schemas/mas-registry"', '"#/$defs/MasRegistry"'));
const outputs = new Map([
  [reportPath, JSON.stringify(RESEARCH_REPORT_SCHEMA, null, 2) + '\n'],
  ['benchmark/lib/research.types.ts', emitTypeScript(completeEmission, { name: 'ResearchReport', source: reportPath }).trimEnd() + '\n'],
]);
for (const [path, bytes] of outputs) {
  if (args.includes('--check')) {
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Research schema drift: ' + path);
  } else await writeFile(path, bytes);
}
