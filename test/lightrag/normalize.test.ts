import { it } from 'node:test';
import assert from 'node:assert/strict';
import { foldEntityName, foldThemes } from '../../packages/lightrag/src/normalize.ts';
it('entity names fold compatibility characters, case and Unicode whitespace deterministically', () => {
    for (const [input, expected] of [[' ＣＥＤＡＲ\u00a0 Workshop  ', 'cedar workshop'], ['Oﬃce', 'office'], ['A\t B\nC', 'a b c'], ['  ', ''], ['İ', 'i\u0307']]) {
        assert.equal(foldEntityName(input), expected); assert.equal(foldEntityName(foldEntityName(input)), expected);
    }
    assert.notEqual(foldEntityName('Cedar Workshop'), foldEntityName('Cedar Works'));
});
it('relation themes use that same fold, omit blanks, deduplicate and sort', () => {
    assert.deepEqual(foldThemes(['Training', ' EQUIPMENT ', 'ＴＲＡＩＮＩＮＧ', '']), ['equipment', 'training']);
});
