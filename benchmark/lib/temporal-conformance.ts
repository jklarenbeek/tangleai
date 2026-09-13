/** Independent exact oracle, backend adapter boundary and reconciled measurement. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { TEMPORAL_FIXTURES, TEMPORAL_WRONG_CONTROLS, type TemporalFixture, type StrictTemporalOutcome } from '../../test/fixtures/temporal.ts';
import { sha256 } from './longmemeval-source.ts';
import { createReportValidator } from './validate.ts';
import nativeReceipts from '../receipts/temporal-native.json' with { type: 'json' };
import sourceRoundtrip from '../receipts/longmemeval-roundtrip.json' with { type: 'json' };
import SCHEMA from '../schemas/temporal-report.schema.json' with { type: 'json' };

export const TEMPORAL_BACKENDS = ['memory', 'node-sqlite', 'bun-sqlite'] as const;
export type TemporalBackend = typeof TEMPORAL_BACKENDS[number];
export type TemporalRuntimeScenario = Omit<TemporalFixture, 'expected'>;
export type TemporalAdapter = (scenario: TemporalRuntimeScenario) => Promise<StrictTemporalOutcome | { unavailable: string }>;
export type TemporalAdapters = Partial<Record<TemporalBackend, TemporalAdapter>>;
export function temporalFixtureHash(): string { return sha256(canonicalizeJson(TEMPORAL_FIXTURES)); }
export function scoreTemporal(expected: StrictTemporalOutcome, actual: StrictTemporalOutcome): boolean {
  try { return canonicalizeJson(expected) === canonicalizeJson(actual); }
  catch (cause) { if (cause instanceof TypeError) return false; throw cause; }
}
export interface TemporalCaseMeasurement {
  backend: TemporalBackend; id: string; description: string;
  status: 'measured' | 'not-implemented' | 'unavailable' | 'failed'; passed: boolean | null;
  expected: StrictTemporalOutcome; actual: StrictTemporalOutcome | null; detail: string | null;
}
export interface TemporalConformanceContext {
  sourceHash: string; registrationHash: string | null;
  lme: { status: 'available' | 'unavailable'; qa: number | null; retrieval: number | null; futureGoldQuestions: number | null };
  locomo: { status: 'available' | 'unavailable'; scorable: number | null; adversarial: number | null; anchoredQuestions: number | null };
}
const validateShape = createReportValidator(SCHEMA);
export async function runTemporalConformance(context: TemporalConformanceContext, adapters: TemporalAdapters = {}) {
  const wrongControls = TEMPORAL_WRONG_CONTROLS.map(control => ({ name: control.name, caseId: control.caseId,
    rejected: !scoreTemporal(TEMPORAL_FIXTURES.find(f => f.id === control.caseId)!.expected, control.actual) }));
  const rows: TemporalCaseMeasurement[] = [];
  for (const backend of TEMPORAL_BACKENDS) for (const scenario of TEMPORAL_FIXTURES) {
    const base = { backend, id: scenario.id, description: scenario.description, expected: scenario.expected };
    const adapter = adapters[backend];
    if (!adapter) { rows.push({ ...base, status: 'not-implemented', passed: null, actual: null, detail: 'runtime adapter not implemented' }); continue; }
    try {
      const { expected: _oracle, ...runtimeScenario } = scenario;
      const actual = await adapter(JSON.parse(JSON.stringify(runtimeScenario)) as TemporalRuntimeScenario);
      if ('unavailable' in actual) rows.push({ ...base, status: 'unavailable', passed: null, actual: null, detail: actual.unavailable });
      else rows.push({ ...base, status: 'measured', passed: scoreTemporal(scenario.expected, actual), actual, detail: null });
    } catch (cause) {
      rows.push({ ...base, status: 'failed', passed: false, actual: null, detail: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  const counts = { planned: rows.length, passed: rows.filter(r => r.passed === true).length,
    failed: rows.filter(r => r.passed === false).length, notImplemented: rows.filter(r => r.status === 'not-implemented').length,
    unavailable: rows.filter(r => r.status === 'unavailable').length };
  const refusals: Record<string, number> = {};
  for (const row of rows) if (row.actual?.reason) refusals[row.actual.reason] = (refusals[row.actual.reason] ?? 0) + 1;
  const body = { instrument: 'temporal-conformance-v1', fixtureHash: temporalFixtureHash(), fixtureCases: TEMPORAL_FIXTURES.length,
    context, rows, counts, refusals, wrongControls, liveRequests: 0,
    gate: { instrumentPassed: wrongControls.every(c => c.rejected) && counts.failed === 0,
      implementationComplete: counts.passed === counts.planned && counts.failed === 0, default: 'off' } };
  const report = { ...body, sha256: sha256(canonicalizeJson(body)) };
  if (!validateTemporalConformance(report)) throw new Error(`temporal report failed contract: ${JSON.stringify(validateShape(report).errors?.slice(0, 3))}`);
  return report;
}
export type TemporalConformanceReport = Awaited<ReturnType<typeof runTemporalConformance>>;
export function validateTemporalConformance(value: unknown): boolean {
  if (!validateShape(value).valid || (value as TemporalConformanceReport).instrument !== 'temporal-conformance-v1') return false;
  const report = value as TemporalConformanceReport;
  const { sha256: hash, ...body } = report;
  return hash === sha256(canonicalizeJson(body)) && report.fixtureHash === temporalFixtureHash() &&
    report.rows.length === TEMPORAL_FIXTURES.length * TEMPORAL_BACKENDS.length &&
    new Set(report.rows.map(r => `${r.backend}:${r.id}`)).size === report.rows.length &&
    report.rows.every(r => {
      const fixture = TEMPORAL_FIXTURES.find(f => f.id === r.id);
      return fixture !== undefined && scoreTemporal(fixture.expected, r.expected) &&
        (r.status === 'measured' ? r.actual !== null && r.passed === scoreTemporal(fixture.expected, r.actual) :
          r.actual === null && r.passed === (r.status === 'failed' ? false : null));
    });
}
export function renderTemporalConformance(r: TemporalConformanceReport): string {
  return ['# Temporal memory conformance', '',
    'Generated by `node benchmark/temporal-conformance.ts --md docs/TEMPORAL_BENCHMARK.md`.', '',
    `Independent fixture: \`${r.fixtureHash}\` (${r.fixtureCases} cases). Effective source: \`${r.context.sourceHash}\`.`, '',
    `Registration: ${r.context.registrationHash === null ? 'unavailable external corpus' : `\`${r.context.registrationHash}\``}.`, '',
    '| Backend | Planned | Passed | Failed | Not implemented | Unavailable |', '|---|---:|---:|---:|---:|---:|',
    ...TEMPORAL_BACKENDS.map(backend => { const rows = r.rows.filter(row => row.backend === backend);
      return `| ${backend} | ${rows.length} | ${rows.filter(x => x.passed === true).length} | ${rows.filter(x => x.passed === false).length} | ${rows.filter(x => x.status === 'not-implemented').length} | ${rows.filter(x => x.status === 'unavailable').length} |`; }), '',
    `Wrong controls rejected: ${r.wrongControls.filter(c => c.rejected).length}/${r.wrongControls.length}. Physical live requests: ${r.liveRequests}. Runtime completion: ${r.gate.implementationComplete}. Default: **off**.`, '',
    'The fixture specifies exact boundaries, citations and arithmetic independently of the runtime. Missing adapters never count as passing. Scripted providers qualify mechanics and accounting, not live model quality.', '',
    '| Case | Independent expectation | Memory | Node SQLite | Bun SQLite |', '|---|---|---|---|---|',
    ...TEMPORAL_FIXTURES.map(f => `| ${f.id} | ${f.description} | ${TEMPORAL_BACKENDS.map(b => { const row = r.rows.find(x => x.backend === b && x.id === f.id)!; return row.passed === true ? 'pass' : row.passed === false ? 'FAIL' : row.status; }).join(' | ')} |`), '',
    '## Native SQLite qualification', '',
    'Measured on 10,000 synthetic occurrences and claims in 100 series. The public Jaren planner selected the declared scoped numeric indexes. Claim candidates are refined before winner selection; a bounded incomplete set refuses. These measurements qualify the seek shapes, not end-to-end semantic recall.', '',
    '| Runtime | Shape | Index | Statements | Candidates | Diverted | Refined | Final results |', '|---|---|---|---:|---:|---:|---:|---:|',
    ...nativeReceipts.flatMap(r => r.rows.map(q => `| ${r.runtime} ${r.version} | ${q.shape} | ${q.plan.index} | ${q.plan.counts.statements} | ${q.returnedCandidates} | ${q.stats.diverted} | ${q.refined} | ${q.finalResults} |`)), '',
    'Actual cold setup and warm p50/p95 timings are kept in the separate [environment receipt](../benchmark/receipts/temporal-native-environment.json). Reproduce with `node benchmark/temporal-native.ts --json /tmp/temporal-native-node.json` and the same command under Bun. Timings include diagnostics and apply only to the measured host.', '',
    '## Denominators and limits', '',
    `Full LongMemEval source persistence: ${sourceRoundtrip.passed}/${sourceRoundtrip.profileCases} profile cases passed on each of ${sourceRoundtrip.backends.join(', ')} with identical normalized digest \`${sourceRoundtrip.sha256}\`. Provided-history preserves ${sourceRoundtrip.counts['provided-history'].occurrences} turns; strict-as-of preserves ${sourceRoundtrip.counts['strict-as-of'].occurrences}. All 500 questions remain in both profiles, including the one with an empty strict history. Identical projection replays write and activate zero records. This source-only qualification uses no extracted claims or embeddings and is separate from retrieval and QA quality.`, '',
    `LongMemEval: ${r.context.lme.status}; QA ${r.context.lme.qa ?? 'unavailable'}, official retrieval ${r.context.lme.retrieval ?? 'unavailable'}; strict-as-of retains ${r.context.lme.futureGoldQuestions ?? 'unavailable'} future-gold questions in its denominator. Provided-history and strict-as-of are distinct profiles.`, '',
    `LoCoMo: ${r.context.locomo.status}; scorable ${r.context.locomo.scorable ?? 'unavailable'}, separately excluded adversarial ${r.context.locomo.adversarial ?? 'unavailable'}, canonical anchored questions ${r.context.locomo.anchoredQuestions ?? 'unavailable'}. Relative queries need a host anchor.`, '',
    'The upstream LongMemEval temporal judge explicitly tolerates off-by-one arithmetic; it cannot certify the strict kernel. The upstream 15-week reference for question `370a8ff4` stays unchanged; the independent dates span 81 civil days, or 11 whole weeks and 4 days.', '',
    'Live extraction quality, upstream model judge accuracy and deployment costs are unmeasured. A separately approved held-out comparison must pass all quality, strict correctness and cost gates before a default change.', '',
    'The [matched evaluation](TEMPORAL_EVALUATION.md) reports the complete keyless matrix, context-trimming losses, split/type denominators and cold request plan. Model-dependent cells stay explicitly unmeasured.', '',
    ...(Object.keys(r.refusals).length ? ['| Counted runtime reason | Count |', '|---|---:|', ...Object.entries(r.refusals).sort().map(([reason, n]) => `| ${reason} | ${n} |`), ''] : []),
  ].join('\n');
}
