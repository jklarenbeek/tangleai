import { fuseReciprocalRanks } from '@tangleai/core/lexical';
import type { DocumentChunk, DocumentParent, DocumentSource } from '@tangleai/documents/contracts';
import type { EvidenceCandidate } from './contracts.gen.ts';
export interface LocalCandidate {
    chunk: DocumentChunk;
    parent: DocumentParent;
    source: DocumentSource;
    scores: EvidenceCandidate['scores'];
}
export interface CandidateRanker<T = LocalCandidate> {
    id: string;
    version: string;
    rank(query: string, candidates: readonly T[], context?: { signal?: AbortSignal }): Promise<T[]>;
}
/** Both raw lanes survive fusion. The suite owns reciprocal-rank arithmetic. */
export function createRrfRanker(k = 60): CandidateRanker {
    if (!Number.isFinite(k) || k <= 0) throw new TypeError('reciprocal rank constant must be positive');
    return Object.freeze({ id: 'rrf', version: '1', async rank(_query: string, candidates: readonly LocalCandidate[]) {
        const unique = new Map<string, LocalCandidate>();
        for (const candidate of candidates) {
            const prior = unique.get(candidate.chunk.id);
            unique.set(candidate.chunk.id, { ...candidate, scores: { ...prior?.scores, ...candidate.scores } });
        }
        const lane = (key: 'semantic' | 'lexical') => [...unique.values()].filter(c => c.scores[key] !== undefined)
            .sort((a, b) => b.scores[key]! - a.scores[key]!).map(c => c.chunk.id);
        return fuseReciprocalRanks([lane('semantic'), lane('lexical')], k).map((row, index) => ({
            ...unique.get(row.id)!, scores: { ...unique.get(row.id)!.scores, fusion: row.score, rank: index + 1 },
        }));
    } });
}
