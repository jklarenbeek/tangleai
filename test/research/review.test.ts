import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResearchReviews, researchRevisionOf, researchArtifactIdOf, type ResearchReviewProposal } from '@tangleai/research';
import { writingFixture } from './writing-fixtures.ts';
import { checked, hash } from './fixtures.ts';

async function fixture() {
  const f = await writingFixture(), evidence = [{ id: f.ledger.id, digest: await researchRevisionOf(f.ledger), text: 'Admitted claim ledger.' },
    { id: f.draft.id, digest: await researchRevisionOf(f.draft), text: 'Admitted draft.' }];
  const result = { answer: 'Retain the checked claims.', disposition: 'completed', claims: [{ text: 'The ledger is admitted.', citations: evidence.map(({ id, digest }) => ({ id, digest })) }], findings: [] };
  const proposals: ResearchReviewProposal[] = ['peer-review', 'red-team'].map((pattern, index) => ({ pattern: pattern as ResearchReviewProposal['pattern'], result: structuredClone(result),
    independence: { roleId: 'independent-' + index, promptRevision: hash(), modelIdentity: f.writer.modelIdentity } }));
  return { ...f, evidence, proposals };
}
it('independent roles may share a provider identity and retain exact native results without editing claims', async () => {
  const f = await fixture(), before = JSON.stringify(f.ledger), review = checked(await createResearchReviews(f.draft, f.ledger, f.evidence, f.proposals));
  assert.equal(review.accepted, true); assert.equal(review.reviews.length, 2); assert.equal(JSON.stringify(f.ledger), before);
  for (const [index, record] of review.reviews.entries()) {
    assert.notEqual(record.independence!.roleId, f.writer.roleId); assert.equal(record.independence!.modelIdentity, f.writer.modelIdentity);
    assert.equal(await researchArtifactIdOf(review.artifacts[index].bytes), record.artifactIds[0]);
  }
});
it('missing or same-writer identity is advisory and critical or conflicting findings cannot be dropped', async () => {
  const f = await fixture();
  for (const identity of [null, f.writer]) {
    const proposals = structuredClone(f.proposals); proposals[0].independence = identity;
    const review = checked(await createResearchReviews(f.draft, f.ledger, f.evidence, proposals));
    assert.equal(review.accepted, false); assert.equal(review.reviews[0].verdict, 'revise');
  }
  const proposals = structuredClone(f.proposals), citation = f.evidence.map(({ id, digest }) => ({ id, digest }));
  for (const [index, proposal] of proposals.entries()) (proposal.result as { findings: unknown[] }).findings = [{ id: 'shared-concern', origin: 'critic',
    critical: true, contradictory: true, disposition: 'unresolved', reason: 'Retained disagreement ' + index, citations: citation }];
  const review = checked(await createResearchReviews(f.draft, f.ledger, f.evidence, proposals));
  assert.equal(review.accepted, false); assert.ok(review.issues.some(issue => issue.cause?.code === 'TGMPL1005'));
  assert.deepEqual(review.reviews.map(record => record.retainedFindings![0].reason), ['Retained disagreement 0', 'Retained disagreement 1']);
  assert.ok(review.reviews.every(record => record.verdict === 'reject'));
});
it('review cannot bind a modified draft digest or omit the draft from the admitted evidence view', async () => {
  const f = await fixture(), changed = structuredClone(f.draft); changed.sections[0].text = 'Changed after preparation.';
  const bad = await createResearchReviews(changed, f.ledger, f.evidence, f.proposals);
  assert.equal(bad.valid, false); if (!bad.valid) assert.equal(bad.issues[0].code, 'TRSH1002');
  const absent = await createResearchReviews(f.draft, f.ledger, f.evidence.slice(0, 1), f.proposals);
  assert.equal(absent.valid, false); if (!absent.valid) assert.equal(absent.issues[0].code, 'TRSH1005');
});
