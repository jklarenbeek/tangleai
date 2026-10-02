/** Decision-time admission uses only published quotes; execution rechecks the actual next open. */
import { equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { prepareTradingAnalystContext } from './analysts.ts';
import { accountTradingMovements } from './accounting.ts';
import { quoteTradingOrder, tradingFillEconomics } from './broker.ts';
import { checkRiskPolicy, sizeTradingQuote } from './risk.ts';
import { checkTradingArtifactScope } from './evidence.ts';
import { proposedTradingIntent } from './risk-tasks.ts';
import { admit, snapshotBarStaleness } from './time.ts';
import { createTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { immutableTradingJson } from './identity.ts';
import { tradingIssue, tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingSnapshotBundle } from './snapshot.ts';
import type { TradingRunManifest, PortfolioSnapshot, TradeProposal, RiskVerdict, FundManagerDecision, OrderIntent, TradingDecision,
  TradingIssue, Observation, BarObservation, TradingProposedIntent, MarketSession, TradingOrderAdmission } from './contracts.gen.ts';

export interface TradingOrderInput {
  manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; portfolio: PortfolioSnapshot;
  proposal: TradeProposal; riskVerdict: RiskVerdict; decision: FundManagerDecision;
  /** Additional admitted observations for valuing other held instruments. */
  valuationObservations?: readonly Observation[];
}
interface DecisionQuote { portfolio: PortfolioSnapshot; bar: BarObservation; session: MarketSession; priceEvidenceIds: string[]; }

async function decisionQuote(input: TradingOrderInput): Promise<TradingOutcome<DecisionQuote>> {
  const prepared = await prepareTradingAnalystContext(input); if (!prepared.valid) return prepared;
  const { manifest, snapshot, portfolio } = input, at = snapshot.snapshot.cutoffAt;
  const all = new Map(snapshot.observations.map(o => [o.id, o]));
  for (const observation of input.valuationObservations ?? []) {
    if (observation.asset === snapshot.snapshot.asset && !snapshot.snapshot.observationIds.includes(observation.id))
      return tradingRefuse('TTRD1003', '/valuationObservations', 'Target quotes cannot expand the admitted decision snapshot');
    const prior = all.get(observation.id);
    if (prior && !equalsJson(prior, observation)) return tradingRefuse('TTRD1002', '/valuationObservations', 'Valuation evidence identity is inconsistent');
    all.set(observation.id, observation);
  }
  const admission = await admit([...all.values()], at); if (!admission.valid) return admission;
  if (admission.value.refused.length) return tradingRefuse('TTRD1003', '/valuationObservations', 'Valuation evidence was not available at the decision cutoff');
  if (admission.value.admitted.some(o => o.manifestId !== manifest.id || !manifest.assets.includes(o.asset)))
    return tradingRefuse('TTRD1002', '/valuationObservations', 'Valuation evidence is outside the declared portfolio');
  const session = snapshot.sessions.find(s => s.key === snapshot.snapshot.sessionId)!;
  const bars = new Map<string, BarObservation>(), priceEvidenceIds: string[] = [], marks: PortfolioSnapshot['marks'] = [];
  for (const asset of manifest.assets) {
    const observations = admission.value.admitted.filter(o => o.asset === asset), selected = observations.filter((o): o is BarObservation => o.kind === 'bar')
      .sort((a, b) => toEpoch(b.eventAt) - toEpoch(a.eventAt) || toEpoch(b.availableAt) - toEpoch(a.availableAt) || b.id.localeCompare(a.id))[0];
    const held = portfolio.positions.find(p => p.asset === asset)!.quantity;
    if (!selected) {
      if (held || asset === snapshot.snapshot.asset) return tradingRefuse('TTRD1007', '/quotes', `No admitted valuation bar for ${asset}`);
      // Unheld marks contribute exactly zero and never enter the admitted order or prompt.
      marks.push({ asset, price: portfolio.marks.find(m => m.asset === asset)!.price }); continue;
    }
    const age = snapshotBarStaleness(snapshot.sessions, session.key, [selected]); if (!age.valid) return age;
    // A post-action mark needs an observed post-action bar; do not infer unobserved market repricing.
    if (observations.some(o => o.kind === 'corporate-action' && toEpoch(o.eventAt) > toEpoch(selected.eventAt) && toEpoch(o.eventAt) <= toEpoch(at)))
      return tradingRefuse('TTRD1007', '/quotes', `No admitted post-action valuation bar for ${asset}`);
    bars.set(asset, selected); marks.push({ asset, price: selected.close }); priceEvidenceIds.push(selected.id);
  }
  const accounted = accountTradingMovements(manifest, portfolio, [], marks, session.key); if (!accounted.valid) return accounted;
  const valued = await createTradingRecord('portfolio', accounted.value.portfolio); if (!valued.valid) return valued;
  return { valid: true, value: { portfolio: valued.value, bar: bars.get(snapshot.snapshot.asset)!, session, priceEvidenceIds } };
}

export async function toOrderIntent(input: TradingOrderInput): Promise<TradingOutcome<TradingOrderAdmission>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Order admission requires finite immutable inputs', cause); }
  const { manifest, snapshot, portfolio, proposal, riskVerdict, decision } = input;
  const scope = await checkTradingArtifactScope([proposal, riskVerdict, decision], snapshot.snapshot); if (!scope.valid) return scope;
  if (decision.role !== 'trading-fund-manager' || decision.proposalId !== proposal.id || decision.riskVerdictId !== riskVerdict.id
    || decision.inputProposalId !== proposal.id || decision.inputRiskVerdictId !== riskVerdict.id || riskVerdict.proposalId !== proposal.id
    || proposal.assumedPortfolioId !== portfolio.id || !decision.finalIntent || !decision.decision || !riskVerdict.adjustedIntent)
    return tradingRefuse('TTRD1004', '/decision', 'Only the bound fund-manager decision may reach order admission');
  const finalIntent = validateTradingShape<TradingProposedIntent>('tradingProposedIntent', decision.finalIntent); if (!finalIntent.valid) return finalIntent;
  const financial = (disposition: TradingDecision['disposition'], reason: string) => createTradingRecord('decision', { manifestId: manifest.id,
    key: { ...proposal.key, stage: 'broker' }, inputRevision: portfolio.revision, disposition, artifactIds: [proposal.id, riskVerdict.id, decision.id], reason });
  const refused = async (violations: TradingIssue[], disposition: 'hold' | 'rejected' = 'rejected'): Promise<TradingOutcome<TradingOrderAdmission>> => {
    const record = await financial(disposition, violations.map(v => v.detail).join('; ') || decision.rationale);
    return record.valid ? { valid: true, value: { intent: null, decision: record.value, decisionArtifactId: decision.id, violations, adjustments: [] } } : record;
  };
  // Validate the immutable financial context even when the model abstains.
  const prepared = await prepareTradingAnalystContext(input); if (!prepared.valid) return prepared;
  if (decision.decision === 'rejected' || finalIntent.value.action === 'hold') return refused([], decision.decision === 'rejected' ? 'rejected' : 'hold');
  if (proposal.action === 'hold' || riskVerdict.adjustedIntent.action === 'hold' || finalIntent.value.action !== proposal.action
    || riskVerdict.adjustedIntent.action !== proposal.action)
    return refused([tradingIssue('TTRD1005', '/proposal/action', 'A downstream decision cannot broaden a hold, rejection or opposing proposal')]);
  const quote = await decisionQuote(input);
  if (!quote.valid) return quote.issues.every(v => v.code === 'TTRD1007') ? refused(quote.issues, 'hold') : quote;
  const { bar, session, portfolio: valued } = quote.value;
  if (!session.next) return refused([tradingIssue('TTRD1007', '/session/next', 'The declared calendar has no next execution session')], 'hold');
  const held = portfolio.positions.find(p => p.asset === proposal.asset)!.quantity;
  const quantityOf = (intent: TradingProposedIntent) => {
    if (intent.action === 'hold') return 0;
    if (intent.quantity !== undefined) return intent.quantity;
    const delta = intent.targetWeight! * valued.equity / bar.close - held;
    const quantity = intent.action === 'buy' ? delta : -delta;
    return manifest.shares === 'whole' ? Math.floor(quantity) : quantity;
  };
  const requested = quantityOf(finalIntent.value), original = quantityOf(proposedTradingIntent(proposal)), risk = quantityOf(riskVerdict.adjustedIntent);
  const violations: TradingIssue[] = [], adjustments: TradingIssue[] = [];
  const breach = (condition: boolean, path: string, detail: string) => { if (condition) violations.push(tradingIssue('TTRD1005', path, detail)); };
  breach(!(requested > 0 && original > 0 && risk > 0) || ![requested, original, risk].every(Number.isFinite), '/quantity', 'The proposed direction has no positive finite quantity');
  breach(requested > original || requested > risk, '/proposal/quantity', 'A downstream decision cannot increase the trader or risk size');
  breach(manifest.shares === 'whole' && !Number.isSafeInteger(requested), '/shares', 'Whole-share admission requires integer quantities');
  breach(!manifest.riskPolicy.instruments.includes(proposal.asset), '/riskPolicy/instruments', 'Instrument is outside the declared policy');
  breach(!manifest.riskPolicy.orderKinds.includes('market'), '/riskPolicy/orderKinds', 'Market orders are outside the declared policy');
  breach(finalIntent.value.action === 'sell' && requested > held, '/shorting', 'A sale cannot exceed the retained long position');
  breach(requested > bar.volume * manifest.riskPolicy.maxParticipation, '/riskPolicy/maxParticipation', 'Quantity exceeds the declared share of observed session volume');
  const cost = tradingFillEconomics(manifest, bar.close, finalIntent.value.action, requested);
  breach(finalIntent.value.action === 'buy' && cost.notional + cost.commission > portfolio.cash, '/riskPolicy/cashFloor', 'The requested purchase overspends retained cash');
  const modified = decision.decision === 'modified';
  if (violations.length && (!modified || violations.some(v => ['/quantity', '/riskPolicy/instruments', '/riskPolicy/orderKinds'].includes(v.path)))) return refused(violations);
  let quantity = modified ? Math.min(requested, original, risk) : requested;
  if (modified && manifest.shares === 'whole') quantity = Math.floor(quantity);
  if (!(quantity > 0)) return refused(violations.length ? violations : [tradingIssue('TTRD1005', '/quantity', 'No positive permitted quantity')]);
  const accepted = await financial('approved', decision.rationale); if (!accepted.valid) return accepted;
  const build = (quantity: number) => createTradingRecord('order', { manifestId: manifest.id, decisionId: accepted.value.id, asset: proposal.asset,
    decisionSessionId: session.key, fillSessionId: session.next!, side: finalIntent.value.action as 'buy' | 'sell', quantity, orderKind: 'market', limitPrice: null, stopPrice: null,
    provenance: { proposalId: proposal.id, riskVerdictId: riskVerdict.id, decisionId: decision.id }, priceEvidenceIds: quote.value.priceEvidenceIds });
  let intent = await build(quantity); if (!intent.valid) return intent;
  const dry = (candidate: OrderIntent) => quoteTradingOrder({ manifest, portfolio: valued, intent: candidate, bar, price: bar.close, sessionId: session.key });
  const trial = await dry(intent.value);
  const policyIssues = trial.valid ? checkRiskPolicy({ manifest, portfolioAfter: trial.value.portfolio, intent: intent.value, sessionBar: bar }) : trial.issues;
  if (policyIssues.length && !modified) return refused([...violations, ...policyIssues]);
  if (modified) {
    const sizing = await sizeTradingQuote({ manifest, portfolio: valued, intent: intent.value, bar, session, price: bar.close, quote: dry }); if (!sizing.valid) return sizing;
    if (sizing.value.disposition === 'hold') return refused([...violations, ...policyIssues, ...sizing.value.issues]);
    quantity = sizing.value.quantity; intent = await build(quantity); if (!intent.valid) return intent;
    if (quantity < requested) adjustments.push(...violations, ...policyIssues, ...sizing.value.adjustments ?? [], tradingIssue('TTRD1005', '/quantity', `Reduced requested quantity ${requested} to permitted quantity ${quantity}`));
  }
  return { valid: true, value: { intent: intent.value, decision: accepted.value, decisionArtifactId: decision.id, violations: [], adjustments } };
}
