import { it } from 'node:test';
import assert from 'node:assert/strict';
import { lexicalTerms, lexicalTermCounts, createLexicalIndex, fuseReciprocalRanks } from '@tangleai/core/lexical';
import { fuseConsolidationRanks } from '@tangleai/memory/consolidation';
it('normalizes Unicode terms once and counts repeated terms', () => {
    assert.deepEqual(lexicalTerms('CAFÉ cafe\u0301 １２３'), ['café', 'café', '123']);
    assert.deepEqual([...lexicalTermCounts('CAFÉ cafe\u0301 １２３')], [['café', 2], ['123', 1]]);
});
it('retains bounded suite scoring, query deduplication, source order and generation identity', () => {
    const index = createLexicalIndex([{ id: 'a', text: 'cat' }, { id: 'b', text: 'dog' }], { generation: 4, sourceRevision: 'version-set' });
    assert.deepEqual(index.rank('cat cat'), [{ id: 'a', score: 1.5 * Math.log(2) }]);
    assert.deepEqual(index.rank('unseen'), []);
    assert.equal(index.generation, 4); assert.equal(index.sourceRevision, 'version-set');
    assert.deepEqual(createLexicalIndex([{ id: 'z', text: 'cat' }, { id: 'a', text: 'cat' }]).rank('cat').map(r => r.id), ['z', 'a']);
    assert.throws(() => createLexicalIndex([{ id: 'a', text: 'cat' }], { limits: { maxQueryBytes: 2 } }).rank('cat'), RangeError);
    assert.throws(() => createLexicalIndex([{ id: 'a', text: 'cat' }], { limits: { maxFieldBytes: 2 } }), RangeError);
    assert.throws(() => createLexicalIndex([{ id: 'a', text: 'cat' }, { id: 'a', text: 'dog' }]), /Duplicate/);
});
it('fuses one vote per lane with exact scores and explicit compatible tie order', () => {
    const expected = 1 / 61 + 1 / 62;
    assert.deepEqual(fuseReciprocalRanks([['b', 'b', 'a'], ['a', 'b']]), [{ id: 'b', score: expected, order: 0 }, { id: 'a', score: expected, order: 1 }]);
    assert.deepEqual(fuseConsolidationRanks([['b', 'b', 'a'], ['a', 'b']]), ['a', 'b']);
    assert.deepEqual(fuseConsolidationRanks([['c'], ['b']]), ['b', 'c']);
    assert.deepEqual(fuseReciprocalRanks([[], []]), []);
    assert.throws(() => fuseReciprocalRanks([['a']], 0), /positive/);
});
