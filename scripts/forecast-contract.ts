/** Bundle the canonical record and read schemas without a parallel DTO definition. */
import { readFile, writeFile } from 'node:fs/promises';
import schema from '../packages/forecast/schemas/forecast.schema.json' with { type: 'json' };
const names = ['questions.list','question.get','checkpoints.list','checkpoint.get','note.get','evidence.list','trace.get','revision.get','harness.version.get','harness.head','resolution.get','retrospective.get','due.list'];
const operations = Object.fromEntries(names.map(name => {
  const key = name.replace(/\.([a-z])/g,(_match,letter: string) => letter.toUpperCase());
  return ['forecast.' + name,{ kind: 'read',input: { $ref: '#/$defs/' + key + 'Query' },output: { $ref: '#/$defs/' + key + 'ReadResult' } }];
}));
const bytes = JSON.stringify({ $contract: '0.1',id: 'tangle-forecast',version: '1',$defs: schema.$defs,operations },null,2) + '\n';
const path = new URL('../packages/forecast/schemas/forecast.contract.json',import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path,'utf8') !== bytes) throw Error('Forecast contract bundle is stale; run npm run emit:forecast-contract');
} else await writeFile(path,bytes);
