/**
 * The evidence trail, and the two rules the guarded engine asks for.
 *
 * The engine's synchronous `prepare` refuses a validator that returns a
 * Promise (only `prepareAsync` and `commit` await one). So two things are
 * pinned here rather than assumed: that every validator this module
 * supplies is synchronous, and that no refusal it produces ever carries an
 * empty `errors`.
 *
 * The other assertions are about what a refinement may reach. The ledger's
 * vocabulary cannot address inside a record and the skill schema carries no
 * evidence member, so the evidence trail is an appended MEMORY citing the
 * sealed decision — and the test that matters is that a pointer aimed
 * anywhere else is refused rather than quietly redirected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createGuardedRefiner } from '@jarenjs/core/guarded';
import { createLedger } from '@tangleai/context/ledger';
import { createStrategyRefiner, evidenceOperation, STRATEGY_EVIDENCE_PATH } from '@tangleai/evolve';

const AT = '2026-09-13T00:00:00.000Z';
const ledgerOf = () => createLedger({ now: () => AT });

const APPEND = {
  strategyId: 'S-partial-select',
  decisionRecordId: 'd'.repeat(64),
  decision: 'kept',
  reason: 'improved',
  experimentId: 'improve-partial-select',
};

async function withSkill() {
  const ledger = ledgerOf();
  await ledger.addSkill({
    id: 'skill-partial-select',
    name: 'Partial selection',
    when: 'a ranking sorts everything to read a few leading rows',
    instructions: 'Select the leading k directly instead of ordering the whole set.',
  });
  return ledger;
}

describe('appending a strategy’s evidence', () => {
  it('adds one memory citing the decision, and changes nothing else', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const skillsBefore = JSON.stringify(await ledger.listSkills());

    const appended = await refiner.appendEvidence(APPEND);
    assert.equal(appended.ok, true, JSON.stringify(appended));

    const memories = await ledger.listMemories();
    assert.equal(memories.length, 1, 'one memory carries the trail');
    assert.equal(memories[0].evidence, APPEND.decisionRecordId,
      'the citation IS the sealed decision record');
    assert.ok(memories[0].text.includes('S-partial-select'));
    assert.ok(memories[0].tags.includes('evolve-strategy-evidence'));

    assert.equal(JSON.stringify(await ledger.listSkills()), skillsBefore,
      'a skill is never edited by an evidence append');
  });

  it('never writes a confidence number onto any record', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    assert.equal((await refiner.appendEvidence(APPEND)).ok, true);

    for (const record of [...await ledger.listMemories(), ...await ledger.listSkills()]) {
      assert.equal(Object.hasOwn(record as object, 'confidence'), false,
        'confidence lives on the outcome carrier and moves only through the outcome service');
    }
  });

  it('commits against the snapshot it read, with no ledger conflict', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });

    // Twice in a row: the second read sees the first append and must still
    // commit, because `expected` is re-read each time in the ledger's own
    // key order rather than remembered from before.
    assert.equal((await refiner.appendEvidence(APPEND)).ok, true);
    const second = await refiner.appendEvidence({ ...APPEND, experimentId: 'noop-comment', decision: 'abandoned', reason: 'equal' });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal((await ledger.listMemories()).length, 2);
  });
});

describe('what a refinement may not reach', () => {
  it('refuses every pointer but the evidence target', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();
    const value = { text: 'a fact', evidence: 'd'.repeat(64) };

    for (const path of [
      '/skills/0/evidence/-',
      '/skills/0',
      '/skills/-',
      '/goal/progress/-',
      '/memories/0',
      '',
      '/memories',
    ]) {
      const refused = refiner.prepare(snapshot, [{ op: 'add', path, value }]);
      assert.equal(refused.valid, false, path + ' must be refused');
      assert.ok(refused.errors.length >= 1, 'a refusal always states a reason');
      assert.equal((refused.errors[0] as { code: string }).code, 'TEVO1011');
    }

    const accepted = refiner.prepare(snapshot, [{ op: 'add', path: STRATEGY_EVIDENCE_PATH, value }]);
    assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
  });

  it('refuses every verb but append', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();
    for (const op of ['replace', 'remove', 'move', 'copy', 'test']) {
      const refused = refiner.prepare(snapshot, [{ op, path: STRATEGY_EVIDENCE_PATH, value: { text: 'x', evidence: 'y' } }]);
      assert.equal(refused.valid, false, op + ' must be refused');
      assert.ok(refused.errors.length >= 1);
    }
  });

  it('refuses a proposal that tries to set a confidence', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();
    const refused = refiner.prepare(snapshot, [{
      op: 'add', path: STRATEGY_EVIDENCE_PATH,
      value: { text: 'a fact', evidence: 'd'.repeat(64), confidence: 0.99 },
    }]);
    assert.equal(refused.valid, false, 'refused, not stripped');
    assert.ok((refused.errors as Array<{ path: string }>).some(issue => issue.path.endsWith('/confidence')));
  });

  it('refuses an empty refinement and a non-array one', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();
    for (const proposal of [[], {}, null, 'patch']) {
      const refused = refiner.prepare(snapshot, proposal);
      assert.equal(refused.valid, false);
      assert.ok(refused.errors.length >= 1, 'never an empty refusal');
    }
  });

  it('refuses an append with nothing backing it', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();
    for (const value of [{ text: 'a fact' }, { evidence: 'd' }, { text: '', evidence: 'd' }, { text: 'a', evidence: '' }]) {
      const refused = refiner.prepare(snapshot, [{ op: 'add', path: STRATEGY_EVIDENCE_PATH, value }]);
      assert.equal(refused.valid, false, JSON.stringify(value) + ' must be refused');
      assert.ok(refused.errors.length >= 1);
    }
  });
});

describe('the engine’s two rules', () => {
  it('relies on an engine that names an asynchronous hook instead of refusing silently', async () => {
    let written = 0;
    const engine = createGuardedRefiner({
      read: async () => ({ n: 1 }),
      validateProposal: () => ({ valid: true, errors: [] }),
      apply: (document: { n: number }, by: number) => ({ n: document.n + by }),
      validateCandidate: async () => ({ valid: false, errors: [{ code: 'TEVO1011', docPath: '', message: 'the evaluator said no' }] }),
      planCommit: (next: unknown) => next,
      commit: async () => { written++; },
    });
    const sync = engine.prepare({ n: 1 }, 1);
    assert.equal(sync.valid, false);
    assert.match(String(sync.errors[0]?.message), /asynchronous hook/, 'the synchronous path says why');
    const awaited = await engine.prepareAsync({ n: 1 }, 1);
    assert.deepEqual(awaited.errors.map((one: { message: string }) => one.message), ['the evaluator said no']);
    const committed = await engine.commit(1);
    assert.equal(committed.ok, false);
    assert.equal(written, 0, 'an asynchronous refusal never reaches the writer');
  });

  it('supplies only synchronous validators', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();

    // If any validator returned a Promise the synchronous path would refuse
    // it, so a VALID proposal preparing cleanly is itself the proof that
    // none of them does.
    const prepared = refiner.prepare(snapshot, [evidenceOperation(APPEND)]);
    assert.equal(prepared.valid, true, JSON.stringify(prepared.errors));
    assert.ok(!(prepared as unknown as Promise<unknown>).then, 'prepare is synchronous');
  });

  it('never answers a refusal with an empty reason', async () => {
    const ledger = await withSkill();
    const refiner = createStrategyRefiner({ ledger: ledger as never, at: AT });
    const snapshot = await refiner.read();

    for (const proposal of [
      [],
      [{ op: 'replace', path: '/skills/0', value: {} }],
      [{ op: 'add', path: '/skills/0/evidence/-', value: 'x' }],
      [{ op: 'add', path: STRATEGY_EVIDENCE_PATH, value: null }],
      [{ op: 'add', path: STRATEGY_EVIDENCE_PATH }],
    ]) {
      const refused = refiner.prepare(snapshot, proposal);
      assert.equal(refused.valid, false);
      assert.ok(refused.errors.length >= 1,
        'every refusal states at least one reason');
      for (const issue of refused.errors as Array<{ code: string, detail: string }>) {
        assert.match(issue.code, /^TEVO10\d\d$/);
        assert.ok(issue.detail.length > 0, 'and every reason is stated');
      }
    }
  });
});
