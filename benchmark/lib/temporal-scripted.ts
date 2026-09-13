/** Scripted providers measure operation mechanics only; they never score model quality. */
import { prepareTemporal, type TemporalStore, type TemporalBundle, type TemporalResult, type ProjectionReceipt } from '@tangleai/memory/temporal';
export async function scriptedTemporalPreparation(bundle: TemporalBundle, mode: string, store: TemporalStore) {
  let calls = 0;
  const input = { scope: bundle.projection.scope, key: 'scripted-prepare', sources: bundle.sources, sourceIdentity: 'scripted-fixture-v1',
    policyIdentity: 'scripted-fixture-v1', knowledge: bundle.projection.knowledge, embeddedBy: bundle.projection.embeddedBy, embeddings: bundle.projection.embeddings,
    expectedHead: null, limits: { maxInputTokens: 100000, maxOutputTokens: 1000, maxPhysicalRequests: mode === 'zero-budget' ? 0 : 1,
      maxSources: 100, maxClaims: 100, concurrency: 1, deadlineMs: 1000, maxRepairs: 0 } };
  const proposal = { coveredSourceIds: bundle.sources.map(s => s.id), claims: bundle.claims.map(({ series, value, time, status, citations }) =>
    ({ series, value, time, status, citations: mode === 'uncited' ? [] : citations })) };
  const options = { store, model: { provider: 'custom', baseUrl: 'https://scripted.invalid/v1', model: 'scripted-model', identity: 'scripted-v1' },
    fetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(proposal) } }], usage: { prompt_tokens: 10, completion_tokens: 1 } })); } };
  let result: TemporalResult<ProjectionReceipt>;
  if (mode === 'concurrent') {
    const outcomes = await Promise.all([prepareTemporal(input, options), prepareTemporal(input, options)]);
    result = outcomes.find(r => r.status === 'success') ?? outcomes[0];
  } else result = await prepareTemporal(input, options);
  const baselineCalls = calls, baseline = store.stats();
  if (mode === 'replay' && result.status === 'success') result = await prepareTemporal(input, options);
  if (mode === 'zero-budget' && calls !== 0) throw Error('zero-budget preparation dispatched a request');
  return { result, calls, activations: store.stats().activations, extraCalls: calls - baselineCalls,
    extraWrites: store.stats().writes - baseline.writes, extraActivations: store.stats().activations - baseline.activations };
}
