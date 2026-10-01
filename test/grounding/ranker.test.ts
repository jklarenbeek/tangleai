import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRrfRanker, type LocalCandidate } from '@tangleai/grounding';
import { localCorpus } from '../fixtures/grounding/local-corpus.ts';
it('deduplicates a child while preserving both lane scores and exact fused rank', async () => {
    const f = await localCorpus();
    try {
        const bundle = await f.staged(), chunk = bundle.chunks[0], parent = bundle.parents!.find(p => p.id === chunk.parentChunkId)!;
        const base = { chunk, parent, source: bundle.source };
        const candidates: LocalCandidate[] = [{ ...base, scores: { semantic: 0.9 } }, { ...base, scores: { lexical: 4 } }];
        const result = await createRrfRanker().rank('archive', candidates);
        assert.equal(result.length, 1); assert.deepEqual(result[0].scores, { semantic: 0.9, lexical: 4, fusion: 2 / 61, rank: 1 });
        assert.deepEqual(result[0].chunk, chunk); assert.deepEqual(candidates[0].scores, { semantic: 0.9 });
        assert.throws(() => createRrfRanker(-1), /positive/);
    } finally { await f.db.close(); }
});
