/** Order-preserving topic previews; exact evidence lives in the source store. */
import { sizeOf, excerpt } from '@jarenjs/core/chunk';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { sameIdentity } from '@tangleai/context/ledger';
import { consolidationHash, consolidationSuccess as success, consolidationRefusal as refuse,
  createConsolidationArtifact, validateConsolidationSource, type ConsolidationSource,
  type ConsolidationArtifact, type ConsolidationResult } from './contracts.ts';
import type { ConsolidationStore } from './types.ts';
import { consolidationTermCounts } from './lexical.ts';
export const DEFAULT_CONSOLIDATION_TIER = Object.freeze({ maxSources: 10, maxInputChars: 8000,
  maxArtifactChars: 512, maxKeywords: 8, topicThreshold: 0.2, minSegmentSources: 2 });
export interface DeterministicConsolidationOptions {
  maxSources: number; maxInputChars: number; maxArtifactChars: number; maxKeywords: number;
  topicThreshold: number; minSegmentSources: number;
}
export function consolidationEvidence(sources: readonly ConsolidationSource[]) {
  return sources.map(source => ({ id: source.id, key: source.key, text: source.snapshot.text,
    evidence: source.snapshot.evidence, at: source.snapshot.at, tags: source.snapshot.tags }));
}
export type ConsolidationEvidence = ReturnType<typeof consolidationEvidence>[number];
export function consolidationSourceText(sources: readonly ConsolidationSource[]): string {
  return JSON.stringify(consolidationEvidence(sources));
}
export interface DeterministicConsolidationPlan {
  recipeHash: string; sourceIds: string[]; artifacts: ConsolidationArtifact[];
  inputChars: number; outputChars: number; boundaries: number[]; unknownEmbeddingPairs: number;
}
export async function planDeterministicConsolidation(input: readonly ConsolidationSource[],
  options: Partial<DeterministicConsolidationOptions> = {}): Promise<ConsolidationResult<DeterministicConsolidationPlan>> {
  const config = { ...DEFAULT_CONSOLIDATION_TIER, ...options };
  if (['maxSources', 'maxInputChars', 'maxArtifactChars', 'maxKeywords', 'minSegmentSources'].some(key =>
    !Number.isSafeInteger(config[key as keyof typeof config]) || config[key as keyof typeof config] < 1)
    || !Number.isFinite(config.topicThreshold) || config.topicThreshold < -1 || config.topicThreshold > 1)
    return refuse('budget', 'invalid deterministic bounds');
  if (!input.length) return refuse('empty', 'no sources to consolidate');
  if (input.length > config.maxSources) return refuse('budget', 'source count exceeds pass bound');
  const sources: ConsolidationSource[] = [];
  for (const source of input) {
    const checked = await validateConsolidationSource(source); if (checked.status !== 'success') return checked;
    sources.push(checked.value);
  }
  sources.sort((a, b) => a.sequence - b.sequence || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (sources.some(source => source.scope !== sources[0].scope) || new Set(sources.map(source => source.key)).size !== sources.length)
    return refuse('invalid-source', 'pass sources must have unique keys in one scope');
  const inputChars = sizeOf(consolidationSourceText(sources));
  if (inputChars > config.maxInputChars) return refuse('budget', 'rendered source input exceeds pass bound');
  const terms = sources.map(source => consolidationTermCounts(source.snapshot.text));
  const vocabulary = [...new Set(terms.flatMap(counts => [...counts.keys()]))].sort();
  const vectors = terms.map(counts => vocabulary.map(term => counts.get(term) ?? 0));
  let unknownEmbeddingPairs = 0;
  const similarities = sources.slice(1).map((source, i) => {
    const before = sources[i].snapshot, after = source.snapshot;
    if (before.embedding && after.embedding && sameIdentity(before.embeddedBy, after.embeddedBy))
      return cosineSimilarity(before.embedding, after.embedding);
    unknownEmbeddingPairs++;
    return cosineSimilarity(vectors[i], vectors[i + 1]);
  });
  const below = similarities.flatMap((value, i) => value < config.topicThreshold ? [i + 1] : []);
  const minima = below.filter(boundary => similarities[boundary - 1] <= (similarities[boundary - 2] ?? Infinity)
    && similarities[boundary - 1] <= (similarities[boundary] ?? Infinity));
  const boundaries = minima.length ? minima : below;
  const segments: ConsolidationSource[][] = [];
  let start = 0;
  for (const end of [...boundaries, sources.length]) { segments.push(sources.slice(start, end)); start = end; }
  // A tiny contiguous segment joins its neighbor; source order never changes.
  for (let i = 0; i < segments.length && segments.length > 1; i++) {
    if (segments[i].length >= config.minSegmentSources) continue;
    if (i === 0) { segments[1] = [...segments[0], ...segments[1]]; segments.splice(0, 1); i--; }
    else { segments[i - 1].push(...segments[i]); segments.splice(i, 1); i--; }
  }
  const recipeHash = await consolidationHash({ method: 'contiguous-extractive-v1', config });
  const artifacts: ConsolidationArtifact[] = [];
  for (const segment of segments) {
    const text = segment.map(source => source.snapshot.text).join('\n');
    // excerpt's ellipsis is additive. Reserve it, then postcheck the final render.
    let preview = sizeOf(text) <= config.maxArtifactChars ? text : excerpt(text, Math.max(0, config.maxArtifactChars - 1));
    if (sizeOf(preview) > config.maxArtifactChars) return refuse('budget', 'excerpt exceeds final output bound');
    // Avoid emitting a dangling UTF-16 surrogate before the marker.
    preview = preview.replace(/[\uD800-\uDBFF](?=…?$)/u, '');
    if (!preview.trim()) preview = '…';
    const keywords = [...consolidationTermCounts(text)].sort(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, config.maxKeywords).map(([term]) => term);
    const artifact = await createConsolidationArtifact({ scope: sources[0].scope, tier: 'deterministic', recipeHash,
      text: preview, sourceIds: segment.map(source => source.id), keywords });
    if (artifact.status !== 'success') return artifact;
    artifacts.push(artifact.value);
  }
  return success({ recipeHash, sourceIds: sources.map(source => source.id), artifacts, inputChars,
    outputChars: artifacts.reduce((sum, artifact) => sum + sizeOf(artifact.text), 0), boundaries, unknownEmbeddingPairs });
}
export async function applyDeterministicConsolidation(store: ConsolidationStore, sources: readonly ConsolidationSource[],
  input: { key: string; expectedGeneration: number; completedAt: number; options?: Partial<DeterministicConsolidationOptions> }) {
  const plan = await planDeterministicConsolidation(sources, input.options);
  if (plan.status !== 'success') return plan;
  return store.apply({ scope: sources[0].scope, key: input.key, expectedGeneration: input.expectedGeneration,
    completedAt: input.completedAt, sourceIds: plan.value.sourceIds, recipeHash: plan.value.recipeHash, artifacts: plan.value.artifacts });
}
