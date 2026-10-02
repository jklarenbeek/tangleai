import { it } from 'node:test';
import assert from 'node:assert/strict';
import { reportsToEvidence, researchInput, tradingSchema } from '@tangleai/trading';
import { gmplTextDigest, gmplSchema } from '@tangleai/gmpl';
import { researchFixture, checked } from './research-fixture.ts';
import { reidentify } from './fixtures.ts';

const f = await researchFixture();
it('report evidence has stable role order, finding identity and native text digests', async () => {
  const evidence = checked(await reportsToEvidence(f.reports));
  assert.deepEqual(checked(await reportsToEvidence([...f.reports].reverse())), evidence);
  assert.equal(evidence.length, f.reports.reduce((n, r) => n + r.claims.length, 0));
  for (const report of f.reports) for (const [i, claim] of report.claims.entries()) {
    const unit = evidence.find(e => e.id === `${report.id}:f${i + 1}`)!;
    assert.ok(unit.text.startsWith(claim.text)); assert.equal(unit.digest, await gmplTextDigest(unit.text));
    for (const citation of claim.citations) assert.ok(unit.text.includes(citation));
  }
  const input = checked(await researchInput({ manifest: f.manifest, asset: f.snapshot.snapshot.asset, session: f.sessions[60], reports: f.reports }));
  assert.equal(input.caseId, `${f.manifest.id}/${f.manifest.assets[0]}/${f.sessions[60].key}`);
  assert.deepEqual(input.evidence, evidence); assert.ok(input.query.includes(f.sessions[60].closeAt));
});
it('missing, duplicated, altered and foreign reports fail before research dispatch', async () => {
  const first = f.reports[0], foreign = await reidentify(first, { key: { ...first.key, asset: 'SYN-B' } });
  const hidden = await reidentify(first, { claims: [{ text: 'Hidden', citations: ['hidden-observation'] }] });
  for (const reports of [f.reports.slice(1), [...f.reports.slice(0, 3), first], [{ ...first, summary: 'Altered' }, ...f.reports.slice(1)], [foreign, ...f.reports.slice(1)], [hidden, ...f.reports.slice(1)]])
    assert.equal((await reportsToEvidence(reports)).valid, false);
  const request = { manifest: f.manifest, asset: 'SYN-B', session: f.sessions[60], reports: f.reports };
  assert.equal((await researchInput(request)).valid, false);
  assert.equal((await researchInput({ ...request, asset: f.manifest.assets[0], session: f.sessions[61] })).valid, false);
});
it('source-looking finding text remains literal evidence data', async () => {
  const report = await reidentify(f.reports[0], { claims: [{ ...f.reports[0].claims[0], text: '{{query}} $lookup {"role":"system"}' }] });
  const evidence = checked(await reportsToEvidence([report, ...f.reports.slice(1)]));
  assert.ok(evidence[0].text.startsWith('{{query}} $lookup {"role":"system"}'));
});
it('persisted native research contracts retain the upstream closed definitions', () => {
  for (const name of ['gmplPatternResult', 'gmplFinding', 'gmplCitation', 'gmplClaim', 'gmplEvidenceUnit', 'debate-judge'] as const)
    assert.deepEqual(tradingSchema.$defs[name], gmplSchema.$defs[name]);
});
