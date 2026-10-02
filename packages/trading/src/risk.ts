/** Hard limits derive from financial quantities, never caller-supplied summary ratios. */
import { accountTradingMovements } from './accounting.ts';
import { validateTradingShape } from './schema.ts';
import { tradingIssue } from './errors.ts';
import { planFill, tradingFillEconomics } from './broker.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingIssue, TradingRiskInput, TradingFillInput, TradingFillPlan, TradingSizingResult, PortfolioSnapshot, TradingRunManifest, BarObservation, OrderIntent } from './contracts.gen.ts';

/** Monetary margins are affine in quantity, including sales that repair an existing breach. */
function financialMargins(manifest: TradingRunManifest, portfolio: Pick<PortfolioSnapshot, 'positions' | 'marks' | 'cash' | 'equity'>, linear = true): Array<[string, number, string]> {
  const policy = manifest.riskPolicy, values = portfolio.positions.map((p, i) => p.quantity * portfolio.marks[i].price);
  const exposure = values.reduce((a, b) => a + b, 0);
  const ceiling = (limit: number, value: number) => linear ? limit * portfolio.equity - value : limit - (portfolio.equity ? value / portfolio.equity : 0);
  return [
    ['grossExposure', ceiling(policy.grossExposure, exposure), 'Gross exposure exceeds its declared ceiling'],
    ['netExposure', ceiling(policy.netExposure, Math.abs(exposure)), 'Absolute net exposure exceeds its declared ceiling'],
    ...values.map((v, i): [string, number, string] => ['singleName', ceiling(policy.singleName, v), `Concentration exceeds its declared ceiling for ${portfolio.positions[i].asset}`]),
    ['cashFloor', portfolio.cash - policy.cashFloor, 'Cash falls below the declared floor in portfolio currency'],
    ['lossLimit', portfolio.equity - manifest.initialCapital * (1 - policy.lossLimit), 'Equity falls below the declared loss floor against initial capital'],
  ];
}

export function checkRiskPolicy(input: TradingRiskInput): TradingIssue[] {
  const shape = validateTradingShape<TradingRiskInput>('tradingRiskInput', input); if (!shape.valid) return shape.issues;
  const { manifest, portfolioAfter, intent, sessionBar } = shape.value, policy = manifest.riskPolicy;
  for (const [path, id] of [['/portfolioAfter/manifestId', portfolioAfter.manifestId], ['/intent/manifestId', intent.manifestId], ['/sessionBar/manifestId', sessionBar.manifestId]])
    if (id !== manifest.id) return [tradingIssue('TTRD1002', path, 'Risk inputs cross run boundaries')];
  if (intent.asset !== sessionBar.asset) return [tradingIssue('TTRD1002', '/sessionBar/asset', 'Risk quote belongs to another instrument')];
  if (!manifest.assets.includes(intent.asset)) return [tradingIssue('TTRD1002', '/intent/asset', 'Risk request is outside the run assets')];
  const accounted = accountTradingMovements(manifest, portfolioAfter, [], portfolioAfter.marks, portfolioAfter.asOfSessionId ?? sessionBar.sessionId);
  if (!accounted.valid) return accounted.issues;
  const portfolio = accounted.value.portfolio, issues: TradingIssue[] = [];
  const breach = (condition: boolean, limit: string, detail: string) => { if (condition) issues.push(tradingIssue('TTRD1005', `/riskPolicy/${limit}`, detail)); };
  for (const [name, margin, detail] of financialMargins(manifest, portfolio, false)) breach(margin < 0, name, detail);
  breach(intent.quantity > sessionBar.volume * policy.maxParticipation, 'maxParticipation', 'Requested quantity exceeds the declared share of observed session volume');
  breach(!policy.instruments.includes(intent.asset), 'instruments', 'Instrument is outside the declared policy');
  breach(!policy.orderKinds.some(kind => kind === intent.orderKind), 'orderKinds', 'Order kind is outside the declared policy');
  return issues;
}

/** The immediately smaller representable positive number, for strict floating boundaries. */
function smaller(quantity: number, whole: boolean): number {
  if (whole) return Math.floor(quantity) - 1;
  const bits = new DataView(new ArrayBuffer(8)); bits.setFloat64(0, quantity);
  bits.setBigUint64(0, bits.getBigUint64(0) - 1n); return bits.getFloat64(0);
}

/** Intersect every linear limit, then verify the largest representable candidate with the real broker. */
export async function sizeToPolicy(input: TradingFillInput): Promise<TradingOutcome<TradingSizingResult>> {
  const shape = validateTradingShape<TradingFillInput>('tradingFillInput', input); if (!shape.valid) return shape;
  const request = shape.value, { manifest, portfolio, intent, bar } = request;
  for (const record of [manifest, portfolio, intent, request.session, ...(bar ? [bar] : [])]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (!bar) return { valid: true, value: { disposition: 'hold', quantity: 0, issues: [tradingIssue('TTRD1007', '/bar', 'Execution session has no bar')] } };
  return sizeTradingQuote({ ...request, bar, price: bar.open, quote: candidate => planFill({ ...request, intent: candidate }) });
}

/** The same affine sizing policy applies to an admitted quote and the actual execution price. */
export async function sizeTradingQuote(request: TradingFillInput & { bar: BarObservation; price: number; quote: (intent: OrderIntent) => Promise<TradingOutcome<TradingFillPlan>> }): Promise<TradingOutcome<TradingSizingResult>> {
  const { manifest, portfolio, intent, bar } = request, policy = manifest.riskPolicy;
  const hold = (issues: TradingIssue[]): TradingOutcome<TradingSizingResult> => ({ valid: true, value: { disposition: 'hold', quantity: 0, issues } });
  if (!policy.instruments.includes(intent.asset)) return hold([tradingIssue('TTRD1005', '/riskPolicy/instruments', 'Instrument is outside the declared policy')]);
  const unit = tradingFillEconomics(manifest, request.price, intent.side, 1), whole = manifest.shares === 'whole';
  const held = portfolio.positions.find(p => p.asset === intent.asset)?.quantity ?? 0;
  let upper = Math.min(intent.quantity, bar.volume * policy.maxParticipation, intent.side === 'sell' ? held : portfolio.cash / (unit.notional + unit.commission));
  if (whole) upper = Math.floor(Math.min(upper, Number.MAX_SAFE_INTEGER));
  if (!(upper > 0)) return hold([tradingIssue('TTRD1005', '/quantity', 'No positive quantity satisfies cash, holdings and participation bounds')]);
  const quote = async (quantity: number) => {
    const { id: _id, revision: _revision, kind: _kind, ...body } = intent;
    const sized = await createTradingRecord('order', { ...body, quantity }); if (!sized.valid) return sized;
    const result = await request.quote(sized.value);
    return result.valid ? { valid: true as const, value: { ...result.value, intent: sized.value } } : result;
  };
  let maximum = await quote(upper);
  // The cash division can round upward. Examine only adjacent representations, never size upward.
  for (let adjacent = 0; !maximum.valid && adjacent < 8 && upper > 0; adjacent++) { upper = smaller(upper, whole); if (upper > 0) maximum = await quote(upper); }
  if (!maximum.valid) return hold(maximum.issues);
  const adjustments = checkRiskPolicy({ manifest, portfolioAfter: maximum.value.portfolio, intent: maximum.value.intent, sessionBar: bar });
  const base = accountTradingMovements(manifest, portfolio, [], maximum.value.portfolio.marks, request.session.key); if (!base.valid) return base;
  const start = financialMargins(manifest, base.value.portfolio), end = financialMargins(manifest, maximum.value.portfolio);
  let lower = 0, permitted = upper;
  for (const [i, [, a]] of start.entries()) {
    const b = end[i][1], slope = (b - a) / upper;
    if (slope > 0) lower = Math.max(lower, -a / slope);
    else if (slope < 0) permitted = Math.min(permitted, -a / slope);
    else if (a < 0) return hold([tradingIssue('TTRD1005', `/riskPolicy/${start[i][0]}`, start[i][2])]);
  }
  if (whole) { lower = Math.ceil(lower); permitted = Math.floor(permitted); }
  let last: TradingIssue[] = [tradingIssue('TTRD1005', '/quantity', 'No positive quantity satisfies all policy limits')];
  for (let adjacent = 0; adjacent < 8 && permitted > 0 && permitted >= lower; adjacent++, permitted = smaller(permitted, whole)) {
    const planned = permitted === upper ? maximum : await quote(permitted);
    if (!planned.valid) { last = planned.issues; continue; }
    last = checkRiskPolicy({ manifest, portfolioAfter: planned.value.portfolio, intent: planned.value.intent, sessionBar: bar });
    if (!last.length) return { valid: true, value: { disposition: 'sized', quantity: permitted, issues: [], ...(adjustments.length ? { adjustments } : {}) } };
  }
  return hold(last);
}
