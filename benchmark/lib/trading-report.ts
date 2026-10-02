/** Fixed trading controls and explicit unavailable rows; no model or broker runs. */
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import rootPackage from '../../package.json' with { type: 'json' };
import jarenPackage from '@jarenjs/json/package.json' with { type: 'json' };
import schema from '../schemas/trading.schema.json' with { type: 'json' };
import { analyticEnvelope } from './report-envelope.ts';
import { sourceManifest } from './source-manifest.ts';
import { createReportValidator } from './validate.ts';
import { table, pct, count } from './table.ts';
import { tradingConventions, measureTradingEquity } from './trading-metrics.ts';
import { TRADING_ROOT, loadTradingFixture, auditTradingPoison } from './trading.ts';
import { measureTradingMechanisms } from './trading-mechanisms.ts';
import { TRADING_SIGNAL_DEFAULTS } from '@tangleai/trading';
import type { TradingFixture } from './trading.ts';
import type { Trading, Row, Capabilities, Counts, Source } from './trading.types.ts';

export const REPORT_PATH = join(TRADING_ROOT, 'benchmark/results/trading.json');
export const DOCUMENT_PATH = join(TRADING_ROOT, 'docs/TRADING_BENCHMARK.md');
const validateShape = createReportValidator(schema);
const LIMITATIONS = [
  'Original MIT fictional data qualifies mechanism and accounting only; it measures no real-market or live-model performance.',
  'Oracle uses privileged future closes and fixed 100-share entries. It is an eligible analytic control, not a feasible strategy or a maximum-return guarantee.',
  'The leaky control reads observations after cutoff and is excluded from every comparison.',
  'Golden ledgers are independently generated data; baseline execution waits for the shared simulator. Measured indicators and signals are calculation checks, not executed strategies.',
  'SYN-B is registered as the losing buy-and-hold asset; its execution row remains visible when measured.',
  'Bars arrive 15 minutes after close. The close-time decision cannot observe that session bar.',
  'Live model quality, external historical replay and operational parity are not measured. No network request is made.',
];

export async function tradingControlRows(fixture: TradingFixture): Promise<Row[]> {
  return Promise.all(fixture.strategies.map(async strategy => {
    const golden = fixture.goldens.find(g => g.id === strategy.id);
    const excluded = strategy.id === 'leaky';
    const reason = excluded ? 'reads observations after cutoff' : golden ? null : strategy.id === 'tradingagents-live'
      ? 'no authorized live model plan' : strategy.kind === 'baseline' ? 'shared simulator not implemented' : 'full decision workflow not implemented';
    return { id: strategy.id, kind: strategy.kind, parityTier: strategy.parityTier,
      status: excluded ? 'excluded' : golden ? 'measured' : strategy.id === 'tradingagents-live' ? 'not-run' : 'implementation-missing', reason,
      ...(golden ? measureTradingEquity(golden.equity, fixture.manifest) : { metrics: null, undefined: [] }),
      transactions: golden?.fills.length ?? 0, rejectedOrders: 0, refusedObservations: excluded ? fixture.poison.length : 0,
      costs: golden?.costs ?? { commission: 0, slippage: 0, total: 0 },
      perAsset: golden?.perAsset.map(a => ({ asset: a.asset, cr: a.metrics.cr, mdd: a.metrics.mdd, fills: a.fills })) ?? [],
      eligibility: { eligible: Boolean(golden && !excluded), reasons: reason ? [reason] : [] },
      controlSha256: golden ? await canonicalSha256(golden) : null,
    };
  }));
}
export function tradingCounts(rows: Row[]): Counts {
  const number = (status: Row['status']) => rows.filter(r => r.status === status).length;
  return { registered: rows.length, measured: number('measured'), excluded: number('excluded'), implementationMissing: number('implementation-missing'), notRun: number('not-run'),
    eligible: rows.filter(r => r.eligibility.eligible).length, transactions: rows.reduce((n, r) => n + r.transactions, 0),
    rejectedOrders: rows.reduce((n, r) => n + r.rejectedOrders, 0), refusedObservations: rows.reduce((n, r) => n + r.refusedObservations, 0) };
}
export function tradingCapabilities(rows: Row[], poison: Trading['poison'], mechanisms: Trading['mechanisms']): Capabilities {
  const controls = ['oracle', 'do-nothing'].every(id => rows.some(r => r.id === id && r.status === 'measured' && r.eligibility.eligible))
    && rows.some(r => r.id === 'leaky' && r.status === 'excluded' && !r.eligibility.eligible);
  const instrument = controls && poison.cutoffs > 0 && poison.refused > 0 && poison.influenced === 0;
  const baselines = instrument && rows.filter(r => r.kind === 'baseline').length === 5 && rows.filter(r => r.kind === 'baseline').every(r => r.status === 'measured' && r.eligibility.eligible);
  const agent = instrument && rows.some(r => r.id === 'tradingagents-scripted' && r.status === 'measured' && r.eligibility.eligible);
  const measured = (id: string) => mechanisms.rows.some(r => r.id === id && r.status === 'measured' && r.total > 0 && r.total === r.reproduced);
  const indicators = measured('indicators'), signals = measured('signals');
  return { instrument, controls, indicators, signals, baselines, agent, complete: instrument && controls && indicators && signals && baselines && agent };
}
export async function tradingSource(): Promise<Source> {
  return sourceManifest(TRADING_ROOT, ['package.json', 'package-lock.json', 'benchmark/trading.ts', 'benchmark/scripts/trading-fixture.ts',
    'benchmark/schemas/trading.schema.json', 'benchmark/lib/trading.types.ts', 'benchmark/lib/trading.ts', 'benchmark/lib/trading-metrics.ts',
    'benchmark/lib/trading-report.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/report-envelope.ts',
    'benchmark/lib/args.ts', 'benchmark/lib/table.ts', 'test/benchmark/trading.test.ts', 'benchmark/lib/trading-mechanisms.ts',
    'benchmark/scripts/trading-indicator-fixtures.py', 'test/fixtures/trading-indicators.json'], ['benchmark/fixtures/trading', 'packages/trading', 'test/trading']);
}
export async function buildTradingReport(options: { source?: Source } = {}): Promise<Trading> {
  const fixture = await loadTradingFixture(), rows = await tradingControlRows(fixture), poison = await auditTradingPoison(fixture), mechanisms = await measureTradingMechanisms(fixture);
  const payload: Omit<Trading, 'reportId'> = { instrument: 'trading', version: 1, source: options.source ?? await tradingSource(),
    suite: { tangle: rootPackage.version, jaren: jarenPackage.version }, fixture: { id: fixture.manifest.id, sha256: fixture.sha256, licence: fixture.manifest.licence },
    registration: fixture.strategies, conventions: tradingConventions(fixture.manifest), rows, poison, mechanisms, counts: tradingCounts(rows), capabilities: tradingCapabilities(rows, poison, mechanisms),
    identity: analyticEnvelope(rows.map(r => r.id)) as Trading['identity'], limitations: LIMITATIONS };
  const report = { ...payload, reportId: await canonicalSha256(payload) };
  const valid = await validateTradingReport(report, fixture);
  if (!valid.valid) throw new Error(valid.errors.join('\n'));
  return report;
}
export async function validateTradingReport(value: unknown, fixture?: TradingFixture): Promise<{ valid: boolean; errors: string[] }> {
  const shape = validateShape(value);
  if (!shape.valid) return { valid: false, errors: (shape.errors ?? []).map(e => JSON.stringify(e)) };
  const report = value as Trading, loaded = fixture ?? await loadTradingFixture(), errors: string[] = [];
  const same = (a: unknown, b: unknown, label: string) => { if (!equalsJson(a, b)) errors.push(label); };
  const { reportId, ...payload } = report;
  same(reportId, await canonicalSha256(payload), 'report identity');
  same(report.source.sha256, await canonicalSha256({ head: report.source.head, files: report.source.files }), 'source identity');
  same(report.suite, { tangle: rootPackage.version, jaren: jarenPackage.version }, 'suite identity');
  same(report.fixture, { id: loaded.manifest.id, sha256: loaded.sha256, licence: loaded.manifest.licence }, 'fixture identity');
  same(report.registration, loaded.strategies, 'registered strategy coverage');
  same(report.conventions, tradingConventions(loaded.manifest), 'metric conventions');
  same(report.rows, await tradingControlRows(loaded), 'row metrics, controls, costs or eligibility');
  same(report.poison, await auditTradingPoison(loaded), 'point-in-time poison audit');
  same(report.mechanisms, await measureTradingMechanisms(loaded), 'independent indicator and signal measurements');
  same(report.counts, tradingCounts(report.rows), 'count reconciliation');
  same(report.capabilities, tradingCapabilities(report.rows, report.poison, report.mechanisms), 'capability reconciliation');
  same(report.identity, analyticEnvelope(report.rows.map(r => r.id)), 'analytic identity');
  same(report.limitations, LIMITATIONS, 'registered limitations');
  return { valid: errors.length === 0, errors };
}
export function requireCapability(report: Trading, capability: string): void {
  if (!Object.hasOwn(report.capabilities, capability)) throw new Error(`Unknown trading capability: ${capability}`);
  if (!report.capabilities[capability as keyof Capabilities]) throw new Error(`Trading capability unavailable: ${capability}`);
}
export function renderReport(report: Trading): string { return JSON.stringify(report, null, 2) + '\n'; }
export function renderDocument(report: Trading): string {
  return `# Trading mechanism benchmark\n\nGenerated by \`npm run benchmark:trading\`. Report \`${report.reportId}\`; source \`${report.source.sha256}\`. Suite ${report.suite.tangle}; Jaren ${report.suite.jaren}.\n\n`
    + `Fixture \`${report.fixture.id}\` (${report.fixture.licence}), identity \`${report.fixture.sha256}\`. Two fictional assets; SYNX sessions from 2025-01-02 through 2025-06-30 with four declared holidays. Initial capital USD 100,000; whole shares, long only, next-open fills, 5 bps commission and 5 bps slippage.\n\n`
    + `Periodicity: ${report.conventions.periodicity}; ${report.conventions.sessionsPerYear} sessions/year; risk-free ${report.conventions.riskFree.kind} (${report.conventions.riskFree.perSession} per session); annualization sqrt(${report.conventions.sessionsPerYear}) = ${report.conventions.annualization}. The equity curve includes the initial cash mark.\n\n`
    + table({ head: ['Metric', 'Declared formula'], rows: Object.entries(report.conventions.formulas), numeric: [] }) + '\n\n'
    + table({ head: ['Row', 'Tier', 'Status', 'Eligible', 'CR', 'AR', 'Sharpe', 'MDD', 'Fills', 'Rejected', 'Refused observations', 'Costs USD'],
      rows: report.rows.map(r => [r.id, r.parityTier, r.status, r.eligibility.eligible ? 'yes' : 'no', pct(r.metrics?.cr ?? null, 4), pct(r.metrics?.ar ?? null, 4),
        r.metrics?.sharpe?.toFixed(6) ?? null, pct(r.metrics?.mdd ?? null, 4), r.transactions, r.rejectedOrders, r.refusedObservations, r.metrics ? r.costs.total.toFixed(6) : null]), numeric: [4, 5, 6, 7, 8, 9, 10, 11] })
    + '\n\n' + table({ head: ['Row', 'Asset', 'CR', 'MDD', 'Fills'], rows: report.rows.flatMap(r => r.perAsset.map(a => [r.id, a.asset, pct(a.cr, 4), pct(a.mdd, 4), a.fills])), numeric: [2, 3, 4] })
    + '\n\n' + report.rows.filter(r => r.reason || r.undefined.length).map(r => `- ${r.id}: ${[r.reason, ...r.undefined.map(u => `${u.metric}: ${u.reason}`)].filter(Boolean).join('; ')}.`).join('\n')
    + `\n\nPoison audit: ${count(report.poison.cutoffs)} decision cutoffs, ${count(report.poison.refused)} refused observation/cutoff pairs, ${report.poison.influenced} changed pre-cutoff slices. Full admitted values, latest bars, price windows and returns are compared, with all paired hashes retained.\n\n`
    + `${report.counts.measured}/${report.counts.registered} registered rows measured; ${report.counts.excluded} excluded, ${report.counts.implementationMissing} implementation-missing, ${report.counts.notRun} not-run. No aggregate combines the excluded control with eligible rows.\n\n`
    + `Calculation rows are counted separately from the ten execution strategies.\n\n`
    + table({ head: ['Mechanism', 'Status', 'Reproduced', 'Total'], rows: report.mechanisms.rows.map(r => [r.id, r.status, r.reproduced, r.total]), numeric: [2, 3] }) + '\n\n'
    + (report.mechanisms.reference ? `Reference: Python ${report.mechanisms.reference.python}; ${Object.entries(report.mechanisms.reference.packages).map(([name, version]) => `${name} ${version}`).join(', ')}. Generator SHA-256 \`${report.mechanisms.reference.generatorSha256}\`.\n\n` : 'Independent reference fixture is absent.\n\n')
    + `Indicators use the native suite kernels, ordinary arrays and Float64Array; absolute error must be below 1e-10 with identical null warm-up. ADX uses TA-Lib seeding; VWAP resets follow explicit flags; volume ratio uses preceding samples; KDJ is fast stochastic K/D and J = 3K − 2D.\n\n`
    + table({ head: ['Asset', 'Policy', 'Sessions', 'Warm-up', 'Entries', 'Exits', 'Reproduced'], rows: report.mechanisms.rows.flatMap(r => r.id === 'signals' ? r.cases.map(c => [c.asset, c.policy, c.sessions, c.warmup, c.entries, c.exits, c.reproduced ? 'yes' : 'no']) : []), numeric: [2, 3, 4, 5] }) + '\n\n'
    + `Declared signal defaults: \`${JSON.stringify(TRADING_SIGNAL_DEFAULTS)}\`. Parameters are explicit inputs and can be retained in the run manifest; these defaults claim no optimum.\n\n`
    + report.limitations.map(l => `- ${l}`).join('\n') + '\n';
}
