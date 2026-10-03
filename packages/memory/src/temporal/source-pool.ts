/** One semantic source ordering shared by temporal and place eligibility. */
import { cosineSimilarity } from '@jarenjs/core/vector';
import type { SourceOccurrence, TemporalProjection, TemporalQuery } from './contracts.ts';

export function temporalSourcePool(sources: SourceOccurrence[], projection: TemporalProjection,
  query: Pick<TemporalQuery, 'embedding' | 'minScore' | 'candidatePool'>) {
  const vectors = new Map(projection.embeddings.map(e => [e.sourceId, e.vector]));
  const comparable = sources.filter(s => vectors.has(s.id)).length;
  const ranked = sources.filter(s => vectors.has(s.id)).map(source => ({ source, score: cosineSimilarity(vectors.get(source.id)!, query.embedding) }))
    .filter(row => row.score >= query.minScore).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id));
  const pool = ranked.slice(0, query.candidatePool), poolIds = new Set(pool.map(r => r.source.id));
  return { vectors, comparable, pool, poolIds, poolTruncated: ranked.length > pool.length };
}
