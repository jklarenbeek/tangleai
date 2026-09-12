import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { validateOutcomeReport } from '../../benchmark/lib/outcome-conformance.ts';
import type { OutcomeConformance } from '../../benchmark/lib/outcome-conformance.types.ts';
const changes: Record<string, (r: OutcomeConformance) => void> = {
  'missing reservation audit': r => { const records = r.traces[0].records; records.splice(records.findIndex(v => v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'attemptEvent'), 1); },
  'invented resolver count': r => { r.traces[0].resolverReads++; },
  'invented transport count': r => { r.bindings[0].requests++; },
  'unmeasured contract revision': r => { r.bindings[0].contractRevision = 'a'.repeat(64); },
  'removed storage evidence': r => { r.probes = r.probes.filter(p => p.capability !== 'storage'); },
};
for (const [name, change] of Object.entries(changes)) it(`report refuses ${name} even with a recomputed top-level hash`, async () => {
  const report = JSON.parse(await readFile('benchmark/results/outcome-conformance.json', 'utf8')) as OutcomeConformance;
  change(report); const { reportId, ...body } = report; report.reportId = await canonicalSha256(body);
  await assert.rejects(() => validateOutcomeReport(report));
});
