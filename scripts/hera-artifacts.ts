/** Prompt compilation is build-only; GMPL owns parsing, interpolation and identities. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileGmplPromptPack, gmplCatalogDocument, createGmplCatalog, gmplSchemaOf,
  type GmplPromptArtifact, type GmplVariables } from '@tangleai/gmpl';
import { heraSchemaOf, type HeraSchemaName } from '../packages/hera/src/schema.ts';
import { heraPromptFiles, heraOutputName } from './hera-sources.ts';
const args = process.argv.slice(2);
if (args.length > 1 || args.some(a => a !== '--check')) throw new Error('usage: hera-artifacts.ts [--check]');
const prompts: GmplPromptArtifact[] = [];
const scalar = { schema:{type:'string',minLength:1}, render:'text' as const };
const data = (schema: Record<string,unknown>): GmplVariables[string] => ({schema,render:'json'});
const controls: Record<string,GmplVariables> = {
  'plan-generation': {query:scalar,profile:data(heraSchemaOf('heraProfile')),offered_experiences:data({type:'array',items:heraSchemaOf('heraExperience')}),agents:data({type:'array',items:{type:'object'}}),caps:data(heraSchemaOf('heraBudget'))},
  reflection: {query:scalar,profile:data(heraSchemaOf('heraProfile')),trajectories:data({type:'array',items:{type:'object'}})},
  consolidation: {scope:scalar,insights:data({type:'array',items:{type:'object'}}),library:data({type:'array',items:heraSchemaOf('heraExperience')}),config:data(heraSchemaOf('heraLearningConfig'))},
  'rope-evolution': {agent:scalar,current_prompt:scalar,failures:data({type:'array',items:{type:'object'}}),trials:data({type:'array',items:{type:'object'}}),axis:scalar},
  'topology-mutation': {topology:data(heraSchemaOf('heraTopology')),failures:data({type:'array',items:{type:'object'}}),agents:data({type:'array',items:{type:'object'}}),caps:data(heraSchemaOf('heraBudget'))},
};
for (const path of heraPromptFiles()) {
  const id = path.split('/').at(-1)!.slice(0,-5);
  const variables: GmplVariables = controls[id] ?? { query:scalar,evidence:data({type:'array',items:gmplSchemaOf('gmplEvidenceUnit')}),context:data({type:'object'}) };
  const built = await compileGmplPromptPack(await readFile(path,'utf8'), {variables,outputSchema:heraSchemaOf(heraOutputName(id) as HeraSchemaName)});
  if (!built.valid) throw new Error(path + ': ' + JSON.stringify(built.issues));
  prompts.push(built.value);
}
const catalog = await gmplCatalogDocument({id:'hera-default',prompts,domains:[],recipes:[]});
const checked = await createGmplCatalog(catalog);
if (!checked.valid) throw new Error(JSON.stringify(checked.issues));
const path = 'packages/hera/artifacts/catalog.json', bytes = JSON.stringify(catalog,null,2) + '\n';
if (args.includes('--check')) { if (await readFile(path,'utf8') !== bytes) throw new Error('HERA artifact drift.'); }
else await writeFile(path,bytes);
console.log(`HERA: ${prompts.length} compiled artifacts; ${catalog.revision}`);
