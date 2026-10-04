import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { verifyResearchDraft, renderResearchDraft, buildClaimLedger, writeResearchDraft, type ResearchClaim } from '@tangleai/research';
import { writingFixture, revisedWritingFixture } from './writing-fixtures.ts';
import { checked } from './fixtures.ts';
import type { ResearchReport, ResearchSentenceRegistration } from '../../benchmark/lib/research.types.ts';

it('verifies exact quotation identity and every complete registered mean without model authority', async () => {
  const f = await writingFixture(), result = checked(await verifyResearchDraft(f.input, f.ledger, f.draft));
  assert.equal(result.state, 'verified'); assert.equal(result.claims.length, 3);
  assert.ok(result.claims.every(row => row.status === 'supported' && row.issues.length === 0));
});
it('refuses a rehashed hallucinated citation, inflated causal claim and fabricated result sentence with their named codes', async () => {
  const f = await writingFixture();
  for (const [change, code] of [
    [(claims: ResearchClaim[]) => { claims[0].literatureIds = ['invented-source']; }, 'TRSH1003'],
    [(claims: ResearchClaim[]) => { claims[0].strength = 'causal'; }, 'TRSH1005'],
    [(claims: ResearchClaim[]) => { claims[1].metricBinding!.value += 1; claims[1].text = 'Invented result is 999.'; }, 'TRSH1002'],
    [(claims: ResearchClaim[]) => { claims[1].metricBinding!.unit = 'invented-unit'; }, 'TRSH1006'],
    [(claims: ResearchClaim[]) => { claims[1].metricBinding!.condition = 'invented-condition'; }, 'TRSH1006'],
    [(claims: ResearchClaim[]) => { claims[1].proof!.n = 1; }, 'TRSH1002'],
    [(claims: ResearchClaim[]) => { claims[0].proof!.citation!.rawHashes[0].sha256 = 'a'.repeat(64); }, 'TRSH1003'],
    [(claims: ResearchClaim[]) => { claims[0].proof!.quote = 'A statement absent from the card.'; }, 'TRSH1005'],
  ] as const) {
    const next = await revisedWritingFixture(f, change), result = checked(await verifyResearchDraft(f.input, next.ledger, next.draft));
    assert.equal(result.state, 'refused'); assert.equal(result.issues[0].code, code, JSON.stringify(result.issues));
    assert.ok(result.claims.some(claim => claim.status === 'unresolved'));
    assert.equal((await renderResearchDraft(f.input, next.ledger, next.draft)).valid, false);
  }
});
it('never selects one favorable seed as a rehashed aggregate headline', async () => {
  const f = await writingFixture(), next = await revisedWritingFixture(f, claims => {
    const claim = claims.find(claim => claim.kind === 'metric')!;
    claim.metricBinding!.seeds = claim.metricBinding!.seeds.slice(0, 1); claim.observationIds = claim.observationIds.slice(0, 1);
    claim.evidenceIds = claim.evidenceIds.slice(0, 1); claim.proof!.n = 1;
  });
  const result = checked(await verifyResearchDraft(f.input, next.ledger, next.draft));
  assert.equal(result.state, 'refused'); assert.ok(result.issues.some(issue => issue.code === 'TRSH1002'));
});
it('an unresolved open-section claim retains a visible marker and cannot become a supported sentence', async () => {
  const f = await writingFixture();
  const extra: ResearchClaim = { id: 'open-speculation', section: 'discussion', kind: 'interpretation', text: 'This conjecture remains unverified.',
    literatureIds: [], evidenceIds: [], observationIds: [], strength: 'descriptive', metricBinding: null };
  const ledger = checked(await buildClaimLedger(f.input, [...f.ledger.claims, extra]));
  const draft = checked(await writeResearchDraft(ledger, f.writer, { mode: 'template' }));
  const result = checked(await renderResearchDraft(f.input, ledger, draft));
  assert.equal(result.verification.state, 'verified');
  assert.equal(result.verification.claims.find(row => row.claimId === extra.id)!.status, 'unresolved');
  assert.ok(result.markdown.includes('⟦unresolved: open-speculation⟧'));
});
it('a paragraph cannot be inflated from supports to exact even when its quote bytes match', async () => {
  const f = await writingFixture(), next = await revisedWritingFixture(f, claims => { claims[0].proof!.strength = 'exact'; });
  const result = checked(await verifyResearchDraft(f.input, next.ledger, next.draft));
  assert.equal(result.state, 'refused'); assert.equal(result.claims[0].status, 'unresolved');
  assert.ok(result.claims[0].issues.some(issue => issue.path.endsWith('/strength')));
});
it('every registered topic sentence retains its expected support state against the exported native records', async () => {
  const report = JSON.parse(await readFile('benchmark/results/research.json', 'utf8')) as ResearchReport;
  const full = report.rows.find(row => row.id === 'gate-only-full');
  assert.ok(full?.state === 'measured' && full.scope === 'writing');
  for (const topic of full.topics) {
    const fixture = JSON.parse(await readFile('benchmark/fixtures/research/claims/' + topic.topicId + '.json', 'utf8')) as ResearchSentenceRegistration;
    const source = topic.bundle.source, result = checked(await verifyResearchDraft(source.inputs, source.ledger, source.draft));
    assert.equal(result.state, 'verified'); assert.equal(fixture.required.length, 4);
    for (const expected of fixture.required) {
      const claim = source.ledger.claims.find(claim => expected.observationCondition === null
        ? claim.proof?.quote?.includes(expected.text) : claim.metricBinding?.condition === expected.observationCondition);
      assert.ok(claim, expected.id);
      assert.equal(result.claims.find(row => row.claimId === claim.id)!.status, expected.expectedState, expected.id);
    }
    assert.equal(source.inputs.decision?.kind, 'Stop'); assert.equal(source.inputs.scope, 'stopped-run-audit');
  }
});
