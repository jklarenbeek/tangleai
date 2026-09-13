/** Scripted transport/provenance ablation; no answers or gold enter a callback. */
import { createConsolidationMemoryStore, createConsolidationSource, createConsolidationExecutor } from '@tangleai/memory/consolidation';
import { consolidationMust as must } from './consolidate-store-probes.ts';
import { artifactEvidenceRank } from './consolidate-candidates.ts';
import { emptyFailures, type Candidate, type CandidateStatistics } from './consolidate.ts';
import CONFIG from '../registrations/consolidate-scripted.json' with { type: 'json' };
export function scriptedConsolidationCandidate(combined = false): Candidate {
  return { key: combined ? 'combined' : 'semantic', origin: 'scripted', async prepare(input) {
    const store = createConsolidationMemoryStore();
    const sources = [];
    for (const source of input) sources.push(must(await createConsolidationSource({ scope: 'scripted', key: source.key,
      sequence: source.sequence, snapshot: source.unit })));
    if (sources.length) must(await store.enqueue(sources, { maxPending: sources.length }));
    const executor = createConsolidationExecutor({ store, bounds: CONFIG.bounds,
      synthesizer: { id: CONFIG.synthesizer, async run(request) {
        return { status: 'ok', claims: request.sources.map(source => ({ text: source.text, sourceIds: [source.id] })) };
      } },
      verifier: { id: CONFIG.verifier, async run(request) {
        return { status: 'ok', supported: request.claims.map(claim => claim.sourceIds.length === 1
          && request.sources.some(source => source.id === claim.sourceIds[0] && source.text === claim.text)) };
      } },
    });
    const statistics: CandidateStatistics = { artifacts: 0, retainedSources: sources.length, outputChars: 0,
      logicalCalls: 0, embeddingItems: 0, failures: emptyFailures() };
    let generation = 0;
    for (let start = 0; start < sources.length; start += CONFIG.bounds.maxSources) {
      const result = await executor.execute({ scope: 'scripted', key: `batch-${start}`, expectedGeneration: generation,
        sourceIds: sources.slice(start, start + CONFIG.bounds.maxSources).map(source => source.id), completedAt: 1000,
        tier: combined ? 'combined' : 'semantic' });
      statistics.logicalCalls += result.accounting.invoked; statistics.embeddingItems += result.accounting.embeddingItems;
      if (result.status === 'success') generation = result.value.generation;
      else statistics.failures[result.reason === 'unknown' ? 'unknown' : result.reason === 'persistence' ? 'persistence'
        : result.reason === 'budget' ? 'budget' : result.reason === 'refusal' ? 'refusal' : result.reason === 'unsupported' ? 'unsupported'
        : result.reason === 'embedding' ? 'embedding' : result.reason === 'invalid-source' || result.reason === 'invalid-artifact' ? 'source' : 'conflict']++;
    }
    const state = must(await store.snapshot('scripted'));
    statistics.retainedSources = state.sources.length; statistics.artifacts = state.artifacts.length;
    statistics.outputChars = state.artifacts.reduce((sum, artifact) => sum + artifact.text.length, 0);
    const rank = artifactEvidenceRank(state.artifacts, new Map(sources.map(source => [source.id, source.key])));
    return { rank: async question => rank(question), statistics };
  } };
}
