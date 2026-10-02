/** One deterministic owner of cash, quantities and cost basis for commit admission. */
import { equalsJson } from '@jarenjs/core/object';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRunManifest, PortfolioSnapshot, Fill, LedgerEntry, CorporateActionObservation } from './contracts.gen.ts';

export type PortfolioState = Omit<PortfolioSnapshot, 'id' | 'revision'>;
export type TradingLedgerPosting = Omit<LedgerEntry, 'id' | 'revision'>;
/** Purpose distinguishes equal principal/fee amounts without inventing a nonce. */
export function fillLedgerPostings(fill: Fill): TradingLedgerPosting[] {
  const base = { kind: 'ledger' as const, manifestId: fill.manifestId, fillId: fill.id, actionId: null, sessionId: fill.sessionId, asset: fill.asset };
  return [
    { ...base, purpose: 'principal', account: fill.side === 'buy' ? `position:${fill.asset}` : 'cash', debit: fill.notional, credit: 0 },
    { ...base, purpose: 'principal', account: fill.side === 'buy' ? 'cash' : `position:${fill.asset}`, debit: 0, credit: fill.notional },
    ...(fill.commission ? [
      { ...base, purpose: 'commission' as const, account: 'fees', debit: fill.commission, credit: 0 },
      { ...base, purpose: 'commission' as const, account: 'cash', debit: 0, credit: fill.commission },
    ] : []),
  ];
}
export interface TradingAccountingPlan { portfolio: PortfolioState; postings: TradingLedgerPosting[]; }
export const tradingActionKey = (action: CorporateActionObservation): string => JSON.stringify([action.sourceId, action.asset, action.sourceKey]);
export function accountTradingMovements(manifest: TradingRunManifest, previous: PortfolioSnapshot, fills: readonly Fill[],
  marks: PortfolioSnapshot['marks'] | undefined, asOfSessionId: string, actions: readonly CorporateActionObservation[] = []): TradingOutcome<TradingAccountingPlan> {
  if (previous.manifestId !== manifest.id || !equalsJson(previous.positions.map(p => p.asset), manifest.assets)
    || !equalsJson(previous.marks.map(m => m.asset), manifest.assets) || marks && !equalsJson(marks.map(m => m.asset), manifest.assets))
    return tradingRefuse('TTRD1006', '/portfolio', 'Portfolio and marks must cover the manifest assets in order');
  if (new Set(actions.map(a => a.id)).size !== actions.length) return tradingRefuse('TTRD1006', '/actions', 'A corporate action is repeated');
  if (new Set(actions.map(tradingActionKey)).size !== actions.length)
    return tradingRefuse('TTRD1006', '/actions', 'Select one available revision of each economic corporate action before settlement');
  const positions = previous.positions.map(p => ({ ...p })), adjustedMarks = previous.marks.map(m => ({ ...m })), postings: TradingLedgerPosting[] = [];
  let cash = previous.cash;
  for (const [i, action] of actions.entries()) {
    const index = positions.findIndex(p => p.asset === action.asset), position = positions[index];
    if (!position || action.manifestId !== manifest.id || action.sessionId !== asOfSessionId)
      return tradingRefuse('TTRD1006', `/actions/${i}`, 'Corporate action is outside the portfolio and execution session');
    if (action.action === 'split' && action.ratio !== null) {
      position.quantity *= action.ratio; position.costBasis /= action.ratio; adjustedMarks[index].price /= action.ratio;
    } else if (action.action === 'dividend' && action.cashPerShare !== null) {
      const amount = position.quantity * action.cashPerShare; cash += amount; position.cashFlow += amount;
      if (amount) {
        const base = { kind: 'ledger' as const, manifestId: manifest.id, fillId: null, actionId: action.id, sessionId: asOfSessionId, asset: action.asset, purpose: 'dividend' as const };
        postings.push({ ...base, account: 'cash', debit: amount, credit: 0 }, { ...base, account: 'dividends', debit: 0, credit: amount });
      }
    } else return tradingRefuse('TTRD1005', `/actions/${i}/action`, 'Unsupported corporate action');
  }
  const effectiveMarks = marks ?? adjustedMarks;
  for (const [i, fill] of fills.entries()) {
    const position = positions.find(p => p.asset === fill.asset);
    if (!position || fill.manifestId !== manifest.id || fill.sessionId !== asOfSessionId || fill.notional !== fill.quantity * fill.price)
      return tradingRefuse('TTRD1006', `/fills/${i}`, 'Fill identity, session or notional does not reconcile');
    if (manifest.shares === 'whole' && !Number.isSafeInteger(fill.quantity)) return tradingRefuse('TTRD1006', `/fills/${i}/quantity`, 'Whole-share execution requires integer quantities');
    if (fill.side === 'sell' && fill.quantity > position.quantity) return tradingRefuse('TTRD1006', `/fills/${i}/quantity`, 'A fill cannot create a short position');
    const flow = (fill.side === 'buy' ? -fill.notional : fill.notional) - fill.commission;
    cash += flow; position.cashFlow += flow;
    if (cash < 0 || !Number.isFinite(cash)) return tradingRefuse('TTRD1006', '/portfolio/cash', 'Fills overspend the retained cash');
    if (fill.side === 'buy') {
      position.costBasis = position.quantity === 0 ? fill.price : (position.quantity * position.costBasis + fill.notional) / (position.quantity + fill.quantity);
      position.quantity += fill.quantity;
    } else {
      position.realizedPnl += fill.quantity * (fill.price - position.costBasis);
      position.quantity -= fill.quantity;
      if (!position.quantity) position.costBasis = 0;
    }
    postings.push(...fillLedgerPostings(fill));
  }
  const values = positions.map((p, i) => p.quantity * effectiveMarks[i].price), exposure = values.reduce((a, b) => a + b, 0), equity = cash + exposure;
  const realizedPnl = positions.reduce((n, p) => n + p.realizedPnl, 0);
  const unrealizedPnl = positions.reduce((n, p, i) => n + p.quantity * (effectiveMarks[i].price - p.costBasis), 0);
  if (![cash, equity, realizedPnl, unrealizedPnl, ...values, ...positions.flatMap(p => [p.quantity, p.costBasis, p.cashFlow, p.realizedPnl]), ...effectiveMarks.map(m => m.price)].every(Number.isFinite))
    return tradingRefuse('TTRD1006', '/portfolio', 'Accounting exceeds finite numeric range');
  if (manifest.shares === 'whole' && positions.some(p => !Number.isSafeInteger(p.quantity)))
    return tradingRefuse('TTRD1005', '/positions', 'Whole-share accounting cannot retain a fractional or unsafe quantity');
  return { valid: true, value: { postings, portfolio: { kind: 'portfolio', manifestId: manifest.id, parentId: previous.id, sequence: previous.sequence + 1,
    cash, positions, marks: effectiveMarks.map(m => ({ ...m })), equity, grossExposure: equity ? exposure / equity : 0, netExposure: equity ? exposure / equity : 0,
    concentration: positions.map((p, i) => ({ asset: p.asset, fraction: equity ? values[i] / equity : 0 })), realizedPnl, unrealizedPnl, asOfSessionId } } };
}

export function accountTradingFills(manifest: TradingRunManifest, previous: PortfolioSnapshot, fills: readonly Fill[],
  marks: PortfolioSnapshot['marks'], asOfSessionId: string): TradingOutcome<PortfolioState> {
  const result = accountTradingMovements(manifest, previous, fills, marks, asOfSessionId);
  return result.valid ? { valid: true, value: result.value.portfolio } : result;
}

export function validateTradingLedger(fills: readonly Fill[], entries: readonly LedgerEntry[]): TradingOutcome<true> {
  if (new Set(fills.map(f => f.id)).size !== fills.length)
    return tradingRefuse('TTRD1006', '/ledgerEntries', 'A posting or fill identity is repeated');
  return validateTradingPostings(fills.flatMap(fillLedgerPostings), entries);
}

export function validateTradingPostings(postings: readonly TradingLedgerPosting[], entries: readonly LedgerEntry[]): TradingOutcome<true> {
  if (new Set(entries.map(e => e.id)).size !== entries.length) return tradingRefuse('TTRD1006', '/ledgerEntries', 'A posting identity is repeated');
  const expected = [...postings];
  for (const posted of entries) {
    const index = expected.findIndex(e => e.account === posted.account && e.debit === posted.debit && e.credit === posted.credit
      && e.manifestId === posted.manifestId && e.asset === posted.asset && e.sessionId === posted.sessionId
      && e.fillId === posted.fillId && e.actionId === posted.actionId && (posted.purpose === undefined || posted.purpose === e.purpose));
    if (index < 0) return tradingRefuse('TTRD1006', '/ledgerEntries', 'Unbalanced or substituted financial postings');
    expected.splice(index, 1);
  }
  if (expected.length) return tradingRefuse('TTRD1006', '/ledgerEntries', 'Missing financial postings');
  return { valid: true, value: true };
}

export function validateInitialTradingPortfolio(manifest: TradingRunManifest, portfolio: PortfolioSnapshot): TradingOutcome<true> {
  if (portfolio.manifestId !== manifest.id || portfolio.parentId !== null || portfolio.sequence !== 0 || portfolio.asOfSessionId !== null
    || portfolio.cash !== manifest.initialCapital || portfolio.equity !== manifest.initialCapital
    || portfolio.grossExposure !== 0 || portfolio.netExposure !== 0 || portfolio.realizedPnl !== 0 || portfolio.unrealizedPnl !== 0
    || !equalsJson(portfolio.positions, manifest.assets.map(asset => ({ asset, quantity: 0, costBasis: 0, cashFlow: 0, realizedPnl: 0 })))
    || !equalsJson(portfolio.marks.map(m => m.asset), manifest.assets)
    || !equalsJson(portfolio.concentration, manifest.assets.map(asset => ({ asset, fraction: 0 }))))
    return tradingRefuse('TTRD1006', '/portfolio', 'Initial portfolio must contain exactly the declared cash and zero positions');
  return { valid: true, value: true };
}
