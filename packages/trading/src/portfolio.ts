/** Deterministic valuation and corporate entitlements over the shared accountant. */
import { toEpoch } from '@jarenjs/core/series';
import { immutableTradingJson } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { accountTradingMovements } from './accounting.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingMarkInput, TradingMarkResult, TradingActionsInput, TradingActionsResult, LedgerEntry } from './contracts.gen.ts';

export async function markPortfolio(input: TradingMarkInput): Promise<TradingOutcome<TradingMarkResult>> {
  const shape = validateTradingShape<TradingMarkInput>('tradingMarkInput', input); if (!shape.valid) return shape;
  const { manifest, portfolio, session, bars } = shape.value;
  for (const record of [manifest, portfolio, session, ...bars]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (portfolio.manifestId !== manifest.id || session.manifestId !== manifest.id || session.calendar !== manifest.calendar)
    return tradingRefuse('TTRD1002', '/manifestId', 'Valuation inputs cross run boundaries');
  if (new Set(bars.map(b => b.asset)).size !== bars.length) return tradingRefuse('TTRD1003', '/bars', 'Valuation requires one execution revision per asset');
  if (bars.some(b => b.manifestId !== manifest.id || !manifest.assets.includes(b.asset) || b.sessionId !== session.key || toEpoch(b.eventAt) !== toEpoch(session.closeAt)))
    return tradingRefuse('TTRD1003', '/bars', 'Valuation bars must reproduce this run and session close');
  const missingAssets = manifest.assets.filter(asset => !bars.some(b => b.asset === asset));
  const marks = portfolio.marks.map(m => ({ asset: m.asset, price: bars.find(b => b.asset === m.asset)?.close ?? m.price }));
  const accounted = accountTradingMovements(manifest, portfolio, [], marks, session.key); if (!accounted.valid) return accounted;
  const valued = await createTradingRecord('portfolio', accounted.value.portfolio); if (!valued.valid) return valued;
  return { valid: true, value: immutableTradingJson({ portfolio: valued.value, staleMarks: missingAssets.length, missingAssets }) };
}

export async function applyCorporateActions(input: TradingActionsInput): Promise<TradingOutcome<TradingActionsResult>> {
  const shape = validateTradingShape<TradingActionsInput>('tradingActionsInput', input);
  if (!shape.valid) {
    const unsupported = shape.issues.find(issue => /^\/actions\/\d+\/action$/.test(issue.path));
    return unsupported ? tradingRefuse('TTRD1005', unsupported.path, 'Unsupported corporate action', unsupported) : shape;
  }
  const { manifest, portfolio, session, actions } = shape.value;
  for (const record of [manifest, portfolio, session, ...actions]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (portfolio.manifestId !== manifest.id || session.manifestId !== manifest.id || session.calendar !== manifest.calendar)
    return tradingRefuse('TTRD1002', '/manifestId', 'Corporate action inputs cross run boundaries');
  if (actions.some(a => a.sessionId !== session.key || toEpoch(a.eventAt) !== toEpoch(session.openAt) || toEpoch(a.availableAt) > toEpoch(session.openAt)))
    return tradingRefuse('TTRD1003', '/actions', 'Corporate action must be published by its ex-session open');
  const accounted = accountTradingMovements(manifest, portfolio, [], undefined, session.key, actions); if (!accounted.valid) return accounted;
  const valued = await createTradingRecord('portfolio', accounted.value.portfolio); if (!valued.valid) return valued;
  const ledgerEntries: LedgerEntry[] = [];
  for (const { kind: _kind, ...body } of accounted.value.postings) {
    const entry = await createTradingRecord('ledger', body); if (!entry.valid) return entry;
    ledgerEntries.push(entry.value);
  }
  return { valid: true, value: immutableTradingJson({ portfolio: valued.value, ledgerEntries, actionIds: actions.map(a => a.id) }) };
}
