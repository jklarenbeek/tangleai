/**
 * The close-out's contract: the mechanical decision flips to
 * retain-current when any registered clause fails, the schema refuses a
 * forged adoption or a stale decision, the committed handoff is exactly
 * what the verbatim query produces, every identity it names resolves to
 * exactly one object in its source report, and a modified query or a
 * drifted fixture/source byte goes red.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { compileJsonQuery } from '@jarenjs/json/query';

import { createGroundingValidator, decideGrounding, loadGroundingFixture } from '../../benchmark/lib/grounding.ts';
import { liveReportIdOf } from '../../benchmark/lib/grounding-run.ts';
import type { GroundingHandoff, GroundingLive, GroundingWeb } from '../../benchmark/lib/grounding.types.ts';

const validate = createGroundingValidator();
const live = JSON.parse(await readFile('benchmark/results/grounding-live.json', 'utf8')) as GroundingLive;
const web = JSON.parse(await readFile('benchmark/results/grounding-web-live.json', 'utf8')) as GroundingWeb;
const handoff = JSON.parse(await readFile('benchmark/results/grounding-handoff.json', 'utf8')) as GroundingHandoff;
const queryBytes = await readFile('queries/grounding/flat-baseline.json', 'utf8');

describe('the mechanical decision', () => {
  it('adopts on the recorded report — every clause passes and is published', () => {
    const decision = decideGrounding(live);
    assert.equal(decision.state, 'adopt-claim-citations');
    assert.equal(decision.clauses.length, 4);
    assert.ok(decision.clauses.every((clause) => clause.passed));
    assert.equal(decision.liveReportId, live.reportId);
    assert.deepEqual(live.decision, decision, 'the stored attempt carries exactly the recomputed decision');
  });

  it('returns retain-current, naming the clause, when any one clause is flipped', () => {
    const flips: Array<[string, (doc: GroundingLive) => void]> = [
      ['eligible-pair', (doc) => {
        doc.strata[0].pairing.eligible = false;
        doc.strata[0].pairing.reasons.push({ code: 'wire-failure', detail: 'flipped' });
      }],
      ['citation-outcomes', (doc) => {
        doc.strata[0].rows.find((row) => row.key === 'grounded-answer')!.citations!.byOutcome.unknownEvidence += 1;
      }],
      ['claim-delta', (doc) => {
        doc.strata[0].pairing.comparisons.find((comparison) => comparison.metric === 'supported-claim-f1')!.interval.low = 0;
      }],
      ['answer-floor', (doc) => {
        doc.strata[0].pairing.comparisons.find((comparison) => comparison.metric === 'answer-f1')!.oneSidedLowerBound = -0.051;
      }],
    ];
    for (const [clause, flip] of flips) {
      const doc = structuredClone(live);
      flip(doc);
      const decision = decideGrounding(doc);
      assert.equal(decision.state, 'retain-current', clause);
      assert.equal(decision.clauses.find((entry) => entry.clause === clause)?.passed, false, clause);
    }
  });

  it('never reads a missing or ineligible live row as a pass', () => {
    const doc = structuredClone(live);
    doc.strata = doc.strata.filter((stratum) => stratum.key !== 'fixture');
    const decision = decideGrounding(doc);
    assert.equal(decision.state, 'retain-current');
    assert.ok(decision.clauses.every((clause) => !clause.passed || clause.clause === 'citation-outcomes'));
  });

  it('the schema refuses a forged adoption and a decision naming a stale report', () => {
    assert.ok(validate(live).valid);
    const forged = structuredClone(live);
    forged.strata[0].pairing.comparisons.find((comparison) => comparison.metric === 'supported-claim-f1')!.interval.low = -0.2;
    assert.ok(!validate(forged).valid, 'an adoption whose own rows no longer support it is refused');
    const stale = structuredClone(live);
    (stale.decision as { liveReportId: string }).liveReportId = 'f'.repeat(64);
    assert.ok(!validate(stale).valid, 'a decision pointing at another report is refused');
  });
});

describe('the committed handoff', () => {
  it('is exactly what the verbatim query produces over the stored reports', async () => {
    const { $comment: _comment, ...query } = JSON.parse(queryBytes) as Record<string, unknown>;
    const run = compileJsonQuery(query as Record<string, unknown>) as (input: unknown) => unknown;
    assert.deepEqual(run({ live, web }), handoff.handoff);
    assert.ok(validate(handoff).valid);
  });

  it('pins the query bytes — a modified query is refused', () => {
    assert.equal(handoff.querySha256, createHash('sha256').update(queryBytes).digest('hex'));
  });

  it('resolves every identity to exactly one object in its source report', () => {
    const ids = handoff.handoff.identities;
    assert.equal(ids.reportId, live.reportId);
    assert.equal(ids.registrationId, live.registration.registrationId);
    assert.equal(ids.fixtureId, live.registration.fixtureId);
    assert.equal(ids.planId, live.plan.planId);
    assert.equal(ids.sourceSha256, live.source.sha256);
    const identities = (live.configIdentities as { identities: Array<{ identityId: string }> }).identities
      .filter((identity) => identity.identityId === ids.configIdentityId);
    assert.equal(identities.length, 1, 'the config identity resolves exactly once');
    const fixtureRows = live.strata.find((stratum) => stratum.key === 'fixture')!.rows;
    for (const row of handoff.handoff.rows) {
      const source = fixtureRows.filter((entry) => entry.key === row.key);
      assert.equal(source.length, 1);
      assert.equal(source[0].questionSet, row.questionSet);
    }
    assert.equal(handoff.handoff.diagnostics.web.reportId, web.reportId);
    assert.equal(handoff.handoff.diagnostics.web.notRun, web.notRun);
    assert.ok(handoff.handoff.decision.state !== 'not-evaluated');
    assert.equal(handoff.handoff.decision.liveReportId, live.reportId);
  });
});

describe('drift pins', () => {
  it('the live attempt reproduces its identity, and the fixture bytes still match its recorded source manifest', async () => {
    assert.equal(await liveReportIdOf(live), live.reportId);
    const loaded = await loadGroundingFixture();
    assert.equal(loaded.source.sha256, live.source.sha256, 'a changed fixture or source byte cannot keep the recorded manifest');
    assert.equal(loaded.fixtureId, live.registration.fixtureId);
  });

  it('the flat treatment values cannot move silently', () => {
    assert.deepEqual(live.registration.retrieval, {
      chunkerVersion: 'heading-recursive/1',
      maxTokens: 450,
      overlapTokens: 48,
      k: 6,
      minScore: 0,
      maxPerSource: 2,
      neighbours: 1,
    });
    assert.equal(live.registration.maxRepairs, 1);
    assert.equal(live.registration.seed, 17753);
  });
});
