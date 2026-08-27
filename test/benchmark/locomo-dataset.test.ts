/**
 * The dataset contract, pinned.
 *
 * These are not invented expectations — every number here was MEASURED
 * from the pinned `snap-research/locomo` submodule and is reproduced by
 * `npm run benchmark:locomo:census`. The test exists so that a submodule
 * that moves cannot silently change what a published LoCoMo row means:
 * if upstream re-releases the file, this suite goes red with the exact
 * quantity that changed, and the operator decides what to do about it
 * before any score is recompared.
 *
 * The whole suite degrades to a stated skip when the submodule is not
 * checked out, because a plain `git clone` does not fetch it and a
 * contributor who never runs the benchmark should not have a red gate.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIA_ID,
  INIT_COMMAND,
  dialogIdsOf,
  loadLocomo,
  orphanStamps,
  sessionInstant,
  sessionsOf,
} from '../../benchmark/lib/locomo.ts';

const dataset = await loadLocomo();
const missing = !dataset.available;
if (missing) {
  // eslint-disable-next-line no-console
  console.log(`# locomo dataset tests skipped — submodule absent. ${INIT_COMMAND}`);
}

describe('the LoCoMo session timestamp', () => {
  it('reads the one released format through the suite\'s date kernel', () => {
    assert.equal(sessionInstant('1:56 pm on 8 May, 2023'), Date.UTC(2023, 4, 8, 13, 56));
    assert.equal(sessionInstant('9:05 am on 3 December, 2022'), Date.UTC(2022, 11, 3, 9, 5));
  });

  it('refuses rather than guesses', () => {
    assert.equal(sessionInstant('sometime last May'), null);
    assert.equal(sessionInstant('1:56 pm on 31 February, 2023'), null);
    assert.equal(sessionInstant(''), null);
  });
});

describe('the pinned LoCoMo release', { skip: missing }, () => {
  const samples = dataset.available ? dataset.samples : [];

  it('validates against the committed schema', () => {
    assert.equal(dataset.available && dataset.valid, true,
      dataset.available && !dataset.valid ? dataset.errors.join('; ') : '');
  });

  it('holds ten conversations, 272 transcribed sessions and 5,882 turns', () => {
    assert.equal(samples.length, 10);
    const sessions = samples.flatMap(sessionsOf);
    assert.equal(sessions.length, 272);
    assert.equal(sessions.reduce((sum, s) => sum + s.turns.length, 0), 5882);
  });

  it('parses every session timestamp — 272 of 272', () => {
    const sessions = samples.flatMap(sessionsOf);
    assert.equal(sessions.filter((s) => s.at !== null).length, 272);
  });

  it('carries 1,986 questions of which 1,540 are scorable for parity', () => {
    const byCategory = new Map<number, number>();
    let missingAnswer = 0;
    for (const sample of samples) {
      for (const qa of sample.qa) {
        byCategory.set(qa.category, (byCategory.get(qa.category) ?? 0) + 1);
        if (qa.answer === undefined) missingAnswer++;
      }
    }
    assert.deepEqual([...byCategory.entries()].sort(([a], [b]) => a - b),
      [[1, 282], [2, 321], [3, 96], [4, 841], [5, 446]]);
    const scorable = [1, 2, 3, 4].reduce((sum, c) => sum + (byCategory.get(c) ?? 0), 0);
    assert.equal(scorable, 1540);
    // the reason category 5 is excluded, as a number rather than a claim
    assert.equal(missingAnswer, 444);
  });

  it('answers are strings except six integers the scorer must coerce', () => {
    const integers = samples.flatMap((s) => s.qa).filter((qa) => typeof qa.answer === 'number');
    assert.equal(integers.length, 6);
  });

  it('scopes dialog ids per sample — they repeat across conversations', () => {
    const perSample = samples.map(dialogIdsOf);
    const union = new Set(perSample.flatMap((ids) => [...ids]));
    const summed = perSample.reduce((sum, ids) => sum + ids.size, 0);
    assert.ok(union.size < summed,
      'dia_ids must collide across samples; if they no longer do, per-sample scoping can be revisited');
  });

  it('caps any evidence-recall metric at 2,806 of 2,815 ids', () => {
    let total = 0;
    let malformed = 0;
    let unresolved = 0;
    for (const sample of samples) {
      const ids = dialogIdsOf(sample);
      for (const qa of sample.qa) {
        for (const id of qa.evidence ?? []) {
          total++;
          if (!DIA_ID.test(id)) malformed++;
          if (!ids.has(id)) unresolved++;
        }
      }
    }
    assert.equal(total, 2815);
    assert.equal(malformed, 6);
    assert.equal(unresolved, 9);
  });

  it('pins the oracle ceiling an evidence-recall row must reproduce', () => {
    // The official evaluator's per-question `recall_acc`, averaged. Not a
    // global id ratio: a question with three evidence ids and one missing
    // scores 2/3, and a question with no evidence scores 1.
    const per = new Map<number, number[]>();
    for (const sample of samples) {
      const ids = dialogIdsOf(sample);
      for (const qa of sample.qa) {
        const evidence = qa.evidence ?? [];
        const value = evidence.length === 0
          ? 1
          : evidence.filter((id) => ids.has(id)).length / evidence.length;
        per.set(qa.category, [...(per.get(qa.category) ?? []), value]);
      }
    }
    const avg = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    const scorable = [1, 2, 3, 4].flatMap((c) => per.get(c) ?? []);
    assert.equal(scorable.length, 1540);
    assert.equal(avg(scorable).toFixed(4), '0.9961');
    assert.equal(avg(per.get(3) ?? []).toFixed(4), '0.9688',
      'open-domain has only 96 questions, so its ceiling is the most damaged');
    assert.notEqual(avg(scorable), 1, 'an oracle that scores 1.000 is resolving ids it should not reach');
  });

  it('reports conv-26\'s sixteen timestamped sessions that ship no transcript', () => {
    const orphans = new Map(samples.map((s) => [s.sample_id, orphanStamps(s)]));
    assert.deepEqual(orphans.get('conv-26'), [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35]);
    for (const [id, list] of orphans) {
      if (id !== 'conv-26') assert.deepEqual(list, [], `${id} gained orphan session stamps`);
    }
  });
});
