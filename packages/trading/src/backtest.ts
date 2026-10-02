/** Point-in-time model receipts feed the existing chronological financial executor. */
import { equalsJson } from '@jarenjs/core/object';
import { runStrategy, ZERO_TRADING_SPEND, type TradingStrategyDecisions } from './strategy.ts';
import { buildSnapshot, type TradingSnapshotBundle } from './snapshot.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { toOrderIntent } from './order.ts';
import { immutableTradingJson } from './identity.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingDecisionRun } from './decision-runner.ts';
import type { TradingStore, TradingWriteReceipt } from './store.ts';
import type { TradingProviders } from './providers.ts';
import type { TradingStrategyData, TradingStrategyResult, TradingRunManifest, PortfolioSnapshot, Observation, TradingDecisionResult,
  TradeProposal, RiskVerdict, FundManagerDecision, TradingIssue, TradingSpend } from './contracts.gen.ts';

export interface TradingBacktestDecisionInput {
  manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; portfolio: PortfolioSnapshot; providers: TradingProviders; valuationObservations: Observation[];
}
export interface TradingBacktestInput extends TradingStrategyData {
  store: TradingStore; providers: TradingProviders;
  decide: (input: TradingBacktestDecisionInput) => Promise<TradingOutcome<TradingDecisionRun>>;
  /** Host crash probe after native completion and before retaining the decision receipt. */
  afterDecision?: (run: TradingDecisionRun) => void | Promise<void>;
}
export async function runBacktest(input: TradingBacktestInput): Promise<TradingOutcome<TradingStrategyResult>> {
  if (input.manifest.executionPolicy?.kind !== 'agent') return tradingRefuse('TTRD1001', '/executionPolicy', 'An agent backtest requires its declared immutable policy');
  const { store, providers, decide, afterDecision, ...data } = input;
  let writes = 0;
  const retained = (outcome: TradingOutcome<TradingWriteReceipt>) => { if (outcome.valid) writes += outcome.value.writes; return outcome; };
  const decisions: TradingStrategyDecisions = async context => {
    const key = { manifestId: data.manifest.id, asset: context.asset, sessionId: context.session.key, stage: 'model-decision' };
    const prior = await store.list('results', { kind: 'decision-result', key });
    if (prior.length) {
      if (prior.length !== 1 || prior[0].kind !== 'decision-result' || prior[0].portfolioId !== context.portfolioId)
        return tradingRefuse('TTRD1006', '/decision-result', 'Retained model decision differs from its frozen close portfolio');
      const valid = await validateTradingRecord(prior[0]); if (!valid.valid) return valid;
      for (const id of prior[0].artifactIds) if (!await store.get('artifacts', id)) return tradingRefuse('TTRD1006', '/artifactIds', 'A retained decision lost its stage evidence');
      return { valid: true, value: prior[0] };
    }
    const portfolio = await store.get('portfolios', context.portfolioId);
    if (!portfolio) return tradingRefuse('TTRD1006', '/portfolioId', 'The decision-time portfolio must be retained');
    const save = async (value: Omit<TradingDecisionResult, 'id' | 'revision' | 'kind' | 'manifestId' | 'key' | 'portfolioId'>) => {
      const result = await createTradingRecord('decision-result', { ...value, manifestId: data.manifest.id, key, portfolioId: portfolio.id });
      if (!result.valid) return result;
      const saved = retained(await store.put('results', result.value)); return saved.valid ? result : saved;
    };
    const failed = (errors: TradingIssue[], snapshotId: string | null = null, runId: string | null = null, spend: TradingSpend = ZERO_TRADING_SPEND) =>
      save({ status: 'failed', snapshotId, runId, admission: null, artifactIds: [], valuationObservationIds: [], errors, spend });
    const snapshot = await buildSnapshot({ manifest: data.manifest, asset: context.asset, session: context.session, portfolio, providers });
    if (!snapshot.valid) return failed(snapshot.issues);
    for (const observation of snapshot.value.observations) { const saved = retained(await store.put('observations', observation)); if (!saved.valid) return saved; }
    const savedSnapshot = retained(await store.put('snapshots', snapshot.value.snapshot)); if (!savedSnapshot.valid) return savedSnapshot;
    if (snapshot.value.snapshot.providerErrors.length) return failed(snapshot.value.snapshot.providerErrors, snapshot.value.snapshot.id);
    const valuationObservations: Observation[] = [];
    for (const position of portfolio.positions) if (position.asset !== context.asset && position.quantity > 0) {
      const other = await buildSnapshot({ manifest: data.manifest, asset: position.asset, session: context.session, portfolio, providers });
      if (!other.valid) return failed(other.issues, snapshot.value.snapshot.id);
      const priceErrors = other.value.snapshot.providerErrors.filter(e => e.path.startsWith('/providers/market'));
      if (priceErrors.length) return failed(priceErrors, snapshot.value.snapshot.id);
      valuationObservations.push(...other.value.observations.filter(o => o.kind === 'bar' || o.kind === 'corporate-action'));
    }
    for (const observation of valuationObservations) { const saved = retained(await store.put('observations', observation)); if (!saved.valid) return saved; }
    const decisionInput = { manifest: data.manifest, snapshot: snapshot.value, portfolio, providers, valuationObservations };
    const run = await decide(decisionInput); if (!run.valid) return run;
    await afterDecision?.(run.value);
    if (run.value.status === 'failed') return failed(run.value.errors, snapshot.value.snapshot.id, run.value.runId, run.value.spend);
    if (!run.value.output) return tradingRefuse('TTRD1008', '/output', 'A completed decision requires its bound artifacts and admission');
    const { artifacts, admission } = run.value.output;
    const proposal = artifacts.find((a): a is TradeProposal => a.kind === 'trade-proposal');
    const riskVerdict = artifacts.find((a): a is RiskVerdict => a.kind === 'risk-verdict');
    const decision = artifacts.find((a): a is FundManagerDecision => a.kind === 'fund-manager-decision');
    if (!proposal || !riskVerdict || !decision) return tradingRefuse('TTRD1004', '/artifacts', 'A completed decision must retain its proposal, risk verdict and manager');
    const checked = await toOrderIntent({ manifest: data.manifest, snapshot: snapshot.value, portfolio, valuationObservations, proposal, riskVerdict, decision }); if (!checked.valid) return checked;
    if (!equalsJson(admission, checked.value)) return tradingRefuse('TTRD1005', '/admission', 'The model runner cannot substitute deterministic order admission');
    for (const artifact of artifacts) { const saved = retained(await store.stageArtifact(artifact.key, artifact)); if (!saved.valid) return saved; }
    return save({ status: 'completed', snapshotId: snapshot.value.snapshot.id, runId: run.value.runId, admission, artifactIds: artifacts.map(a => a.id), valuationObservationIds: [...new Set(valuationObservations.map(o => o.id))], errors: [], spend: run.value.spend });
  };
  const result = await runStrategy({ ...data, store, decisions });
  return result.valid ? { valid: true, value: immutableTradingJson({ ...result.value, writes: result.value.writes + writes }) } : result;
}
