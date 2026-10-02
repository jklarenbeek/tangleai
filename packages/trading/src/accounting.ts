/** One deterministic owner of cash, quantities and cost basis for commit admission. */
import { equalsJson } from '@jarenjs/core/object';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRunManifest, PortfolioSnapshot, Fill, LedgerEntry } from './contracts.gen.ts';

export type PortfolioState = Omit<PortfolioSnapshot, 'id' | 'revision'>;
export function accountTradingFills(manifest: TradingRunManifest, previous: PortfolioSnapshot, fills: readonly Fill[],
  marks: PortfolioSnapshot['marks'], asOfSessionId: string): TradingOutcome<PortfolioState> {
  if (previous.manifestId !== manifest.id || !equalsJson(previous.positions.map(p => p.asset), manifest.assets)
    || !equalsJson(marks.map(m => m.asset), manifest.assets)) return tradingRefuse('TTRD1006', '/portfolio', 'Portfolio and marks must cover the manifest assets in order');
  const positions = previous.positions.map(p => ({ ...p }));
  let cash = previous.cash, realizedPnl = previous.realizedPnl;
  for (const [i, fill] of fills.entries()) {
    const position = positions.find(p => p.asset === fill.asset);
    if (!position || fill.manifestId !== manifest.id || fill.sessionId !== asOfSessionId || fill.notional !== fill.quantity * fill.price)
      return tradingRefuse('TTRD1006', `/fills/${i}`, 'Fill identity, session or notional does not reconcile');
    if (manifest.shares === 'whole' && !Number.isSafeInteger(fill.quantity)) return tradingRefuse('TTRD1006', `/fills/${i}/quantity`, 'Whole-share execution requires integer quantities');
    if (fill.side === 'sell' && fill.quantity > position.quantity) return tradingRefuse('TTRD1006', `/fills/${i}/quantity`, 'A fill cannot create a short position');
    const flow = (fill.side === 'buy' ? -fill.notional : fill.notional) - fill.commission;
    cash += flow;
    if (cash < 0 || !Number.isFinite(cash)) return tradingRefuse('TTRD1006', '/portfolio/cash', 'Fills overspend the retained cash');
    if (fill.side === 'buy') {
      position.costBasis = position.quantity === 0 ? fill.price : (position.quantity * position.costBasis + fill.notional) / (position.quantity + fill.quantity);
      position.quantity += fill.quantity;
    } else {
      realizedPnl += fill.quantity * (fill.price - position.costBasis);
      position.quantity -= fill.quantity;
      if (!position.quantity) position.costBasis = 0;
    }
  }
  const values = positions.map((p, i) => p.quantity * marks[i].price), exposure = values.reduce((a, b) => a + b, 0), equity = cash + exposure;
  const unrealizedPnl = positions.reduce((n, p, i) => n + p.quantity * (marks[i].price - p.costBasis), 0);
  if (![equity, realizedPnl, unrealizedPnl, ...values].every(Number.isFinite)) return tradingRefuse('TTRD1006', '/portfolio', 'Accounting exceeds finite numeric range');
  return { valid: true, value: { kind: 'portfolio', manifestId: manifest.id, parentId: previous.id, sequence: previous.sequence + 1,
    cash, positions, marks: marks.map(m => ({ ...m })), equity, grossExposure: equity ? exposure / equity : 0, netExposure: equity ? exposure / equity : 0,
    concentration: positions.map((p, i) => ({ asset: p.asset, fraction: equity ? values[i] / equity : 0 })), realizedPnl, unrealizedPnl, asOfSessionId } };
}

export function validateTradingLedger(fills: readonly Fill[], entries: readonly LedgerEntry[]): TradingOutcome<true> {
  if (new Set(entries.map(e => e.id)).size !== entries.length || new Set(fills.map(f => f.id)).size !== fills.length)
    return tradingRefuse('TTRD1006', '/ledgerEntries', 'A posting or fill identity is repeated');
  if (entries.some(e => e.fillId === null || !fills.some(f => f.id === e.fillId) || e.actionId !== null))
    return tradingRefuse('TTRD1006', '/ledgerEntries', 'Posting has no matching committed fill');
  for (const fill of fills) {
    const found = entries.filter(e => e.fillId === fill.id);
    if (found.some(e => e.manifestId !== fill.manifestId || e.asset !== fill.asset || e.sessionId !== fill.sessionId))
      return tradingRefuse('TTRD1006', '/ledgerEntries', 'Posting scope differs from its fill');
    const expected = [
      { account: fill.side === 'buy' ? `position:${fill.asset}` : 'cash', debit: fill.notional, credit: 0 },
      { account: fill.side === 'buy' ? 'cash' : `position:${fill.asset}`, debit: 0, credit: fill.notional },
      ...(fill.commission ? [{ account: 'fees', debit: fill.commission, credit: 0 }, { account: 'cash', debit: 0, credit: fill.commission }] : []),
    ];
    const order = (a: { account: string; debit: number; credit: number }, b: { account: string; debit: number; credit: number }) =>
      (a.account < b.account ? -1 : a.account > b.account ? 1 : 0) || a.debit - b.debit || a.credit - b.credit;
    const posted = found.map(({ account, debit, credit }) => ({ account, debit, credit })).sort(order);
    if (!equalsJson(posted, expected.sort(order))) return tradingRefuse('TTRD1006', '/ledgerEntries', 'Unbalanced or substituted fill postings');
  }
  return { valid: true, value: true };
}

export function validateInitialTradingPortfolio(manifest: TradingRunManifest, portfolio: PortfolioSnapshot): TradingOutcome<true> {
  if (portfolio.manifestId !== manifest.id || portfolio.parentId !== null || portfolio.sequence !== 0 || portfolio.asOfSessionId !== null
    || portfolio.cash !== manifest.initialCapital || portfolio.equity !== manifest.initialCapital
    || portfolio.grossExposure !== 0 || portfolio.netExposure !== 0 || portfolio.realizedPnl !== 0 || portfolio.unrealizedPnl !== 0
    || !equalsJson(portfolio.positions, manifest.assets.map(asset => ({ asset, quantity: 0, costBasis: 0 })))
    || !equalsJson(portfolio.marks.map(m => m.asset), manifest.assets)
    || !equalsJson(portfolio.concentration, manifest.assets.map(asset => ({ asset, fraction: 0 }))))
    return tradingRefuse('TTRD1006', '/portfolio', 'Initial portfolio must contain exactly the declared cash and zero positions');
  return { valid: true, value: true };
}
