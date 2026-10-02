/** Deterministic next-open execution; no transport, clock, model or persistence. */
import { toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { accountTradingFills, fillLedgerPostings } from './accounting.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingRunManifest, LedgerEntry, TradingFillInput, TradingFillPlan, PortfolioSnapshot, OrderIntent, BarObservation } from './contracts.gen.ts';

/** The sole owner of execution price, fees and slippage, including policy quotes. */
export function tradingFillEconomics(manifest: Pick<TradingRunManifest, 'commissionBps' | 'slippageBps'>, open: number, side: 'buy' | 'sell', quantity: number) {
  const price = open * (1 + (side === 'buy' ? 1 : -1) * manifest.slippageBps / 10000), notional = quantity * price;
  return { price, notional, commission: notional * manifest.commissionBps / 10000, slippage: quantity * Math.abs(price - open) };
}

export async function planFill(input: TradingFillInput): Promise<TradingOutcome<TradingFillPlan>> {
  const shape = validateTradingShape<TradingFillInput>('tradingFillInput', input); if (!shape.valid) return shape;
  const { manifest, portfolio, intent, session, bar } = shape.value;
  for (const record of [manifest, portfolio, intent, session, ...(bar ? [bar] : [])]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (intent.orderKind !== 'market' || intent.limitPrice !== null || intent.stopPrice !== null)
    return tradingRefuse('TTRD1005', '/intent/orderKind', 'Unsupported order kind: only next-open market execution is declared');
  if ([portfolio.manifestId, intent.manifestId, session.manifestId].some(id => id !== manifest.id) || !manifest.assets.includes(intent.asset))
    return tradingRefuse('TTRD1002', '/manifestId', 'Fill inputs cross run or asset boundaries');
  if (session.key !== intent.fillSessionId || session.prev !== intent.decisionSessionId || session.calendar !== manifest.calendar)
    return tradingRefuse('TTRD1005', '/session', 'A market intent must execute in the next linked session');
  if (!bar) return tradingRefuse('TTRD1007', '/bar', 'Execution session has no bar');
  if (bar.asset !== intent.asset || bar.manifestId !== manifest.id || bar.sessionId !== session.key || toEpoch(bar.eventAt) !== toEpoch(session.closeAt))
    return tradingRefuse('TTRD1003', '/bar', 'Execution bar does not reproduce the intent asset and session');
  return quoteTradingOrder({ manifest, portfolio, intent, bar, price: bar.open, sessionId: session.key });
}

/** Internal economics shared by execution and explicit decision-time quotations. A quote is never committed as an execution plan. */
export async function quoteTradingOrder(input: { manifest: TradingRunManifest; portfolio: PortfolioSnapshot; intent: OrderIntent;
  bar: BarObservation; price: number; sessionId: string }): Promise<TradingOutcome<TradingFillPlan>> {
  const { manifest, portfolio, intent, bar, price, sessionId } = input;
  const fill = await createTradingRecord('fill', { manifestId: manifest.id, intentId: intent.id, decisionId: intent.decisionId, asset: intent.asset,
    sessionId, sourceBarId: bar.id, side: intent.side, quantity: intent.quantity, ...tradingFillEconomics(manifest, price, intent.side, intent.quantity) });
  if (!fill.valid) return fill;
  const marks = portfolio.marks.map(m => m.asset === intent.asset ? { ...m, price } : m);
  const accounted = accountTradingFills(manifest, portfolio, [fill.value], marks, sessionId);
  if (!accounted.valid) return tradingRefuse('TTRD1005', accounted.issues[0].path, accounted.issues[0].detail, accounted.issues[0]);
  const valued = await createTradingRecord('portfolio', accounted.value); if (!valued.valid) return valued;
  const ledgerEntries: LedgerEntry[] = [];
  for (const { kind: _kind, ...posting } of fillLedgerPostings(fill.value)) {
    const entry = await createTradingRecord('ledger', posting); if (!entry.valid) return entry;
    ledgerEntries.push(entry.value);
  }
  return { valid: true, value: immutableTradingJson({ fill: fill.value, ledgerEntries, portfolio: valued.value }) };
}
