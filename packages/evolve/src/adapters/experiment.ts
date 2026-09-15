/**
 * The experiment outcome adapter: what an experiment's result MEANT.
 *
 * The prediction is constant — a proposal is submitted because someone
 * expected it to improve something — so the interesting half is the
 * scoring. `kept` is a success, `equal` is partial credit (the change was
 * safe but bought nothing), and everything else is a failure, including
 * the refusals. That mapping is deliberate: a proposal refused for
 * touching a test is not a neutral event, it is a strategy producing
 * changes that are not allowed.
 *
 * The artifact is the selection policy — a weight per strategy — so the
 * outcome lifecycle, not this package, owns how confidence moves.
 */

import schema from '../../schemas/experiment-adapter.schema.json' with { type: 'json' };
import { adapterIdentity, domainValidator } from '@tangleai/outcomes';
import type { OutcomeAdapter } from '@tangleai/outcomes';
import type { Input, Output, Resolution, Artifact } from './experiment.gen.ts';

export async function createExperimentOutcomeAdapter(): Promise<OutcomeAdapter> {
  const schemas = schema.$defs;
  const input = domainValidator(schemas.input);
  const output = domainValidator(schemas.output);
  const resolution = domainValidator(schemas.resolution);
  const artifact = domainValidator(schemas.artifact);

  return Object.freeze({
    identity: await adapterIdentity('evolve-experiment/v1', schemas, {
      scorer: 'kept success; equal partial; every other decision and reason failure',
      interpreter: 'constant improvement prediction',
      normalization: 'none',
    }),
    schemas,
    staticPayload: { weights: {}, version: 1 },
    validatePayload(raw) {
      const payload = artifact(raw) as unknown as Artifact;
      const weights = Object.values(payload.weights);
      const bad = weights.some(weight => !Number.isFinite(weight) || weight < 0 || weight > 1);
      // The refusal shape is the outcome package's own; its constructor is
      // internal, so the members are written here rather than reached for.
      return bad
        ? [{ code: 'OUTC1010' as const, path: '', detail: 'Every strategy weight must be a finite number in [0, 1].', retryable: false }]
        : [];
    },
    interpret(raw) {
      input(raw) as unknown as Input;
      // A proposal exists because someone expected an improvement. The
      // prediction carries no information; the resolution carries all of it.
      return { predicted: 'improve' };
    },
    score(raw, evidence) {
      output(raw) as unknown as Output;
      const resolved = resolution(evidence) as unknown as Resolution;
      const outcome = resolved.decision === 'kept'
        ? 'success'
        : resolved.reason === 'equal' ? 'partial' : 'failure';
      return { outcome, diagnostics: { reason: resolved.reason, delta: resolved.delta } };
    },
  } satisfies OutcomeAdapter);
}
