/** Deterministic financial and model-mechanism execution with explicit live exclusions. */
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
import { measureTradingExecutions, measureTradingExecutionDiagnostics } from './trading-execution.ts';
import { measureTradingAblations } from './trading-ablations.ts';
import { measureTradingPaperProfile } from './trading-paper.ts';
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
  'The scripted end-to-end strategy buys two shares when unheld and otherwise holds. It follows every model stage, with first-round research agreement and risk adjustment; this measures mechanism, not strategy improvement.',
  'Live model quality, external historical replay and operational parity are not measured. No network request is made.',
  'The paper reports a January-March 2024 backtest using heterogeneous public and proprietary sources. No licensed historical replay corpus has been decided here, so every paper-profile row remains not-run.',
  'The paper notes about eleven model requests and more than twenty tool calls per prediction and a three-month evaluation constrained by cost. Those figures and its reported returns are context, never fixture goldens.',
  'Registered ablations share one execution manifest and fixed calendar subset, source observations, scripted model and declared ceilings. Subsequent snapshot identities may differ because each workflow retains its own causal portfolio and decision artifacts.',
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
  return sourceManifest(TRADING_ROOT, ['package.json', 'package-lock.json', 'benchmark/trading.ts', 'benchmark/lib/trading-cli.ts', 'benchmark/scripts/trading-fixture.ts',
    'benchmark/schemas/trading.schema.json', 'benchmark/lib/trading.types.ts', 'benchmark/lib/trading.ts', 'benchmark/lib/trading-metrics.ts',
    'benchmark/lib/trading-report.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts', 'benchmark/lib/report-envelope.ts',
    'benchmark/lib/args.ts', 'benchmark/lib/table.ts', 'test/benchmark/trading.test.ts', 'test/benchmark/trading-cli.test.ts', 'benchmark/lib/trading-mechanisms.ts',
    'benchmark/scripts/trading-indicator-fixtures.py', 'test/fixtures/trading-indicators.json', 'benchmark/lib/trading-execution.ts',
    'benchmark/lib/trading-analyst-runner.ts', 'benchmark/lib/trading-analysts.ts', 'benchmark/lib/trading-research-runner.ts', 'benchmark/lib/trading-research.ts', 'benchmark/lib/gmpl-runner.ts',
    'benchmark/lib/trading-agent.ts', 'benchmark/lib/trading-agent-runner.ts', 'benchmark/lib/trading-scripts.ts',
    'benchmark/lib/trading-ablations.ts', 'benchmark/lib/trading-ablation-workflow.ts', 'benchmark/lib/trading-single-agent.ts',
    'benchmark/lib/trading-diagnostics.ts', 'test/benchmark/trading-health.test.ts', 'test/benchmark/trading-diagnostics.test.ts',
    'benchmark/lib/trading-paper.ts', 'benchmark/lib/trading-live.ts', 'test/benchmark/trading-ablations.test.ts', 'test/benchmark/trading-live.test.ts',
    'benchmark/lib/ai-env.ts', 'benchmark/lib/wire-cache.ts',
    'benchmark/lib/trading-risk-runner.ts', 'benchmark/lib/trading-risk.ts', 'benchmark/lib/trading-policy-probes.ts',
    'scripts/trading-artifacts.ts', 'scripts/trading-sources.ts', 'test/fixtures/trading-prompts.json'],
  ['benchmark/fixtures/trading', 'packages/trading', 'test/trading', 'prompts/trading', 'packages/gmpl', 'packages/mas', 'packages/store', 'packages/agents', 'packages/models', 'packages/context', 'packages/config', 'packages/core']);
}
export async function buildTradingReport(options: { source?: Source } = {}): Promise<Trading> {
  const fixture = await loadTradingFixture(), rows = await tradingControlRows(fixture), poison = await auditTradingPoison(fixture), mechanisms = await measureTradingMechanisms(fixture);
  const payload: Omit<Trading, 'reportId'> = { instrument: 'trading', version: 1, source: options.source ?? await tradingSource(),
    suite: { tangle: rootPackage.version, jaren: jarenPackage.version }, fixture: { id: fixture.manifest.id, sha256: fixture.sha256, licence: fixture.manifest.licence },
    registration: fixture.strategies, conventions: tradingConventions(fixture.manifest), rows, poison, mechanisms, counts: tradingCounts(rows), capabilities: tradingCapabilities(rows, poison, mechanisms),
    identity: analyticEnvelope(rows.map(r => r.id)) as Trading['identity'], limitations: LIMITATIONS,
    paper: await measureTradingPaperProfile(), live: { status: 'not-run', reason: 'no spend approval', fresh: 0, replayed: 0 }, ablations: await measureTradingAblations(fixture),
    executionDiagnostics: await measureTradingExecutionDiagnostics(fixture) };
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
  same(report.paper, await measureTradingPaperProfile(), 'licensed paper profile registration and row coverage');
  same(report.live, { status: 'not-run', reason: 'no spend approval', fresh: 0, replayed: 0 }, 'keyless live exclusion');
  same(report.ablations, await measureTradingAblations(loaded), 'paired native ablation measurements and signed deltas');
  same(report.executionDiagnostics, await measureTradingExecutionDiagnostics(loaded), 'turnover, exposure and retained session diagnostics');
  return { valid: errors.length === 0, errors };
}
export function requireCapability(report: Trading, capability: string): void {
  if (!Object.hasOwn(report.capabilities, capability)) throw new Error(`Unknown trading capability: ${capability}`);
  if (!report.capabilities[capability as keyof Capabilities]) throw new Error(`Trading capability unavailable: ${capability}`);
}
export function renderReport(report: Trading): string { return JSON.stringify(report, null, 2) + '\n'; }
function renderTradingComparisons(report: Trading): string {
  const a = report.ablations, signed = (value: number | null) => value === null ? null : `${value > 0 ? '+' : ''}${value}`;
  return `## Registered workflow ablations\n\nRegistration SHA-256 \`${a.registrationSha256}\`; shared comparison \`${a.comparisonId}\`. Sessions: ${a.sessions.join(', ')}; assets: ${a.assets.join(', ')}. Every row uses execution manifest \`${a.runs[0].manifestId}\`.\n\n`
    + table({ head: ['Workflow', 'Status', 'Decisions', 'Incomplete', 'CR', 'AR', 'Sharpe', 'MDD', 'Fills', 'Rejected', 'Refused observations', 'Calls', 'Tokens', 'Repairs', 'Execution costs USD'],
      rows: a.runs.map(r => [r.id, r.status, r.decisionCount, r.incompleteDecisions, pct(r.metrics.cr, 6), pct(r.metrics.ar, 6), r.metrics.sharpe?.toFixed(6) ?? null,
        pct(r.metrics.mdd, 6), r.transactions, r.rejectedOrders, r.refusedObservations, r.physicalCalls, r.spend.tokens, r.repairs, r.costs.total.toFixed(8)]), numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] })
    + '\n\n' + table({ head: ['Workflow', 'Asset', 'CR', 'MDD', 'Fills'], rows: a.runs.flatMap(r => r.perAsset.map(p => [r.id, p.asset, pct(p.cr, 6), pct(p.mdd, 6), p.fills])), numeric: [2, 3, 4] })
    + '\n\n' + table({ head: ['Ablation minus full', 'Eligible', 'CR delta', 'AR delta', 'Sharpe delta', 'MDD delta', 'Calls delta', 'Tokens delta', 'Model USD delta', 'Execution cost delta'],
      rows: a.comparisons.map(c => [c.id, c.eligible ? 'yes' : c.reason, ...(['cr', 'ar', 'sharpe', 'mdd', 'calls', 'tokens', 'modelUsd', 'executionCosts'] as const).map(k => signed(c.delta[k]))]), numeric: [2, 3, 4, 5, 6, 7, 8, 9] })
    + '\n\n' + a.runs.map(r => `- ${r.id}: ${r.spend.toolCalls} tool calls, USD ${r.spend.usd}, ${r.spend.retries} retries, ${r.replayWrites} replay writes and ${r.replayPhysicalCalls} replay requests; issues ${r.issuesByCode.map(i => `${i.code}=${i.count}`).join(', ') || 'none'}; undefined metrics ${r.undefined.map(u => `${u.metric}: ${u.reason}`).join('; ') || 'none'}.`).join('\n')
    + '\n\nThe single-agent intervention has one model role and one structured result, charged once on its final decision artifact. Research and risk artifacts are explicitly unreviewed deterministic projections. The other interventions omit only the named team and retain the remaining native roles. Every workflow reaches the same hard financial policy. Equal scripted returns establish no real-model quality advantage. Eligibility requires equal starting inputs, model, ceilings and completed decision denominators; no ineligible row enters an aggregate.\n\n'
    + `## Paper replay and live state\n\nPaper registration \`${report.paper.registration.id}\`, SHA-256 \`${report.paper.sha256}\`: **${report.paper.registration.reason}**. The corpus, runtime manifest and licence decision are null; no historical data is invented.\n\n`
    + table({ head: ['Paper row', 'Tier', 'Status', 'Reason', 'Sessions', 'Calls', 'Costs USD', 'Eligible'], rows: report.paper.rows.map(r => [r.id, r.parityTier, r.status, r.reason, r.sessions, r.modelCalls, r.costs.total, 'no']), numeric: [4, 5, 6] })
    + '\n\n`--profile paper` reproduces this same combined report and the decided unavailable state. `--live` prints a credential-free plan; exact `--authorize <planId>` is checked before any action. Missing keys are an explicit skip. No eligible corpus means zero request keys, exact cache hits and maximum fresh calls for every role. No live result file is written without a run.\n\n'
    + 'The [TradingAgents paper](refs/2412.20138v7.pdf), sections 5-6 and S1, describes January 1-March 29, 2024 and mixed public/proprietary sources. Table 1 reports cumulative returns of 26.62% for AAPL, 24.36% for GOOGL and 23.21% for AMZN. Its footnote records roughly eleven model requests and more than twenty tool calls per prediction, and cost-limited three-month coverage. This report neither reproduces nor contests those results. The local synthetic mechanism tier is separate from historical experimental parity and operational deployment.\n\n';
}
export function renderDocument(report: Trading): string {
  return `# Trading mechanism benchmark\n\nGenerated by \`npm run benchmark:trading\`. Report \`${report.reportId}\`; source \`${report.source.sha256}\`. Suite ${report.suite.tangle}; Jaren ${report.suite.jaren}.\n\n`
    + `Fixture \`${report.fixture.id}\` (${report.fixture.licence}), identity \`${report.fixture.sha256}\`. Two fictional assets; SYNX sessions from 2025-01-02 through 2025-06-30 with four declared holidays. Initial capital USD 100,000; whole shares, long only, next-open fills, 5 bps commission and 5 bps slippage.\n\n`
    + `Periodicity: ${report.conventions.periodicity}; ${report.conventions.sessionsPerYear} sessions/year; risk-free ${report.conventions.riskFree.kind} (${report.conventions.riskFree.perSession} per session); annualization sqrt(${report.conventions.sessionsPerYear}) = ${report.conventions.annualization}. The equity curve includes the initial cash mark.\n\n`
    + table({ head: ['Metric', 'Declared formula'], rows: Object.entries(report.conventions.formulas), numeric: [] }) + '\n\n'
    + table({ head: ['Row', 'Tier', 'Status', 'Eligible', 'CR', 'AR', 'Sharpe', 'MDD', 'Fills', 'Rejected', 'Refused observations', 'Costs USD'],
      rows: report.rows.map(r => [r.id, r.parityTier === 'experimental' ? 'experimental (fixture)' : r.parityTier, r.status, r.eligibility.eligible ? 'yes' : 'no', pct(r.metrics?.cr ?? null, 4), pct(r.metrics?.ar ?? null, 4),
        r.metrics?.sharpe?.toFixed(6) ?? null, pct(r.metrics?.mdd ?? null, 4), r.transactions, r.rejectedOrders, r.refusedObservations, r.metrics ? r.costs.total.toFixed(6) : null]), numeric: [4, 5, 6, 7, 8, 9, 10, 11] })
    + '\n\n' + table({ head: ['Row', 'Asset', 'CR', 'MDD', 'Fills'], rows: report.rows.flatMap(r => r.perAsset.map(a => [r.id, a.asset, pct(a.cr, 4), pct(a.mdd, 4), a.fills])), numeric: [2, 3, 4] })
    + '\n\n' + table({ head: ['Execution row', 'Decisions', 'Stale close marks', 'Replay writes'], rows: report.rows.filter(r => r.execution).map(r => [r.id, r.execution!.decisionCount, r.execution!.staleMarks, r.execution!.replayWrites]), numeric: [1, 2, 3] })
    + '\n\n' + table({ head: ['Execution row', 'Sessions retained / expected', 'Missing sessions', 'Failed asset sessions', 'Refused asset sessions', 'Turnover', 'Mean gross exposure', 'Peak gross exposure'],
      rows: report.executionDiagnostics.map(d => [d.id, `${d.retainedSessions}/${d.expectedSessions}`, d.missingSessions, d.failedAssetSessions, d.refusedAssetSessions,
        d.turnover.toFixed(8), d.meanGrossExposure.toFixed(8), d.peakGrossExposure.toFixed(8)]), numeric: [2, 3, 4, 5, 6, 7] })
    + '\n\nTurnover is total filled notional divided by initial capital. Gross exposure is the retained position value divided by equity; mean and peak use the close portfolios, excluding the initial cash point. Refused sessions remain counted.\n\n'
    + '\n\n' + table({ head: ['Agent row', 'Decisions', 'Completed', 'Failed', 'Calls', 'Normalizations', 'Repairs', 'Replays', 'Restores', 'Replay calls'], rows: report.rows.filter(r => r.agent).map(r => [r.id, r.agent!.decisionCount, r.agent!.completed, r.agent!.failed, r.agent!.physicalCalls, r.agent!.normalizations, r.agent!.repairs, r.agent!.replays, r.agent!.restores, r.agent!.replayPhysicalCalls]), numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
    + '\n\n' + report.rows.filter(r => r.agent).map(r => `Agent spend: ${r.agent!.spend.tokens} tokens, ${r.agent!.spend.toolCalls} tool calls, ${r.agent!.spend.retries} retries, USD ${r.agent!.spend.usd}; failures by code: ${r.agent!.failuresByCode.length ? r.agent!.failuresByCode.map(f => `${f.code}=${f.count}`).join(', ') : 'none'}; all decision and admission issues: ${r.agent!.issuesByCode.length ? r.agent!.issuesByCode.map(f => `${f.code}=${f.count}`).join(', ') : 'none'}. The actual second backtest changes zero rows and makes zero additional physical requests.\n\n`).join('')
    + '\n\n' + report.rows.filter(r => r.reason || r.undefined.length).map(r => `- ${r.id}: ${[r.reason, ...r.undefined.map(u => `${u.metric}: ${u.reason}`)].filter(Boolean).join('; ')}.`).join('\n')
    + `\n\nPoison audit: ${count(report.poison.cutoffs)} decision cutoffs, ${count(report.poison.refused)} refused observation/cutoff pairs, ${report.poison.influenced} changed pre-cutoff slices. Full admitted values, latest bars, price windows and returns are compared, with all paired hashes retained.\n\n`
    + `${report.counts.measured}/${report.counts.registered} registered rows measured; ${report.counts.excluded} excluded, ${report.counts.implementationMissing} implementation-missing, ${report.counts.notRun} not-run. No aggregate combines the excluded control with eligible rows.\n\n`
    + renderTradingComparisons(report)
    + `Baseline and control targets enter with at most 100 whole shares; the scripted agent requests two shares when unheld. They exit the held quantity; policy can only reduce a proposed quantity. Hard ceilings: gross/net exposure 1, single-name 0.6, participation 0.01, loss 0.2, cash floor USD 0. Only market orders in the declared two assets are allowed. Corporate actions settle once at the open; missing close bars retain prior marks and are counted. No terminal liquidation is forced.\n\n`
    + `Calculation rows are counted separately from the ten execution strategies.\n\n`
    + table({ head: ['Mechanism', 'Status', 'Reproduced', 'Total'], rows: report.mechanisms.rows.map(r => [r.id, r.status, r.reproduced, r.total]), numeric: [2, 3] }) + '\n\n'
    + report.mechanisms.rows.filter(r => r.id === 'analysts-scripted').map(r => `Analyst mechanism: ${r.reports} reports across ${r.total} asset/session cases; ${r.resolved}/${r.citations} citations resolve inside the role projection. Native MAS execution observed ${r.physicalCalls} physical calls, ${r.normalizations} normalizations, ${r.repairs} repairs, and ${r.refusedToolRequests}/${r.toolRequests} refused after-cutoff tool requests. All cases freeze the same cash-only portfolio and execute the four lanes concurrently. This is a scripted mechanism test with no investment-quality or entailment claim.\n\n` + table({ head: ['Analyst safety probe', 'Passed', 'Physical calls', 'Repairs', 'Failed attempts'], rows: r.probes.map(p => [p.id, p.passed ? 'yes' : 'no', p.physicalCalls, p.repairs, p.refusals]), numeric: [2, 3, 4] }) + '\n\n').join('')
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
