/** Scripted wire responses qualify mechanics, not extraction quality. */
import { buildTemporalFixture } from '../../benchmark/lib/temporal-runtime-fixtures.ts';
import { TEMPORAL_FIXTURES } from './temporal.ts';
import { temporalValue, type TemporalLimits, type TemporalBundle } from '@tangleai/memory/temporal';
export const TEMPORAL_TEST_LIMITS: TemporalLimits = { maxInputTokens: 100000, maxOutputTokens: 1000, maxPhysicalRequests: 3, maxSources: 100,
  maxClaims: 100, concurrency: 1, deadlineMs: 1000, maxRepairs: 0 };
export const TEMPORAL_TEST_MODEL = { provider: 'custom', baseUrl: 'https://scripted.invalid/v1', model: 'scripted-model', identity: 'scripted-v1' };
export async function temporalTestBundle() { const { expected: _, ...s } = TEMPORAL_FIXTURES[0]; return temporalValue(await buildTemporalFixture(s)).bundle; }
export function extractionReply(bundle: TemporalBundle) {
  return { coveredSourceIds: bundle.sources.map(s => s.id), claims: bundle.claims.map(({ series, value, time, status, citations }) => ({ series, value, time, status, citations })) };
}
export function chatResponse(value: unknown, tokens = 1) { return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: typeof value === 'string' ? value : JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: tokens }, model: 'scripted-model' }), { headers: { 'content-type': 'application/json' } }); }
export function preparationInput(bundle: TemporalBundle) { return { scope: bundle.projection.scope, key: 'prepare', sources: bundle.sources,
  sourceIdentity: 'test-source-v1', policyIdentity: 'test-policy-v1', knowledge: bundle.projection.knowledge, embeddedBy: bundle.projection.embeddedBy,
  embeddings: bundle.projection.embeddings, expectedHead: null, limits: { ...TEMPORAL_TEST_LIMITS } }; }
