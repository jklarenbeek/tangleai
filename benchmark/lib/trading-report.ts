/** Deterministic simulated execution and explicit unavailable model rows. */
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
import { tradingConventions } from './trading-metrics.ts';
import { TRADING_ROOT, loadTradingFixture, auditTradingPoison } from './trading.ts';
import { measureTradingMechanisms } from './trading-mechanisms.ts';
import { measureTradingExecutions } from './trading-execution.ts';
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
  'All controls and five baselines use one next-open simulator. Oracle and cash reproduce independent golden ledgers; the excluded leaky request is refused and has zero fills.',
  'SYN-B buy-and-hold loses while SYN-A gains; both per-asset returns are shown. Each asset starts with an equal share of capital for attribution.',
  'Bars arrive 15 minutes after close. Signals use the latest admitted revision per historical session; all assets decide before any next-open fill. Cash, holdings and cited observations are visible to signal callbacks; ex-post marks are not.',
  'Analyst mechanism cases use a fixed cash-only portfolio and scripted responses. Citation resolution and deliberate repair/tool-refusal probes test boundaries, not investment quality or entailment.',
  'Live model quality, external historical replay and operational parity are not measured. No network request is made.',
];

export async function tradingControlRows(fixture: TradingFixture): Promise<Row[]> {
  return measureTradingExecutions(fixture);
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
  const analysts = measured('analysts-scripted') && mechanisms.rows.some(r => r.id === 'analysts-scripted' && r.citations > 0 && r.citations === r.resolved && r.probes.length === 4 && r.probes.every(p => p.passed));
  const research = measured('research-scripted') && mechanisms.rows.some(r => r.id === 'research-scripted' && r.probes.length === 4 && r.probes.every(p => p.passed));
  const trader = measured('trader-scripted') && mechanisms.rows.some(r => r.id === 'trader-scripted' && r.financialWrites === 0 && r.replayWrites === 0 && r.probes.length === 4 && r.probes.every(p => p.passed));
  const risk = measured('risk-scripted') && mechanisms.rows.some(r => r.id === 'risk-scripted' && r.probes.length === 4 && r.probes.every(p => p.passed));
  const fundManager = measured('fund-manager-scripted') && mechanisms.rows.some(r => r.id === 'fund-manager-scripted' && r.financialWrites === 0 && r.replayWrites === 0 && r.probes.length === 13 && r.probes.every(p => p.passed));
  return { instrument, controls, indicators, signals, baselines, analysts, research, trader, risk, fundManager, agent,
    complete: instrument && controls && indicators && signals && baselines && analysts && research && trader && risk && fundManager && agent };
}
export async function tradingSource(): Promise<Source> {
  return sourceManifest(TRADING_ROOT, ['package.json', 'package-lock.json', 'benchmark/trading.ts', 'benchmark/scripts/trading-fixture.ts',
    'benchmark/schemas/trading.schema.json', 'benchmark/lib/trading.types.ts', 'benchmark/lib/trading.ts', 'benchmark/lib/trading-metrics.ts',
    'benchmark/lib/trading-report.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/report-envelope.ts',
    'benchmark/lib/args.ts', 'benchmark/lib/table.ts', 'test/benchmark/trading.test.ts', 'test/benchmark/trading-cli.test.ts', 'benchmark/lib/trading-mechanisms.ts',
    'benchmark/scripts/trading-indicator-fixtures.py', 'test/fixtures/trading-indicators.json', 'benchmark/lib/trading-execution.ts',
    'benchmark/lib/trading-analyst-runner.ts', 'benchmark/lib/trading-analysts.ts', 'benchmark/lib/trading-research-runner.ts', 'benchmark/lib/trading-research.ts', 'benchmark/lib/gmpl-runner.ts',
    'benchmark/lib/trading-risk-runner.ts', 'benchmark/lib/trading-risk.ts', 'benchmark/lib/trading-policy-probes.ts',
    'scripts/trading-artifacts.ts', 'scripts/trading-sources.ts', 'test/fixtures/trading-prompts.json'],
  ['benchmark/fixtures/trading', 'packages/trading', 'test/trading', 'prompts/trading', 'packages/gmpl', 'packages/mas', 'packages/store', 'packages/agents', 'packages/models', 'packages/context', 'packages/config', 'packages/core']);
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
  same(report.mechanisms, await measureTradingMechanisms(loaded), 'independent indicators, signals and scripted analyst measurements');
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
    + '\n\n' + table({ head: ['Execution row', 'Decisions', 'Stale close marks', 'Replay writes'], rows: report.rows.filter(r => r.execution).map(r => [r.id, r.execution!.decisionCount, r.execution!.staleMarks, r.execution!.replayWrites]), numeric: [1, 2, 3] })
    + '\n\n' + report.rows.filter(r => r.reason || r.undefined.length).map(r => `- ${r.id}: ${[r.reason, ...r.undefined.map(u => `${u.metric}: ${u.reason}`)].filter(Boolean).join('; ')}.`).join('\n')
    + `\n\nPoison audit: ${count(report.poison.cutoffs)} decision cutoffs, ${count(report.poison.refused)} refused observation/cutoff pairs, ${report.poison.influenced} changed pre-cutoff slices. Full admitted values, latest bars, price windows and returns are compared, with all paired hashes retained.\n\n`
    + `${report.counts.measured}/${report.counts.registered} registered rows measured; ${report.counts.excluded} excluded, ${report.counts.implementationMissing} implementation-missing, ${report.counts.notRun} not-run. No aggregate combines the excluded control with eligible rows.\n\n`
    + `Targets enter with at most 100 whole shares and exit the held quantity; policy can only reduce a proposed quantity. Hard ceilings: gross/net exposure 1, single-name 0.6, participation 0.01, loss 0.2, cash floor USD 0. Only market orders in the declared two assets are allowed. Corporate actions settle once at the open; missing close bars retain prior marks and are counted. No terminal liquidation is forced.\n\n`
    + `Calculation rows are counted separately from the ten execution strategies.\n\n`
    + table({ head: ['Mechanism', 'Status', 'Reproduced', 'Total'], rows: report.mechanisms.rows.map(r => [r.id, r.status, r.reproduced, r.total]), numeric: [2, 3] }) + '\n\n'
    + report.mechanisms.rows.filter(r => r.id === 'analysts-scripted').map(r => `Analyst mechanism: ${r.reports} reports across ${r.total} asset/session cases; ${r.resolved}/${r.citations} citations resolve inside the role projection. Native MAS execution observed ${r.physicalCalls} physical calls, ${r.normalizations} normalizations, ${r.repairs} repairs, and ${r.refusedToolRequests}/${r.toolRequests} refused after-cutoff tool requests. All cases freeze the same cash-only portfolio and execute the four lanes concurrently. This is a scripted mechanism test, not a profitability or entailment claim.\n\n` + table({ head: ['Analyst safety probe', 'Passed', 'Physical calls', 'Repairs', 'Failed attempts'], rows: r.probes.map(p => [p.id, p.passed ? 'yes' : 'no', p.physicalCalls, p.repairs, p.refusals]), numeric: [2, 3, 4] }) + '\n\n').join('')
    + report.mechanisms.rows.filter(r => r.id === 'research-scripted').map(r => `Research mechanism: ${r.total} asset/session cases reuse the actually measured analyst artifacts (analyst receipt SHA-256 ${r.analystMeasurementSha256}). The native debate executes ${r.rounds} rounds and retains ${r.turns} attributed turns and ${r.retainedFindings} findings. Dispositions: ${r.completed} completed, ${r.rejected} rejected, ${r.noConsensus} no-consensus. Research makes ${r.physicalCalls} physical calls and ${r.normalizations} normalizations.\n\n`).join('')
    + report.mechanisms.rows.filter(r => r.id === 'trader-scripted').map(r => `Trader mechanism: ${r.proposals}/${r.total} valid proposals, ${r.physicalCalls} physical calls, ${r.exceedsPosition} oversize flags, ${r.financialWrites} financial writes and ${r.replayWrites} artifact replay writes. Primary roles use a synthetic cash-only portfolio; this measures proposal integrity rather than returns.\n\n`).join('')
    + report.mechanisms.rows.filter(r => r.id === 'risk-scripted').map(r => `Risk mechanism: ${r.total} cases reuse the measured research/trader outputs (receipt SHA-256 ${r.researchMeasurementSha256}). Three personas produce ${r.turns} turns across ${r.rounds} rounds, retaining ${r.retainedFindings} findings. Dispositions: ${r.adjusted} adjusted, ${r.hold} hold, ${r.rejected} rejected, ${r.noConsensus} no-consensus. Physical calls: ${r.physicalCalls}; normalizations: ${r.normalizations}.\n\n`).join('')
    + report.mechanisms.rows.filter(r => r.id === 'fund-manager-scripted').map(r => `Fund-manager mechanism: ${r.approved} approvals, ${r.modified} modifications and ${r.rejected} rejections; ${r.intents} admitted next-open intents, ${r.violations} admission refusals and ${r.adjustments} counted size adjustments. The ${r.physicalCalls} physical calls produce ${r.financialWrites} financial writes; replaying the artifact chain writes ${r.replayWrites} records. Admission uses only published quotes and refuses missing post-action marks; actual next-open execution must recheck policy.\n\n` + table({ head: ['Policy probe', 'Admitted', 'Refusal limits', 'Adjustment limits'], rows: r.probes.map(p => [p.id, p.admitted ? 'yes' : 'no', p.policyViolations?.join(', ') ?? '', p.adjustments?.join(', ') ?? '']) }) + '\n\n').join('')
    + report.mechanisms.rows.filter(r => r.id === 'research-scripted' || r.id === 'trader-scripted' || r.id === 'risk-scripted' || r.id === 'fund-manager-scripted').map(r => table({ head: ['Mechanism probe', 'Passed', 'Physical calls', 'Setup calls', 'Normalizations', 'Repairs', 'Replays', 'Restores', 'Refusals', 'Code'], rows: r.probes.map(p => [r.id + '/' + p.id, p.passed ? 'yes' : 'no', p.physicalCalls, p.setupPhysicalCalls ?? 0, p.normalizations, p.repairs, p.replays, p.restores, p.refusals, p.refusalCode]), numeric: [2, 3, 4, 5, 6, 7, 8] }) + '\n\n').join('')
    + `Probe calls are additional to primary-case calls. Restored nodes and replay events retain their distinct native counters; SQLite recovery must preserve the exact result, durable budget and physical call count. No provider network calls are made.\n\n`
    + (report.mechanisms.reference ? `Reference: Python ${report.mechanisms.reference.python}; ${Object.entries(report.mechanisms.reference.packages).map(([name, version]) => `${name} ${version}`).join(', ')}. Generator SHA-256 \`${report.mechanisms.reference.generatorSha256}\`.\n\n` : 'Independent reference fixture is absent.\n\n')
    + `Indicators use the native suite kernels, ordinary arrays and Float64Array; absolute error must be below 1e-10 with identical null warm-up. ADX uses TA-Lib seeding; VWAP resets follow explicit flags; volume ratio uses preceding samples; KDJ is fast stochastic K/D and J = 3K − 2D.\n\n`
    + table({ head: ['Asset', 'Policy', 'Sessions', 'Warm-up', 'Entries', 'Exits', 'Reproduced'], rows: report.mechanisms.rows.flatMap(r => r.id === 'signals' ? r.cases.map(c => [c.asset, c.policy, c.sessions, c.warmup, c.entries, c.exits, c.reproduced ? 'yes' : 'no']) : []), numeric: [2, 3, 4, 5] }) + '\n\n'
    + `Declared signal defaults: \`${JSON.stringify(TRADING_SIGNAL_DEFAULTS)}\`. Parameters are explicit inputs and can be retained in the run manifest; these defaults claim no optimum.\n\n`
    + report.limitations.map(l => `- ${l}`).join('\n') + '\n';
}
