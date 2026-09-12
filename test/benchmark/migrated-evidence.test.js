import { it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
const loadBench=name=>JSON.parse(readFileSync(new URL((name === 'long-horizon' ? '../../benchmark/jaren-long-horizon.json' : '../../benchmark/historical/'+name+'.json'),import.meta.url),'utf8'));
it('derives the retrieval suite, with the oracle proof and the synthetic-corpus note in view', function () {
    const data = loadBench('retrieval');
    const text = JSON.stringify(data);
    assert.match(text, /oracle \(gold first\)/, 'the oracle row renders — it is the scorer\'s proof');
    assert.match(text, /tag\+recency/, 'the incumbent renders');
    assert.match(text, /near \(hash-trigram-64, ranked\)/, 'the ranked row renders beside it, whichever way it fell');
    assert.match(text, /random floor \(analytic\)/, 'the floor renders beside the seeded draw');
    // the page says what the numbers are and are not: a mechanism over a
    // synthetic corpus, never a claim about a model understanding language
    assert.match(text, /synthetic/, 'the headline says the corpus is synthetic');
    assert.match(text, /not whether a model understands language/);
    assert.strictEqual(data.tables.length, data.meta.sizes.length, 'one table per corpus size');
    // and the published rows carry the contract every later measurement
    // states its delta against: the oracle is 1.0 at every size, and
    // every policy is one of the five plus the analytic floor
    for (const size of data.meta.sizes) {
      const oracle = data.rows.find((r) => r.size === size && r.policy === 'oracle');
      assert.ok(oracle !== undefined);
      assert.deepStrictEqual([oracle.recallAt1, oracle.recallAt5, oracle.recallAt10, oracle.mrr], [1, 1, 1, 1]);
      for (const key of ['random', 'recency', 'tag+recency', 'near', 'floor'])
        assert.ok(data.rows.some((r) => r.size === size && r.policy === key), `${key} row at ${size}`);
    }
    // the tracked file is generated without --live: the ranked row's
    // identity is the deterministic reference embedder, and no model
    assert.deepStrictEqual(data.meta.ranked, { model: 'hash-trigram-64', dims: 64 });
    assert.strictEqual(data.meta.live, undefined, 'the tracked file never carries a live row');
    assert.ok(!data.rows.some((r) => r.policy === 'near-live'));
  });
it('derives the long-horizon suite, keeping both tasks and both shapes', function () {
    const data = loadBench('long-horizon');
    const text = JSON.stringify(data);
    // D7: both tasks and both numbers. A page that showed only the needle
    // would hide the finding the whole measurement exists to state.
    assert.match(text, /Pairwise ceiling/, 'the pairwise column may not be dropped');
    assert.match(text, /Needle ceiling/);
    assert.match(text, /FRONT of the tool result/, 'the flattering payload shape is labelled');
    assert.match(text, /BEHIND the padding/, 'the realistic payload shape renders beside it');
    assert.match(text, /DETERMINACY/,
      'the page says what the pairwise ceiling is, since it is not a hard bound on the score');
    // and the underlying rows carry the contract every later measurement
    // states its delta against
    assert.ok(data.rows.length > 0);
    for (const row of data.rows) {
      assert.ok(['needle', 'pairwise'].includes(row.task));
      assert.ok(['front', 'late'].includes(row.shape));
      assert.strictEqual(typeof row.ceiling, 'number');
      assert.ok(row.actual === null || typeof row.actual === 'number');
      // NOT asserted: actual <= ceiling. The needle ceiling is a hard
      // bound but its actual is a small-sample estimate, and the pairwise
      // ceiling is determinacy — a model can name the right pair out of a
      // surviving subset. `pairSurvived` is what makes such a row legible,
      // so it has to be in the published data.
      assert.strictEqual(typeof row.pairSurvived, 'boolean');
    }
    // The pairwise ceiling is 0 at every budget that compacts anything —
    // published rather than smoothed, because it is the number the whole
    // measurement exists to state. The one legal exception is a row where
    // the cut happened to leave EVERY value in place: the context then
    // determines the answer, and the ceiling says so. That is the payload
    // shape being generous, not a relation being recovered, so it is
    // asserted as exactly that condition rather than waved through —
    // a row with a missing value and a non-zero pairwise ceiling would be
    // a broken measurement.
    const compacting = data.rows.filter((r) => r.task === 'pairwise' && r.compacted);
    assert.ok(compacting.length > 0);
    for (const row of compacting) {
      assert.strictEqual(row.ceiling, row.valuePresent === row.n ? 1 : 0,
        `${row.variant}/${row.shape}@${row.budget}: a pairwise ceiling is determinacy — it may `
        + 'only be non-zero where every value survived the cut');
    }
    assert.ok(compacting.some((r) => r.ceiling === 0),
      'a run where compaction never cost the pairwise answer is not measuring compaction');
  });
