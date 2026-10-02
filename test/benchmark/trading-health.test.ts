import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import measured from '../../benchmark/results/trading.json' with { type: 'json' };
import schema from '../../benchmark/schemas/trading.schema.json' with { type: 'json' };
import renders from '../fixtures/trading-prompts.json' with { type: 'json' };
import { tradingArtifacts } from '@tangleai/trading';
import { validateTradingReport } from '../../benchmark/lib/trading-report.ts';
import { tradingAblationComparisons } from '../../benchmark/lib/trading-ablations.ts';
import { loadTradingFixture } from '../../benchmark/lib/trading.ts';
import { createReportValidator } from '../../benchmark/lib/validate.ts';
import type { Trading } from '../../benchmark/lib/trading.types.ts';

it('independent trading reproduction refuses internally reconciled call and cost forgeries after rehashing', async () => {
  const report = measured as unknown as Trading;
  assert.deepEqual(await validateTradingReport(report), { valid: true, errors: [] });
  const shape = createReportValidator(schema);
  const mutations: Array<(r: Trading) => void> = [
    r => { const a = r.rows.find(row => row.agent)!.agent!; a.physicalCalls++; a.spend.calls++; a.completions++; },
    r => { const a = r.rows.find(row => row.agent)!.agent!; a.spend.tokens++; a.spend.usd++; },
    r => { const c = r.rows.find(row => row.id === 'buy-and-hold')!.costs; c.commission++; c.total++; },
    r => { const a = r.ablations.runs.find(row => row.id === 'single-agent')!; a.physicalCalls++; a.spend.calls++; a.spend.tokens++; a.spend.usd++;
      r.ablations.comparisons = tradingAblationComparisons(r.ablations.runs); },
    r => { r.executionDiagnostics[0].turnover++; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(report); mutate(copy);
    const { reportId: _, ...payload } = copy; copy.reportId = await canonicalSha256(payload);
    assert.equal(shape(copy).valid, true, 'the forgery passes schema and internal reconciliation');
    const checked = await validateTradingReport(copy);
    assert.equal(checked.valid, false); assert.ok(!checked.errors.includes('report identity'));
  }
});

it('pins the synthetic licence, generated corpus and complete prompt render census', async () => {
  const fixture = await loadTradingFixture();
  assert.equal(fixture.sha256, '76edaa408ad8f4b227d8cfaa8cc29c3a89d1cd7a166a49bc3cee2dd9ec585793');
  assert.equal(fixture.manifest.licence, 'MIT');
  await promisify(execFile)(process.execPath, ['benchmark/scripts/trading-fixture.ts', '--check']);
  assert.equal(tradingArtifacts.prompts.length, 12); assert.equal(renders.length, 24);
  assert.deepEqual([...new Set(renders.map(r => r.id))].sort(), tradingArtifacts.prompts.map(p => p.id).sort());
  assert.ok(tradingArtifacts.prompts.every(p => renders.filter(r => r.id === p.id).map(r => r.mode).sort().join(',') === 'full,minimal'));
});

it('comparison eligibility refuses unequal resources and denominators while preserving both delta signs', () => {
  const runs = structuredClone((measured as unknown as Trading).ablations.runs), full = runs.find(r => r.id === 'full')!;
  const candidate = runs.find(r => r.id === 'single-agent')!;
  candidate.physicalCalls = full.physicalCalls + 1;
  assert.equal(tradingAblationComparisons(runs)[0].delta.calls, 1);
  candidate.physicalCalls = full.physicalCalls - 1;
  assert.equal(tradingAblationComparisons(runs)[0].delta.calls, -1);
  for (const mutate of [(r: typeof candidate) => { r.resourcesSha256 = '0'.repeat(64); },
    (r: typeof candidate) => { r.manifestId = 'different'; }, (r: typeof candidate) => { r.comparisonId = '0'.repeat(64); },
    (r: typeof candidate) => { r.decisionCount--; }, (r: typeof candidate) => { r.incompleteDecisions++; },
    (r: typeof candidate) => { r.status = 'failed'; }]) {
    const changed = structuredClone(runs); mutate(changed.find(r => r.id === 'single-agent')!);
    const pair = tradingAblationComparisons(changed)[0]; assert.equal(pair.eligible, false); assert.ok(pair.reason);
  }
});
