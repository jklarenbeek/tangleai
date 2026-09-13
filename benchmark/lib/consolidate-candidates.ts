/** Actual opt-in memory tiers, separated from their matched raw lexical control. */
import { createConsolidationMemoryStore, createConsolidationSource, planDeterministicConsolidation,
  createConsolidationLexicalIndex, fuseConsolidationRanks, DEFAULT_CONSOLIDATION_TIER,
  type ConsolidationArtifact } from '@tangleai/memory/consolidation';
import { consolidationMust as must } from './consolidate-store-probes.ts';
import type { Candidate, CandidateStatistics, EvidenceSource } from './consolidate.ts';
import { emptyFailures } from './consolidate.ts';
import { createFrozenBm25Reference } from './consolidate-bm25-reference.ts';
import JAREN from '../registrations/consolidate-jaren.json' with { type: 'json' };
import CONFIG from '../registrations/consolidate-deterministic.json' with { type: 'json' };

const statistics = (sources: number): CandidateStatistics => ({ artifacts: 0, retainedSources: sources,
  outputChars: 0, logicalCalls: 0, embeddingItems: 0, failures: emptyFailures() });
const nativeIndex = (documents: Parameters<typeof createConsolidationLexicalIndex>[0]) => createConsolidationLexicalIndex(documents, { limits: { maxResults: JAREN.maxResults } });
export function lexicalControl(native = false): Candidate {
  return { key: native ? 'raw-jaren' : 'raw-lexical', origin: 'keyless', async prepare(sources) {
    const index = (native ? nativeIndex : createFrozenBm25Reference)(sources.map(source => ({ id: source.key, text: source.unit.text })));
    return { rank: async question => index.rank(question).map(hit => hit.id), statistics: statistics(sources.length) };
  } };
}
export async function deterministicCandidateSources(input: readonly EvidenceSource[]) {
  const store = createConsolidationMemoryStore();
  const sources = [];
  for (const source of input) sources.push(must(await createConsolidationSource({ scope: 'benchmark', key: source.key,
    sequence: source.sequence, snapshot: source.unit })));
  if (sources.length) must(await store.enqueue(sources, { maxPending: sources.length }));
  const stats = statistics(sources.length);
  let generation = 0;
  for (const name of Object.keys(DEFAULT_CONSOLIDATION_TIER) as Array<keyof typeof DEFAULT_CONSOLIDATION_TIER>)
    if (CONFIG[name] !== DEFAULT_CONSOLIDATION_TIER[name]) throw new Error('registered deterministic configuration moved');
  for (let start = 0; start < sources.length; start += CONFIG.maxSources) {
    const batch = sources.slice(start, start + CONFIG.maxSources);
    const plan = await planDeterministicConsolidation(batch);
    if (plan.status !== 'success') { stats.failures[plan.reason === 'budget' ? 'budget' : 'source']++; continue; }
    const receipt = await store.apply({ scope: 'benchmark', key: `batch-${start}`, expectedGeneration: generation,
      sourceIds: plan.value.sourceIds, recipeHash: plan.value.recipeHash, artifacts: plan.value.artifacts, completedAt: 1000 });
    if (receipt.status !== 'success') { stats.failures[receipt.reason === 'persistence' ? 'persistence' : 'conflict']++; continue; }
    generation = receipt.value.generation;
  }
  const state = must(await store.snapshot('benchmark'));
  stats.artifacts = state.artifacts.length; stats.retainedSources = state.sources.length;
  stats.outputChars = state.artifacts.reduce((sum, artifact) => sum + artifact.text.length, 0);
  const addresses = new Map(sources.map(source => [source.id, source.key]));
  return { artifacts: state.artifacts, addresses, statistics: stats };
}
export function artifactEvidenceRank(artifacts: readonly ConsolidationArtifact[], addresses: ReadonlyMap<string, string>, native = true) {
  const index = (native ? nativeIndex : createFrozenBm25Reference)(artifacts.map(artifact => ({ id: artifact.id,
    text: `${artifact.text}\n${artifact.keywords.join(' ')}` })));
  const lookup = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  return (question: string) => index.rank(question).flatMap(hit => lookup.get(hit.id)!.sourceIds.map(id => addresses.get(id)!));
}
export function deterministicCandidate(hybrid = false, native = false): Candidate {
  return { key: `deterministic${native ? '-jaren' : ''}${hybrid ? '-hybrid' : ''}`, origin: 'keyless', async prepare(sources) {
    const prepared = await deterministicCandidateSources(sources);
    const rank = artifactEvidenceRank(prepared.artifacts, prepared.addresses, native);
    const raw = (native ? nativeIndex : createFrozenBm25Reference)(sources.map(source => ({ id: source.key, text: source.unit.text })));
    return { rank: async question => hybrid ? fuseConsolidationRanks([raw.rank(question).map(hit => hit.id), rank(question)]) : rank(question),
      statistics: prepared.statistics };
  } };
}
