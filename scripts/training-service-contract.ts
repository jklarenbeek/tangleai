/** The training wire carries the settled backend records without a second DTO tree. */
import { readFile, writeFile } from 'node:fs/promises';
import { compileContract } from '@jarenjs/contract';
import schema from '../packages/experiential/schemas/experiential.schema.json' with { type: 'json' };
const ref = (name: string) => ({ $ref: '#/$defs/' + name });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const job = object({ jobId: schema.$defs.BackendJob.properties.id });
const operations = {
  'training.capabilities': { kind: 'read', input: object({}), output: ref('TrainingCapabilities'), http: { method: 'GET', path: '/capabilities' } },
  'training.submit': { kind: 'command', input: ref('TrainingSpec'), output: ref('BackendJob'), policy: { idempotency: 'required' }, http: { method: 'POST', path: '/jobs' } },
  'training.inspect': { kind: 'read', input: job, output: ref('BackendJobState'), http: { method: 'GET', path: '/jobs/{jobId}' } },
  'training.cancel': { kind: 'command', input: job, output: ref('BackendJobState'), policy: { idempotency: 'required' }, http: { method: 'POST', path: '/jobs/{jobId}/cancel' } },
  'training.materialize': { kind: 'read', input: job, output: ref('ArtifactReceipt'), http: { method: 'GET', path: '/jobs/{jobId}/artifact' } },
};
const defs: Record<string, unknown> = {};
function include(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(include); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, member] of Object.entries(value)) {
    if (key === '$ref' && typeof member === 'string' && member.startsWith('#/$defs/')) {
      const name = member.slice(8);
      if (!Object.hasOwn(defs, name)) {
        if (!Object.hasOwn(schema.$defs, name)) throw Error('Unknown training schema reference');
        defs[name] = schema.$defs[name as keyof typeof schema.$defs]; include(defs[name]);
      }
    } else include(member);
  }
}
include(operations);
const document = { $contract: '0.1', id: 'tangle-training-service', version: '1', $defs: defs, operations };
compileContract(document);
const bytes = JSON.stringify(document, null, 2) + '\n';
const path = new URL('../packages/experiential/schemas/training-service.contract.json', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== bytes) throw Error('Training service contract is stale; run npm run emit:experiential-contract');
} else await writeFile(path, bytes);
