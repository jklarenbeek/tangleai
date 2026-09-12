/** Trusted adapter registration and schema validation share one boundary. */
import { JarenValidator } from '@jarenjs/validate';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { cloneJson, deepFreeze } from '@jarenjs/core/object';
import { outcomeRevision } from './identity.ts';
import { reject } from './errors.ts';
import type { OutcomeAdapter } from './adapters.ts';
import type { Json } from './outcomes.contracts.gen.ts';

export function domainValidator(schema: object): (value: unknown) => Json {
  const validate = new JarenValidator({ collectErrors: true, unknownFormats: 'ignore' }).compile(schema as Record<string, unknown>);
  return value => {
    try { canonicalizeJson(value); } catch { reject('OUTC1001', 'Expected finite JSON domain data.'); }
    if (!validate(value).valid) reject('OUTC1001', 'Domain schema rejected the value.');
    return deepFreeze(cloneJson(value)) as Json;
  };
}

export async function adapterIdentity(id: string, schemas: OutcomeAdapter['schemas'], rules: Json) {
  const [inputSchema, outputSchema, resolutionSchema, artifactSchema, scorerRevision] = await Promise.all([
    outcomeRevision(schemas.input), outcomeRevision(schemas.output), outcomeRevision(schemas.resolution),
    outcomeRevision(schemas.artifact), outcomeRevision({ id, rules }),
  ]);
  const identity = { id, inputSchema, outputSchema, resolutionSchema, artifactSchema, scorerRevision };
  return Object.freeze({ ...identity, revision: await outcomeRevision(identity) });
}

export function checkedAdapter(adapter: OutcomeAdapter) {
  const input = domainValidator(adapter.schemas.input), output = domainValidator(adapter.schemas.output);
  const resolution = domainValidator(adapter.schemas.resolution), artifact = domainValidator(adapter.schemas.artifact);
  return {
    input, output, resolution,
    artifact(value: unknown) {
      let payload = artifact(value);
      if (adapter.normalizePayload) payload = artifact(adapter.normalizePayload(payload));
      const issues = adapter.validatePayload(payload);
      if (issues.length) reject('OUTC1010', issues.map(i => i.detail).join(' '));
      return payload;
    },
  };
}

export const scoreUtility = (category: 'success' | 'partial' | 'failure'): number =>
  category === 'success' ? 1 : category === 'partial' ? 0.5 : 0;
