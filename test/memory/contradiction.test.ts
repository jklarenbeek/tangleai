import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryUnitStore,
  planContradictionPairs,
  resolveContradictions,
  contradictionMessages,
  CONTRADICTION_VERDICT_SCHEMA,
} from '@tangleai/memory';
import type { MemoryUnit } from '@tangleai/core/schemas/memory';

const EARLY = '2026-08-24T10:00:00Z';
const LATE = '2026-08-24T12:00:00Z';
const NOW = '2026-08-24T13:00:00Z';
const now = () => NOW;

function unit(id: string, text: string, at: string, embedding: number[]): MemoryUnit {
  return { id, text, evidence: `evidence for ${id}`, tags: [id], at, kind: 'fact', embedding };
}

describe('planContradictionPairs', () => {
  it('selects only similar-enough live pairs, most similar first, capped', () => {
    const units = [
      unit('a', 'office is in Arnhem', EARLY, [1, 0, 0]),
      unit('b', 'office is in Nijmegen', LATE, [0.99, 0.01, 0]),
      unit('c', 'coffee is free', LATE, [0, 1, 0]),
      { ...unit('d', 'office is on Mars', LATE, [0.999, 0.001, 0]), supersededBy: 'b' },
    ];
    const pairs = planContradictionPairs(units, { maxPairs: 5 });
    assert.deepEqual(pairs.map((p) => [p.a.id, p.b.id]), [['a', 'b']]);
  });

  it('honours maxPairs', () => {
    const units = [
      unit('a', 'x', EARLY, [1, 0]),
      unit('b', 'y', LATE, [0.99, 0.01]),
      unit('c', 'z', LATE, [0.98, 0.02]),
    ];
    assert.equal(planContradictionPairs(units, { maxPairs: 1 }).length, 1);
  });
});

describe('resolveContradictions', () => {
  it('supersedes the OLDER record and writes an evidenced resolution', async () => {
    const store = createMemoryUnitStore();
    const older = unit('a', 'office is in Arnhem', EARLY, [1, 0]);
    const newer = unit('b', 'office is in Nijmegen', LATE, [0.99, 0.01]);
    await store.put(older);
    await store.put(newer);

    const outcome = await resolveContradictions(store, planContradictionPairs([older, newer]), {
      judge: async () => ({ contradiction: true, reason: 'the office moved', resolution: 'the office is in Nijmegen since August' }),
      now,
    });

    assert.equal(outcome.contradictions, 1);
    const loser = await store.get('a');
    assert.equal(loser?.supersededBy, 'b');
    assert.equal(loser?.supersededAt, NOW);
    assert.equal(loser?.supersededReason, 'the office moved');
    // the winner is untouched
    assert.equal((await store.get('b'))?.supersededBy, undefined);

    assert.equal(outcome.resolutions.length, 1);
    const resolution = outcome.resolutions[0];
    assert.equal(resolution.kind, 'summary');
    assert.equal(resolution.text, 'the office is in Nijmegen since August');
    assert.ok(resolution.evidence.includes('a') && resolution.evidence.includes('b'));
    assert.ok(resolution.tags.includes('resolution'));
    assert.ok(await store.get(resolution.id));
  });

  it('a resolution equal to the winner text creates NO new record — the winner stands', async () => {
    const store = createMemoryUnitStore();
    const older = unit('a', 'limit is 100', EARLY, [1, 0]);
    const newer = unit('b', 'limit is 500', LATE, [0.99, 0.01]);
    await store.put(older);
    await store.put(newer);

    const outcome = await resolveContradictions(store, planContradictionPairs([older, newer]), {
      judge: async () => ({ contradiction: true, reason: 'figures differ', resolution: 'limit is 500' }),
      now,
    });

    assert.equal(outcome.contradictions, 1);
    assert.equal(outcome.resolutions.length, 0);
    // the winner keeps its embedding — it was not overwritten by an
    // un-embedded summary with the same content-addressed id
    const winner = await store.get('b');
    assert.deepEqual(winner?.embedding, [0.99, 0.01]);
    assert.equal(winner?.kind, 'fact');
    assert.equal((await store.get('a'))?.supersededBy, 'b');
  });

  it('a judge that says no changes nothing; a judge that throws skips the pair', async () => {
    const store = createMemoryUnitStore();
    const a = unit('a', 'x', EARLY, [1, 0]);
    const b = unit('b', 'y', LATE, [0.99, 0.01]);
    await store.put(a);
    await store.put(b);
    const pairs = planContradictionPairs([a, b]);

    const noVerdict = await resolveContradictions(store, pairs, {
      judge: async () => ({ contradiction: false }), now,
    });
    assert.equal(noVerdict.contradictions, 0);
    assert.equal(noVerdict.judged, 1);

    const thrown = await resolveContradictions(store, pairs, {
      judge: async () => { throw new Error('provider down'); }, now,
    });
    assert.equal(thrown.contradictions, 0);
    assert.equal(thrown.judged, 0);
  });
});

describe('judge contract', () => {
  it('messages cite both records with their evidence', () => {
    const messages = contradictionMessages(
      unit('a', 'sky is blue', EARLY, [1]),
      unit('b', 'sky is green', LATE, [1]),
    );
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[1].content.includes('sky is blue'));
    assert.ok(messages[1].content.includes('evidence for b'));
  });
  it('the verdict schema requires the boolean and forbids extras', () => {
    assert.deepEqual(CONTRADICTION_VERDICT_SCHEMA.required, ['contradiction']);
    assert.equal(CONTRADICTION_VERDICT_SCHEMA.additionalProperties, false);
  });
});
