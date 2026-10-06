import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { auditResearchExport, buildResearchAudit, validateResearchAudit, validateResearchAuditShape, renderResearchAudit } from '../../benchmark/lib/research-audit.ts';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import type { ResearchReport } from '../../benchmark/lib/research.types.ts';

const input = async () => {
  const report = JSON.parse(await readFile('benchmark/results/research.json', 'utf8')) as ResearchReport;
  return { report, manifest: structuredClone(report.writing.control!.bundle), loaded: await loadResearchFixture(),
    acquisitions: report.discovery.flatMap(row => row.acquisitions) };
};
test('independent artifact audit resolves actual manuscript records and immutable full passages', async () => {
  const f = await input(), one = await auditResearchExport(f.manifest, 'control', '/writing/control/bundle', f.loaded, f.acquisitions);
  const two = await auditResearchExport(f.manifest, 'control', '/writing/control/bundle', f.loaded, f.acquisitions);
  assert.deepEqual(one, two); assert.equal(one.checked, one.resolved, JSON.stringify(one.checks.filter(c => c.state !== 'resolved')));
  assert.equal(one.auditDisagreements, 0); assert.ok(one.checks.some(c => c.kind === 'metric'));
  assert.ok(one.checks.some(c => c.kind === 'citation' && c.recordIds.some(id => id.startsWith('art-'))));
  assert.equal(one.interventions!.scripted, 3); assert.equal(one.interventions!.human, 0);
});
test('fabricated numbers and dangling citations remain counted beside claimed verification', async () => {
  for (const mutation of ['fabricated-number', 'dangling-citation']) {
    const f = await input();
    if (mutation === 'fabricated-number') f.manifest.source.ledger.claims.find(c => c.metricBinding)!.metricBinding!.value += 1000;
    else f.manifest.source.ledger.claims.find(c => c.literatureIds.length)!.literatureIds = ['missing-citation'];
    const audit = await auditResearchExport(f.manifest, mutation, '/probe/' + mutation, f.loaded, f.acquisitions);
    assert.ok(audit.auditDisagreements > 0);
    if (mutation === 'fabricated-number') assert.ok(audit.checks.some(c => c.kind === 'metric' && c.state === 'fabricated'));
    else assert.ok(audit.checks.some(c => c.kind === 'citation' && c.state === 'unresolved'));
  }
});
test('matching verification assertions cannot substitute for missing acquisition or changed source bytes', async () => {
  const f = await input(), missing = await auditResearchExport(f.manifest, 'missing-source', '/probe/missing', f.loaded, []);
  assert.ok(missing.unresolved > 0); assert.ok(missing.auditDisagreements > 0);
  const card = f.manifest.source.inputs.cards[0], member = f.loaded.manifest.members.find(m => m.sha256 === card.contentHash)!;
  f.loaded.files.set(member.path, new TextEncoder().encode('The source bytes changed.'));
  const changed = await auditResearchExport(f.manifest, 'changed-source', '/probe/changed', f.loaded, f.acquisitions);
  assert.ok(changed.unresolved > 0); assert.ok(changed.auditDisagreements > 0);
});
test('malformed stored artifacts return counted audit results', async () => {
  const f = await input(), audit = await auditResearchExport({ claimed: 'verified' }, 'invalid', '/probe/invalid', f.loaded, f.acquisitions);
  assert.ok(audit.missing > 0); assert.equal(audit.checked, audit.missing); assert.equal(audit.projectId, null);
});
test('committed audit reproduces every run and retains adversarial disagreements separately', async () => {
  const f = await input(), one = await buildResearchAudit(f.report, f.loaded), two = await buildResearchAudit(f.report, f.loaded);
  assert.deepEqual(one, two); assert.deepEqual(one, f.report.audit); assert.equal(one.runs.length, 38);
  assert.equal(one.totals.checked, 1270); assert.equal(one.totals.resolved, 1270);
  assert.deepEqual([one.totals.unresolved, one.totals.fabricated, one.totals.missing, one.totals.auditDisagreements], [0, 0, 0, 0]);
  assert.ok(one.probes.every(probe => probe.state === 'measured' && probe.matched && probe.audit!.auditDisagreements > 0));
  assert.deepEqual(renderResearchAudit(one), renderResearchAudit(two));
  const forged = structuredClone(one); forged.totals.resolved++;
  assert.equal(validateResearchAuditShape(forged).valid, false);
  const rebound = structuredClone(one); rebound.probes[0].inputSha256 = 'a'.repeat(64);
  assert.equal(await validateResearchAudit(rebound, f.report, f.loaded), false);
  const partial = structuredClone(f.report); partial.writing.control = null; partial.writing.autoControl = null;
  const skipped = await buildResearchAudit(partial, f.loaded);
  assert.ok(skipped.probes.every(p => p.state === 'not-run' && p.reason === 'positive-writing-control-not-selected' && !p.matched));
});
