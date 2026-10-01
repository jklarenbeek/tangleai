import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createWebRanker } from '@tangleai/grounding';
it('web ranking combines discovery order with extracted-text lexical evidence without mutating inputs', async () => {
    const rows = [
        { id: 'first', url: 'https://official.example/first', title: 'General information', text: 'Opening hours.', searchRank: 1, scores: {} },
        { id: 'voucher', url: 'https://official.example/voucher', title: 'Voucher desk', text: 'Travel voucher desk location.', searchRank: 2, scores: {} },
    ];
    const before = structuredClone(rows), ranker = createWebRanker(), ranked = await ranker.rank('voucher desk', rows);
    assert.equal(ranker.id + '/' + ranker.version, 'web-rank/1'); assert.equal(ranked[0]!.id, 'voucher');
    assert.ok(ranked[0]!.scores.lexical! > 0); assert.ok(ranked.every(row => Number.isFinite(row.scores.fusion)));
    assert.deepEqual(rows, before); assert.deepEqual(await ranker.rank('voucher desk', rows), ranked);
    assert.deepEqual(await ranker.rank('nothing', []), []);
    await assert.rejects(ranker.rank('voucher', [rows[0]!, rows[0]!]));
});
