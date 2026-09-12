/** Bundle the canonical schemas once; the wire contract has no second DTO tree. */
import { readFile, writeFile } from 'node:fs/promises';
import schema from '../packages/outcomes/schemas/outcomes.schema.json' with { type: 'json' };
const reads = new Set(['inject', 'inspect', 'history']);
const names = ['create', 'resolve', 'score', 'project', 'reflect', 'evaluate', 'approve', 'promote', 'rollback', 'inject', 'inspect', 'history', 'reconcile'];
const operations = Object.fromEntries(names.map(name => [`outcomes.${name}`, {
  kind: reads.has(name) ? 'read' : 'command',
  input: { $ref: `#/$defs/${name}Command` },
  output: { $ref: `#/$defs/${name}Result` },
  ...(reads.has(name) ? {} : { policy: { idempotency: 'none' } }),
}]));
const bytes = JSON.stringify({ $contract: '0.1', id: 'tangle-outcomes', version: '1', $defs: schema.$defs, operations }, null, 2) + '\n';
const path = new URL('../packages/outcomes/schemas/outcomes.contract.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('OUTCOME contract bundle is stale; run npm run emit:outcomes-contract');
} else await writeFile(path, bytes);
