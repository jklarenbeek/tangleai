/**
 * The recall instrument, pinned.
 *
 * Three layers. The scorer and the corpus builder are tested on hand
 * cases that need no dataset — the official `recall_acc` arithmetic,
 * the k-dependent oracle ceiling, the hypergeometric band, the seeded
 * draw, the address parser. Then, with the submodule present, the
 * committed report is asserted to be EXACTLY what a fresh run produces
 * (determinism and reproducibility in one assertion — a published number
 * whose command no longer reproduces it is not a published number), the
 * gate rows are pinned to the census ceiling, and one knob is turned to
 * prove the number moves. Everything dataset-bound degrades to a stated
 * skip without the submodule.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { JarenValidator } from '@jarenjs/validate';

import { INIT_COMMAND, loadLocomo } from '../../benchmark/lib/locomo.ts';
import { addressOf, addressesOf, conversationCorpus, turnText } from '../../benchmark/lib/locomo-corpus.ts';
import {
  evidenceRecall,
  oracleCeiling,
  oracleCeilingOf,
  randomBand,
  randomExpectationOf,
  type GoldQuestion,
} from '../../benchmark/lib/recall.ts';
import { drawDistinct, mulberry32 } from '@jarenjs/core/random';
import {
  KS,
  POLICIES_OFF,
  RANDOM_SEED,
  gateFailures,
  renderMarkdown,
  runLocomoRecall,
  type RecallReport,
} from '../../benchmark/lib/locomo-recall.ts';
import SCHEMA from '../../benchmark/schemas/locomo-recall.schema.json' with { type: 'json' };
import RUN_IDENTITY_SCHEMA from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };

const REPORT_PATH = 'benchmark/results/locomo-recall.json';
const DOC_PATH = 'docs/LOCOMO_RECALL.md';

const dataset = await loadLocomo();
const missing = !dataset.available;
if (missing) {
  // eslint-disable-next-line no-console
  console.log(`# locomo recall tests skipped — submodule absent. ${INIT_COMMAND}`);
}

// ---------------------------------------------------------------------------
// the scorer, on hand cases
// ---------------------------------------------------------------------------

describe('evidenceRecall — the official recall_acc', () => {
  it('is the fraction of gold present, and 1 for a question citing nothing', () => {
    assert.equal(evidenceRecall(['a', 'b', 'c'], new Set(['a', 'c', 'z'])), 2 / 3);
    assert.equal(evidenceRecall(['a'], new Set()), 0);
    assert.equal(evidenceRecall([], new Set()), 1, 'evaluation.py appends 1 when len(evidence) == 0');
  });

  it('counts a duplicated gold id as many times as the release lists it', () => {
    // the official loop is `sum(ev in context for ev in evidence) / len(evidence)`
    assert.equal(evidenceRecall(['a', 'a'], new Set(['a'])), 1);
    assert.equal(evidenceRecall(['a', 'a', 'b'], new Set(['a'])), 2 / 3);
  });
});

describe('the analytic rows', () => {
  const q = (gold: number, resolvable: number, universe = 100, category = 4): GoldQuestion => ({
    category, gold: Array.from({ length: gold }, (_, i) => `x/D1:${i}`), resolvable, universe,
  });

  it('caps the oracle at k when a question cites more turns than k', () => {
    assert.equal(oracleCeilingOf(q(19, 19), 5), 5 / 19);
    assert.equal(oracleCeilingOf(q(19, 19), 20), 1);
    assert.equal(oracleCeilingOf(q(3, 2), 20), 2 / 3, 'an unresolvable id can never be retrieved');
    assert.equal(oracleCeilingOf(q(0, 0), 5), 1);
    assert.equal(oracleCeiling([q(2, 2), q(2, 1)], 10), 0.75);
  });

  it('expects k/N per resolvable gold turn of a uniform draw', () => {
    assert.equal(randomExpectationOf(q(2, 2, 100), 5), 0.05);
    assert.equal(randomExpectationOf(q(2, 1, 100), 5), 0.025);
    assert.equal(randomExpectationOf(q(0, 0, 100), 5), 1);
    assert.equal(randomExpectationOf(q(1, 1, 3), 5), 1, 'k is clipped to the corpus');
  });

  it('builds a band around the floor that a broken draw falls out of', () => {
    const questions = Array.from({ length: 200 }, () => q(1, 1, 500));
    const band = randomBand(questions, 10);
    assert.ok(Math.abs(band.floor - 0.02) < 1e-12, `floor ${band.floor}`);
    assert.ok(band.low < band.floor && band.floor < band.high);
    assert.ok(band.high < 0.1, 'a row at 0.1 over a 500-turn corpus at k=10 is not random');
  });
});

describe('the seeded draw', () => {
  it('is repeatable and distinct', () => {
    const a = drawDistinct(mulberry32(7), 50, 10);
    const b = drawDistinct(mulberry32(7), 50, 10);
    assert.deepEqual(a, b);
    assert.equal(new Set(a).size, 10);
    assert.ok(a.every((i) => i >= 0 && i < 50));
    assert.notDeepEqual(drawDistinct(mulberry32(8), 50, 10), a);
  });

  it('cannot draw more than the corpus holds', () => {
    assert.deepEqual([...drawDistinct(mulberry32(1), 3, 10)].sort(), [0, 1, 2]);
  });
});

describe('the corpus builder', () => {
  it('scopes addresses by sample and reads them back out of a joined evidence field', () => {
    assert.equal(addressOf('conv-26', 'D1:3'), 'conv-26/D1:3');
    assert.deepEqual(addressesOf('conv-26/D1:3', 'conv-26'), ['conv-26/D1:3']);
    assert.deepEqual(addressesOf('conv-26/D1:3; conv-26/D4:12', 'conv-26'), ['conv-26/D1:3', 'conv-26/D4:12'],
      'a crystallized survivor cites its own turn first, then the absorbed one');
    assert.deepEqual(addressesOf('conv-26/D1:3; conv-30/D1:3', 'conv-26'), ['conv-26/D1:3'],
      'a foreign address is never credited');
    assert.deepEqual(addressesOf('contradiction resolution of m-a by m-b: same subject', 'conv-26'), [],
      'a resolution record cites memory ids, not turns');
  });

  it('appends an image caption and counts it', () => {
    assert.equal(turnText({ speaker: 'A', dia_id: 'D1:1', text: 'Look!' }), 'Look!');
    assert.equal(turnText({ speaker: 'A', dia_id: 'D1:1', text: 'Look!', img_url: 'x', blip_caption: 'a dog' }), 'Look! [image: a dog]');
  });

  it('refuses a session whose stamp does not parse rather than inventing an instant', () => {
    const corpus = conversationCorpus({
      sample_id: 's',
      conversation: {
        speaker_a: 'A', speaker_b: 'B',
        session_1_date_time: '1:56 pm on 8 May, 2023',
        session_1: [{ speaker: 'A', dia_id: 'D1:1', text: 'hello' }, { speaker: 'B', dia_id: 'D1:2', text: 'hello' }],
        session_2_date_time: 'sometime in May',
        session_2: [{ speaker: 'A', dia_id: 'D2:1', text: 'later' }],
      },
      qa: [],
    });
    assert.equal(corpus.refused, 1);
    assert.equal(corpus.turns.length, 2);
    assert.equal(corpus.collapsed, 1, 'two identical texts share one content-addressed id');
    assert.deepEqual(corpus.sessions[0].inputs[0], {
      text: 'hello', evidence: 's/D1:1', tags: ['A', 'session:1'], at: '2023-05-08T13:56:00.000Z', kind: 'event',
    });
    assert.equal(corpus.lastAt, Date.UTC(2023, 4, 8, 13, 56));
  });
});

// ---------------------------------------------------------------------------
// the instrument, over the pinned release
// ---------------------------------------------------------------------------

describe('the LoCoMo evidence-recall instrument', { skip: missing }, () => {
  const available = dataset.available ? dataset : null;
  const validator = new JarenValidator({ skipErrors: false, collectErrors: true, unknownFormats: 'ignore' });
  validator.addSchema(RUN_IDENTITY_SCHEMA as Record<string, unknown>);
  const validate = validator.compile(SCHEMA as Record<string, unknown>);

  it('reproduces the committed report byte for byte, and the doc from it', async () => {
    const report = await runLocomoRecall(available!);
    const fresh = `${JSON.stringify(report, null, 2)}\n`;
    const committed = await readFile(REPORT_PATH, 'utf8');
    assert.equal(fresh, committed,
      `${REPORT_PATH} is not what a run produces; regenerate it with npm run benchmark:locomo:recall -- --json ${REPORT_PATH} --md ${DOC_PATH}`);
    assert.equal(`${renderMarkdown(report)}\n`, await readFile(DOC_PATH, 'utf8'), `${DOC_PATH} is stale`);
    assert.equal(validate(report).valid, true, 'the report validates against its committed schema');
  });

  it('pins the gate to the census ceiling', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as RecallReport;
    assert.deepEqual(report.gate, { passed: true, failures: [] });
    assert.deepEqual(gateFailures(report), []);
    assert.deepEqual(report.config.ks, [...KS]);
    assert.equal(report.config.seed, RANDOM_SEED);
    assert.equal(report.questions.scorable, 1540);
    assert.equal(report.questions.excluded.count, 446);
    assert.equal(report.corpus.turns, 5882);
    assert.equal(report.corpus.sessions, 272);
    assert.equal(report.corpus.refusedSessions, 0);
    assert.equal(report.corpus.collapsed, 5, 'five identical turns within a conversation share one id');

    const oracle = report.rows.find((r) => r.key === 'oracle')!;
    // 02a's number, reached only where k covers the longest evidence list (19)
    assert.equal(oracle.recall['20'].overall.toFixed(4), '0.9961');
    assert.equal(oracle.recall['20'].byCategory['1']!.toFixed(3), '0.994');
    assert.equal(oracle.recall['20'].byCategory['2']!.toFixed(3), '0.997');
    assert.equal(oracle.recall['20'].byCategory['3']!.toFixed(4), '0.9688');
    // the census prints 1.000 for single-hop at three decimals; it is not 1
    assert.equal(oracle.recall['20'].byCategory['4']!.toFixed(4), '0.9996');
    assert.notEqual(oracle.recall['20'].byCategory['4'], 1);
    assert.ok(oracle.recall['5'].overall < oracle.recall['10'].overall,
      'the ceiling is k-dependent: a question may cite up to 19 turns');
    for (const k of KS) {
      assert.equal(oracle.recall[String(k)].overall, report.ceiling[String(k)].overall, `oracle@${k} equals its ceiling exactly`);
      assert.notEqual(oracle.recall[String(k)].overall, 1, 'an oracle at 1.000 is a global dia_id lookup');
    }

    const random = report.rows.find((r) => r.key === 'random')!;
    for (const k of KS) {
      const band = report.floor[String(k)];
      const value = random.recall[String(k)].overall;
      assert.ok(value >= band.low && value <= band.high, `random@${k} ${value} in [${band.low}, ${band.high}]`);
    }
  });

  it('runs every policy and reports what each did, against a baseline where none did anything', async () => {
    const report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as RecallReport;
    const raw = report.rows.find((r) => r.key === 'near-raw')!;
    const near = report.rows.find((r) => r.key === 'near')!;
    assert.deepEqual(raw.thresholds, POLICIES_OFF);
    assert.equal(raw.ingest!.runs, 272, 'one pipeline.run per session');
    assert.equal(raw.ingest!.observations, 5882);
    assert.equal(raw.ingest!.filtered + raw.ingest!.contradictions + raw.ingest!.merged, 0);
    assert.equal(raw.ingest!.total, 5882 - report.corpus.collapsed);
    assert.ok(near.ingest!.filtered + near.ingest!.contradictions + near.ingest!.merged > 0,
      'the shipped defaults change the corpus, and the census says how');
    assert.equal(near.ingest!.total - near.ingest!.live, near.ingest!.superseded);
    // the difference between the two rows is what the policies cost or bought — and it is published either way
    assert.notEqual(near.recall['20'].overall, raw.recall['20'].overall);
  });

  it('is byte-identical across two runs of the same dataset and options', async () => {
    const options = { samples: ['conv-26', 'conv-30'] };
    const a = await runLocomoRecall(available!, options);
    const b = await runLocomoRecall(available!, options);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.deepEqual(a.dataset.restricted, ['conv-26', 'conv-30']);
    assert.equal(a.gate.passed, true);
    assert.equal(validate(a).valid, true);
  });

  it('a category with no questions in a restricted run is absent, not zero', async () => {
    const report = await runLocomoRecall(available!, { samples: ['conv-30'] });
    assert.equal(report.questions.byCategory['3'], 0);
    for (const row of report.rows) assert.equal(row.recall['20'].byCategory['3'], null, row.key);
    assert.equal(validate(report).valid, true);
    assert.match(renderMarkdown(report), /\| —/, 'the rendering shows an em dash');
  });

  it('a knob turns and the number moves, keylessly', async () => {
    const at64 = await runLocomoRecall(available!, { samples: ['conv-30'] });
    const at128 = await runLocomoRecall(available!, { samples: ['conv-30'], dims: 128 });
    assert.equal(at128.config.embedder.model, 'hash-trigram-128');
    const near64 = at64.rows.find((r) => r.key === 'near-raw')!.recall['20'].overall;
    const near128 = at128.rows.find((r) => r.key === 'near-raw')!.recall['20'].overall;
    assert.notEqual(near64, near128, 'the embedder width is a knob the ranked row feels');
    // the gate rows do not depend on the embedder at all
    assert.deepEqual(at64.rows.find((r) => r.key === 'oracle'), at128.rows.find((r) => r.key === 'oracle'));
  });

  it('refuses a sample id the release does not hold', async () => {
    await assert.rejects(() => runLocomoRecall(available!, { samples: ['conv-99'] }), /no sample 'conv-99'/);
  });
});
