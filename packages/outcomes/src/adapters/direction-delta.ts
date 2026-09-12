/** A finite scalar correction policy with a strict, unrounded tolerance. */
import schema from '../../schemas/direction-delta.schema.json' with { type: 'json' };
import { adapterIdentity, domainValidator } from '../domain.ts';
import { reject } from '../errors.ts';
import type { OutcomeAdapter } from '../adapters.ts';
import type { Input, Output, Resolution, Artifact } from './direction-delta.gen.ts';

export async function createDirectionDeltaAdapter(): Promise<OutcomeAdapter> {
  const schemas = schema.$defs;
  const input = domainValidator(schemas.input), output = domainValidator(schemas.output);
  const resolution = domainValidator(schemas.resolution), artifact = domainValidator(schemas.artifact);
  return Object.freeze({
    identity: await adapterIdentity('direction-delta/v1', schemas, { tolerance: 0.05, comparison: 'strict', zero: 'nonnegative', interpreter: 'base+offset' }),
    schemas, staticPayload: { offset: 0 }, validatePayload: () => [],
    interpret(raw, payload) {
      const { base } = input(raw) as unknown as Input, { offset } = artifact(payload) as unknown as Artifact;
      const predicted = base + offset;
      if (!Number.isFinite(predicted)) reject('OUTC1010', 'Scalar addition is not finite.');
      return { predicted };
    },
    score(raw, evidence) {
      const { predicted } = output(raw) as unknown as Output, { actual } = resolution(evidence) as unknown as Resolution;
      const sameDirection = (predicted >= 0 && actual >= 0) || (predicted < 0 && actual < 0);
      const difference = Math.abs(predicted - actual);
      return {
        outcome: sameDirection ? difference < 0.05 ? 'success' : 'partial' : 'failure',
        diagnostics: { sameDirection, difference: Number.isFinite(difference) ? difference : null, differenceOverflow: !Number.isFinite(difference) },
      };
    },
  } satisfies OutcomeAdapter);
}
