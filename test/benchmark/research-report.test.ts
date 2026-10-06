import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { researchContext, buildReport, renderReport, renderDocument, validateResearchReport, REPORT_PATH, DOCUMENT_PATH } from '../../benchmark/lib/research.ts';
import { validateResearchReportShape } from '../../benchmark/lib/research-validation.ts';
import type { ResearchReport } from '../../benchmark/lib/research.types.ts';

it('the committed report and document reproduce with their original source identity', async () => {
    const context = await researchContext();
    const prior: ResearchReport = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
    assert.equal(await validateResearchReport(prior, context), true);
    const rebuilt = await buildReport({ context: { ...context, source: prior.source } });
    assert.equal(renderReport(rebuilt), await readFile(REPORT_PATH, 'utf8'));
    assert.equal(renderDocument(rebuilt), await readFile(DOCUMENT_PATH, 'utf8'));
  });

it('rehashing cannot authorize forged activation gates, refusal counts or paired deltas', async () => {
  const report: ResearchReport = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  assert.equal(validateResearchReportShape(report).valid, true);
  const mutations: Array<[string, (r: ResearchReport) => void]> = [
    ['activation gate', r => { r.ablation.gate.writebackEligible = true; }],
    ['refusal census', r => { r.lessons.rows.find(row => row.id === 'lesson-refusal:leaked-origin')!.counts.leaked++; }],
    ['paired delta', r => { r.ablation.pairs.find(pair => pair.id === 'lessons-on-vs-off')!.delta = 1; }],
  ];
  for (const [name, mutate] of mutations) {
    const forged = structuredClone(report); mutate(forged);
    const { reportId: _id, ...body } = forged; forged.reportId = await canonicalSha256(body);
    assert.notEqual(forged.reportId, report.reportId, name);
    assert.equal(validateResearchReportShape(forged).valid, false, name);
    assert.equal(await validateResearchReport(forged), false, name);
  }
});
