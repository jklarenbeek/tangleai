/** One chronological execution loop for target policies and explicit analytic controls. */
import { toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson, tradingRevisionOf } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { sessionIndex, admitValidatedTradingObservations } from './time.ts';
import { planFill } from './broker.ts';
import { sizeToPolicy } from './risk.ts';
import { markPortfolio, applyCorporateActions } from './portfolio.ts';
import { accountTradingMovements, tradingActionKey } from './accounting.ts';
import { tradingIssue, tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingStore, TradingWriteReceipt } from './store.ts';
import type { TradingStrategyData, TradingStrategyContext, TradingStrategySignal, TradingStrategySignalOutcome, TradingStrategyResult, TradingIssue,
  BarObservation, PortfolioSnapshot, TradingDayResult, Fill, TradingCommit, TradingSpend } from './contracts.gen.ts';

export type TradingStrategySignals = (context: Readonly<TradingStrategyContext>) => TradingOutcome<TradingStrategySignal | null> | Promise<TradingOutcome<TradingStrategySignal | null>>;
export interface TradingStrategyInput extends TradingStrategyData { store: TradingStore; signals?: TradingStrategySignals; }
const ZERO_SPEND: TradingSpend = Object.freeze({ calls: 0, toolCalls: 0, tokens: 0, usd: 0, retries: 0, repairs: 0, ms: 0 });
interface PendingSignal { signal: TradingStrategySignal | null; inputRevision: string; issues: TradingIssue[]; }
const barOrder = (a: BarObservation, b: BarObservation) => toEpoch(a.eventAt) - toEpoch(b.eventAt)
  || toEpoch(a.availableAt) - toEpoch(b.availableAt) || a.id.localeCompare(b.id);

/** One latest eligible revision per session, ordered by event time, never publication order. */
export function tradingSignalBars(bars: readonly BarObservation[]): BarObservation[] {
  const selected = new Map<string, BarObservation>();
  for (const bar of [...bars].sort(barOrder)) selected.set(`${bar.asset}/${bar.sessionId}`, bar);
  return [...selected.values()].sort(barOrder);
}

export async function runStrategy(input: TradingStrategyInput): Promise<TradingOutcome<TradingStrategyResult>> {
  if (!input || typeof input !== 'object' || !input.store?.atomic) return tradingRefuse('TTRD1001', '/store', 'An atomic trading store is required');
  const { store, signals, ...data } = input;
  const shape = validateTradingShape<TradingStrategyData>('tradingStrategyData', data); if (!shape.valid) return shape;
  const { manifest, sessions, bars, actions, observations } = shape.value, policy = manifest.executionPolicy;
  if (!policy) return tradingRefuse('TTRD1001', '/manifest/executionPolicy', 'A strategy must be bound in its immutable manifest');
  if ((policy.kind === 'oracle' || policy.kind === 'leaky') && manifest.mode !== 'fixture') return tradingRefuse('TTRD1009', '/manifest/mode', 'Privileged and excluded controls require fixture mode');
  if ((policy.kind === 'signals' || policy.kind === 'leaky') && typeof signals !== 'function') return tradingRefuse('TTRD1001', '/signals', 'The declared target policy requires an injected signal function');
  const calendar = await sessionIndex(sessions); if (!calendar.valid) return calendar;
  if (!sessions.length || sessions[0].key !== manifest.sessionRange.first || sessions.at(-1)!.key !== manifest.sessionRange.last
    || sessions.some((s, i) => s.id !== calendar.value.sessions[i].id || s.manifestId !== manifest.id || s.calendar !== manifest.calendar))
    return tradingRefuse('TTRD1003', '/sessions', 'Execution requires the complete declared chronological calendar');
  const corpus = [...bars, ...actions, ...observations];
  if (new Set(corpus.map(o => o.id)).size !== corpus.length) return tradingRefuse('TTRD1001', '/observations', 'The input corpus repeats an observation identity');
  for (const record of [manifest, ...corpus]) {
    const valid = await validateTradingRecord(record); if (!valid.valid) return valid;
    if (record.kind !== 'manifest' && (record.manifestId !== manifest.id || !manifest.assets.includes(record.asset))) return tradingRefuse('TTRD1002', '/observations', 'Observation crosses a run or asset boundary');
  }
  for (const bar of bars) {
    const session = sessions.find(s => s.key === bar.sessionId);
    if (!session || toEpoch(session.closeAt) !== toEpoch(bar.eventAt)) return tradingRefuse('TTRD1003', '/bars', 'Execution bars must name their actual session close');
  }
  for (const action of actions) {
    const session = sessions.find(s => s.key === action.sessionId);
    if (!session || toEpoch(action.eventAt) !== toEpoch(session.openAt) || toEpoch(action.availableAt) > toEpoch(session.openAt))
      return tradingRefuse('TTRD1003', '/actions', 'Execution requires corporate actions published by their known ex-session open');
  }
  if (new Set(actions.map(tradingActionKey)).size !== actions.length)
    return tradingRefuse('TTRD1006', '/actions', 'Execution requires one selected revision of each economic corporate action');
  const executionBars = (sessionId: string) => manifest.assets.flatMap(asset => {
    const bar = bars.filter(b => b.asset === asset && b.sessionId === sessionId).sort(barOrder)[0]; return bar ? [bar] : [];
  });
  let writes = 0, rejectedOrders = 0, refusedObservations = 0, staleMarks = 0;
  const retained = (outcome: TradingOutcome<TradingWriteReceipt>) => { if (outcome.valid) writes += outcome.value.writes; return outcome; };
  const putManifest = retained(await store.put('manifests', manifest)); if (!putManifest.valid) return putManifest;
  for (const session of sessions) { const saved = retained(await store.put('sessions', session)); if (!saved.valid) return saved; }
  for (const observation of corpus) { const saved = retained(await store.put('observations', observation)); if (!saved.valid) return saved; }
  const initial = await createTradingRecord('portfolio', { manifestId: manifest.id, parentId: null, sequence: 0, cash: manifest.initialCapital,
    positions: manifest.assets.map(asset => ({ asset, quantity: 0, costBasis: 0, cashFlow: 0, realizedPnl: 0 })),
    marks: manifest.assets.map(asset => ({ asset, price: executionBars(sessions[0].key).find(b => b.asset === asset)?.open ?? 1 })),
    equity: manifest.initialCapital, grossExposure: 0, netExposure: 0, concentration: manifest.assets.map(asset => ({ asset, fraction: 0 })),
    realizedPnl: 0, unrealizedPnl: 0, asOfSessionId: null });
  if (!initial.valid) return initial;
  const initialized = retained(await store.initializePortfolio(initial.value)); if (!initialized.valid) return initialized;
  let portfolio: PortfolioSnapshot = initial.value;
  const portfolios = [portfolio], fills: Fill[] = [], days: TradingDayResult[] = [];
  let pending = new Map<string, PendingSignal>();
  for (const [index, session] of sessions.entries()) {
    const dayFills: Fill[] = [], dayErrors = new Map<string, TradingIssue[]>(), currentBars = executionBars(session.key);
    for (const asset of manifest.assets) {
      const due = actions.filter(a => a.asset === asset && a.sessionId === session.key && toEpoch(a.availableAt) <= toEpoch(session.openAt)).sort((a, b) => a.id.localeCompare(b.id));
      if (due.length) {
        const applied = await applyCorporateActions({ manifest, portfolio, session, actions: due }); if (!applied.valid) return applied;
        const key = { manifestId: manifest.id, asset, sessionId: session.key, stage: 'corporate-action' };
        const decision = await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: portfolio.revision, disposition: 'hold', artifactIds: [], reason: 'Opening corporate entitlements' });
        if (!decision.valid) return decision;
        const committed = retained(await store.commitDecision({ mode: 'settlement', key, expectedPortfolioId: portfolio.id, decision: decision.value,
          intent: null, fills: [], ledgerEntries: applied.value.ledgerEntries, portfolio: applied.value.portfolio, markBarIds: [], actionIds: applied.value.actionIds }));
        if (!committed.valid) return committed; portfolio = applied.value.portfolio;
      }
      const target = pending.get(asset);
      if (!target || !index) continue;
      const position = portfolio.positions.find(p => p.asset === asset)!;
      const quantity = target.signal?.target === 'flat' ? position.quantity : target.signal?.target === 'long' && !position.quantity ? policy.entryQuantity : 0;
      const key = { manifestId: manifest.id, asset, sessionId: sessions[index - 1].key, stage: 'broker' };
      let errors = [...target.issues];
      let decision = await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: target.inputRevision,
        disposition: errors.length ? 'rejected' : quantity ? 'approved' : 'hold', artifactIds: [], reason: policy.kind === 'oracle' ? 'Privileged oracle target' : 'Declared target policy' });
      if (!decision.valid) return decision;
      const accounted = accountTradingMovements(manifest, portfolio, [], portfolio.marks, session.key); if (!accounted.valid) return accounted;
      const carry = await createTradingRecord('portfolio', accounted.value.portfolio); if (!carry.valid) return carry;
      const plan: TradingCommit = { mode: 'trade', key, expectedPortfolioId: portfolio.id, decision: decision.value, intent: null, fills: [], ledgerEntries: [],
        portfolio: carry.value, markBarIds: [], actionIds: [] };
      if (quantity && !errors.length) {
        const order = await createTradingRecord('order', { manifestId: manifest.id, decisionId: decision.value.id, asset, decisionSessionId: key.sessionId,
          fillSessionId: session.key, orderKind: 'market', side: target.signal!.target === 'long' ? 'buy' : 'sell', quantity, limitPrice: null, stopPrice: null });
        if (!order.valid) return order;
        const bar = currentBars.find(b => b.asset === asset) ?? null;
        const sizing = await sizeToPolicy({ manifest, portfolio, intent: order.value, session, bar });
        if (!sizing.valid) errors = sizing.issues;
        else if (sizing.value.disposition === 'hold') errors = sizing.value.issues;
        else {
          const { id: _id, revision: _revision, kind: _kind, ...body } = order.value;
          const intent = await createTradingRecord('order', { ...body, quantity: sizing.value.quantity }); if (!intent.valid) return intent;
          const filled = await planFill({ manifest, portfolio, intent: intent.value, session, bar });
          if (!filled.valid) errors = filled.issues;
          else { plan.intent = intent.value; plan.fills = [filled.value.fill]; plan.ledgerEntries = filled.value.ledgerEntries; plan.portfolio = filled.value.portfolio; plan.markBarIds = [filled.value.fill.sourceBarId]; }
        }
      }
      if (errors.length) {
        rejectedOrders++;
        decision = await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: target.inputRevision, disposition: 'rejected', artifactIds: [], reason: errors.map(e => `${e.code} ${e.path}: ${e.detail}`).join('; ') });
        if (!decision.valid) return decision; plan.decision = decision.value;
      }
      const committed = retained(await store.commitDecision(plan)); if (!committed.valid) return committed;
      portfolio = plan.portfolio; fills.push(...plan.fills); dayFills.push(...plan.fills); dayErrors.set(asset, errors);
    }
    const marked = await markPortfolio({ manifest, portfolio, session, bars: currentBars }); if (!marked.valid) return marked;
    const key = { manifestId: manifest.id, asset: manifest.assets[0], sessionId: session.key, stage: 'valuation' };
    const decision = await createTradingRecord('decision', { manifestId: manifest.id, key, inputRevision: portfolio.revision, disposition: 'hold', artifactIds: [], reason: 'Session close valuation' });
    if (!decision.valid) return decision;
    const committed = retained(await store.commitDecision({ mode: 'valuation', key, expectedPortfolioId: portfolio.id, decision: decision.value,
      intent: null, fills: [], ledgerEntries: [], portfolio: marked.value.portfolio, markBarIds: currentBars.map(b => b.id), actionIds: [] }));
    if (!committed.valid) return committed;
    portfolio = marked.value.portfolio; portfolios.push(portfolio); staleMarks += marked.value.staleMarks;
    for (const asset of manifest.assets) {
      const errors = dayErrors.get(asset) ?? [];
      const day = await createTradingRecord('day-result', { manifestId: manifest.id, asset, sessionId: session.key, status: errors.length ? 'refused' : 'completed', stopReason: errors[0]?.detail ?? null,
        artifactIds: [], fillIds: dayFills.filter(f => f.asset === asset).map(f => f.id), portfolioId: portfolio.id, spend: ZERO_SPEND, errors });
      if (!day.valid) return day;
      const saved = retained(await store.put('results', day.value)); if (!saved.valid) return saved; days.push(day.value);
    }
    pending = new Map();
    if (!session.next) continue;
    // All contexts capture the same close-time financial state before any next-open fill.
    for (const asset of manifest.assets) {
      const admitted = admitValidatedTradingObservations(corpus.filter(o => o.asset === asset), toEpoch(session.closeAt));
      refusedObservations += admitted.refused.length;
      const eligible = admitted.admitted;
      const context: TradingStrategyContext = immutableTradingJson({ asset, session, bars: tradingSignalBars(eligible.filter((o): o is BarObservation => o.kind === 'bar')),
        observations: eligible, portfolioId: portfolio.id, cash: portfolio.cash, positions: portfolio.positions });
      let outcome: TradingOutcome<TradingStrategySignal | null>;
      if (policy.kind === 'do-nothing') outcome = { valid: true, value: null };
      else if (policy.kind === 'oracle') {
        const next = executionBars(session.next).find(b => b.asset === asset);
        outcome = { valid: true, value: next ? { target: next.close > next.open ? 'long' : 'flat', availableAt: session.closeAt, observationIds: [next.id] } : null };
      } else {
        try { outcome = await signals!(context); }
        catch (cause) { outcome = tradingRefuse('TTRD1008', '/signals', 'Signal provider failed', cause); }
      }
      let signal: TradingStrategySignal | null = null, issues: TradingIssue[] = [];
      const response = validateTradingShape<TradingStrategySignalOutcome>('tradingStrategySignalOutcome', outcome);
      if (response.valid) outcome = response.value;
      if (!response.valid) issues = response.issues;
      else if (!outcome.valid) issues = outcome.issues;
      else if (outcome.value !== null) {
        const shaped = validateTradingShape<TradingStrategySignal>('tradingStrategySignal', outcome.value);
        if (!shaped.valid) issues = shaped.issues;
        else if (policy.kind !== 'oracle' && (toEpoch(shaped.value.availableAt) > toEpoch(session.closeAt)
          || !shaped.value.observationIds.length || shaped.value.observationIds.some(id => !eligible.some(o => o.id === id))))
          issues = [tradingIssue('TTRD1003', '/signals/observationIds', 'A target cannot use observations unavailable at its decision cutoff')];
        else signal = shaped.value;
      }
      pending.set(asset, { signal, issues, inputRevision: await tradingRevisionOf({ context, signal, issues, strategy: policy }) });
    }
  }
  const result = await createTradingRecord('backtest-result', { manifestId: manifest.id, status: 'completed', dayResultIds: days.map(d => d.id),
    portfolioIds: portfolios.map(p => p.id), fillIds: fills.map(f => f.id), spend: ZERO_SPEND, incompleteDecisions: 0, errors: [] });
  if (!result.valid) return result;
  const saved = retained(await store.put('results', result.value)); if (!saved.valid) return saved;
  const commission = fills.reduce((n, f) => n + f.commission, 0), slippage = fills.reduce((n, f) => n + f.slippage, 0);
  return { valid: true, value: immutableTradingJson({ result: result.value, days, portfolios, fills, rejectedOrders, refusedObservations, staleMarks, writes,
    costs: { commission, slippage, total: commission + slippage } }) };
}

/** Read only cash initialization and committed session-close valuations. */
export async function equityCurve(store: TradingStore, manifestId: string): Promise<Array<{ sessionId: string | null; portfolioId: string; equity: number }>> {
  const markers = await store.list('decisions', { manifestId, kind: 'decision-commit' });
  const closes = new Set(markers.filter(m => m.kind === 'decision-commit' && m.mode === 'valuation').map(m => m.kind === 'decision-commit' ? m.portfolioId : ''));
  return (await store.listPortfolios(manifestId)).filter(p => p.sequence === 0 || closes.has(p.id)).map(p => ({ sessionId: p.asOfSessionId, portfolioId: p.id, equity: p.equity }));
}
