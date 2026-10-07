import assert from 'node:assert/strict';
import { before, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { validateCgtReport, renderDocument } from '../../benchmark/lib/cgt.ts';
import type { CgtReport } from '../../benchmark/lib/cgt.types.ts';

let measured: CgtReport;
before(async () => { measured = await validateCgtReport(JSON.parse(await readFile(new URL('../../benchmark/results/cgt.json', import.meta.url), 'utf8'))); });
it('keeps every scientific condition not-run beside a real scripted rollback receipt', () => {
  assert.equal(measured.claim.status, 'not-run'); assert.equal(measured.claim.authorizedLiveRunId, null);
  assert.equal(measured.claim.gatePolicyId, measured.evaluationContext.policy.id);
  assert.deepEqual(measured.claim.conditions.map(row => row.id), ['learning', 'retention', 'security', 'operations', 'rollback']);
  assert.ok(measured.claim.conditions.every(row => row.status === 'not-run'));
  assert.equal(measured.claim.rollbackDrillId, measured.rollbackDrill.receiptId);
  assert.equal(measured.rollbackDrill.restoredHead.versionId, measured.rollbackDrill.previousArtifactId);
  assert.equal(measured.rollbackDrill.restoredHead.revision, 3); assert.equal(measured.rollbackDrill.physicalRequests, 0);
  assert.match(renderDocument(measured).split('\n\n')[1], /claim: \*\*not-run\*\*/);
});
it('refuses rehashed scientific status, metric and rollback forgeries', async () => {
  const mutations: Array<(report: CgtReport) => void> = [
    report => { report.claim.status = 'met'; },
    report => { report.claim.authorizedLiveRunId = 'a'.repeat(64); },
    report => { report.claim.conditions[0].status = 'met'; },
    report => { report.claim.conditions[1].observed = 'Every retention lane passed.'; },
    report => { report.rows[0].cgc = 0.5; },
    report => { report.rollbackDrill.routed++; },
    report => { report.rollbackDrill.restoredHead.versionId = report.rollbackDrill.candidateArtifactId; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(measured); mutate(forged);
    const { receiptId: _receiptId, ...drill } = forged.rollbackDrill;
    forged.rollbackDrill.receiptId = await canonicalSha256(drill); forged.claim.rollbackDrillId = forged.rollbackDrill.receiptId;
    const { reportId: _reportId, ...body } = forged; forged.reportId = await canonicalSha256(body);
    await assert.rejects(validateCgtReport(forged), /cgt /);
  }
});
