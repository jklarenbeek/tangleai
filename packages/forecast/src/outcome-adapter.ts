/** One artifact lineage interprets cutoff-pinned prediction bundles by canonical digest. */
import schema from '../schemas/outcome-adapter.schema.json' with { type: 'json' };
import { adapterIdentity, domainValidator, type OutcomeAdapter } from '@tangleai/outcomes';
import { forecastRevision } from './identity.ts';
import { forecastBytes, DEFAULT_FORECAST_POLICY } from './schema.ts';
import { scoreForecastAnswer } from './adapters/index.ts';
import type { HarnessDocument } from './contracts.gen.ts';
import type { Input, Output, Resolution } from './outcome-adapter.gen.ts';
export type { Input as ForecastOutcomeInput, Output as ForecastOutcomeOutput } from './outcome-adapter.gen.ts';

export const SEED_HARNESS: Readonly<HarnessDocument> = Object.freeze({
  factorTracking: 'List the factors that could change the answer.',
  evidenceHandling: 'Check the source and availability of each observation.',
  uncertaintyHandling: 'State the uncertainty that remains before answering.',
});
export async function createForecastHarnessAdapter(): Promise<OutcomeAdapter> {
  const schemas = schema.$defs, input = domainValidator(schemas.input), output = domainValidator(schemas.output), resolution = domainValidator(schemas.resolution), artifact = domainValidator(schemas.artifact);
  return Object.freeze({
    identity: await adapterIdentity('forecast-harness/v1',schemas,{ interpreter: 'digest-lookup',miss: 'failure',scorers: ['choice/v1','numeric/v1'],outputAdapter: 'input-bound/v1' }),
    schemas,staticPayload: { ...SEED_HARNESS },
    normalizePayload: raw => artifact(Object.fromEntries(Object.entries(artifact(raw) as object).map(([key,value]) => [key,(value as string).trimEnd()]))),
    validatePayload(raw) {
      const value = artifact(raw) as unknown as HarnessDocument;
      return forecastBytes(value) > DEFAULT_FORECAST_POLICY.maxHarnessBytes || Object.values(value).some(text => new TextEncoder().encode(text).length > DEFAULT_FORECAST_POLICY.maxComponentBytes) ? [{ code: 'OUTC1010',detail: 'Forecast harness exceeds its UTF-8 byte bound.',path: '',retryable: false }] : [];
    },
    async interpret(raw,payload) {
      const value = input(raw) as unknown as Input, digest = await forecastRevision(artifact(payload)), answer = value.predictions[digest];
      return output({ answer: answer ?? null,status: answer === undefined ? 'not-run-under-harness' : 'predicted',adapter: value.adapter });
    },
    score(raw,evidence): ReturnType<OutcomeAdapter['score']> {
      const value = output(raw) as unknown as Output, actual = resolution(evidence) as unknown as Resolution;
      if (value.status === 'not-run-under-harness' || value.answer === null) return { outcome: 'failure',diagnostics: { status: 'not-run-under-harness' } };
      const result = scoreForecastAnswer(value.adapter,value.answer,actual.outcome);
      return result.ok ? { outcome: result.value.category,diagnostics: result.value.diagnostics } : { outcome: 'failure',diagnostics: { status: 'invalid-answer',issues: result.issues.map(i => ({ ...i })) } };
    },
  } satisfies OutcomeAdapter);
}
