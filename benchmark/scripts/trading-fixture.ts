/** Original MIT synthetic data and independent golden ledgers; no runtime broker imports. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { mulberry32 } from '@jarenjs/core/random';
import { daysFromCivil, civilFromDays, weekdayFromDays } from '@jarenjs/core/dates';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { parseArgs } from '../lib/args.ts';
import { measureTradingEquity } from '../lib/trading-metrics.ts';
import type { Asset, Bar, CorporateAction, FixtureManifest, Golden, GoldenPosition, Observation, Release, Session, Strategy } from '../lib/trading.types.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TRADING_FIXTURE_ROOT = join(ROOT, 'benchmark/fixtures/trading');
const ASSETS: Asset[] = ['SYN-A', 'SYN-B'];
const YEAR = { sessionsPerYear: 252 as const, riskFree: { kind: 'zero-series' as const } };
const HOLIDAYS = ['2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26'];
const bytesOf = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
const sha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
const price = (value: number): number => Math.round(value * 10000) / 10000;

async function observed<T extends Omit<Observation, 'contentHash'>>(value: T): Promise<T & { contentHash: string }> {
  return { ...value, contentHash: await canonicalSha256(value) };
}

function sessions(): Session[] {
  const dates: string[] = [];
  for (let day = daysFromCivil(2025, 1, 2); day <= daysFromCivil(2025, 6, 30); day++) {
    const { year, month, day: date } = civilFromDays(day);
    const text = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    if (![0, 6].includes(weekdayFromDays(day)) && !HOLIDAYS.includes(text)) dates.push(text);
  }
  return dates.map((date, i) => ({ id: `synx-${date}`, date, openAt: `${date}T14:30:00Z`, closeAt: `${date}T21:00:00Z`,
    prev: i ? `synx-${dates[i - 1]}` : null, next: i + 1 < dates.length ? `synx-${dates[i + 1]}` : null }));
}

/** Fixed 100-share entries, existing longs held on an up-session, sales otherwise.
 * Split entitlement precedes fills; dividends belong to the opening holder.
 * The synthetic oracle deliberately sees the next session's close. */
function golden(id: Golden['id'], calendar: Session[], bars: Bar[], actions: CorporateAction[]): Golden {
  let cash = 100000;
  const positions: GoldenPosition[] = ASSETS.map(asset => ({ asset, quantity: 0, costBasis: 0,
    mark: bars.find(b => b.asset === asset)!.open, realizedPnl: 0, unrealizedPnl: 0, cashFlow: 0 }));
  const points: Golden['points'] = [{ sessionId: null, cash, equity: cash, positions: structuredClone(positions) }];
  const fills: Golden['fills'] = [], ledger: Golden['ledger'] = [];
  for (const [index, session] of calendar.entries()) {
    for (const position of positions) {
      const bar = bars.find(b => b.asset === position.asset && b.sessionId === session.id)!;
      for (const action of actions.filter(a => a.asset === position.asset && a.sessionId === session.id)) {
        if (action.action === 'split') { position.quantity *= action.ratio!; position.costBasis /= action.ratio!; }
        else if (position.quantity) {
          const amount = position.quantity * action.cashPerShare!;
          cash += amount; position.cashFlow += amount;
          ledger.push({ id: `${id}:${action.id}`, fillId: null, sessionId: session.id, asset: position.asset, debit: 'cash', credit: 'dividends', amount });
        }
      }
      const up = id === 'oracle' ? bar.close > bar.open : id === 'leaky' && index >= 11 && position.asset === 'SYN-A';
      const side = index && id !== 'do-nothing' ? up && !position.quantity ? 'buy' : !up && position.quantity ? 'sell' : null : null;
      if (side) {
        const quantity = side === 'buy' ? 100 : position.quantity;
        const execution = bar.open * (1 + (side === 'buy' ? 1 : -1) * 5 / 10000);
        const notional = quantity * execution, commission = notional * 5 / 10000;
        const fillId = `${id}:${session.id}:${position.asset}`;
        fills.push({ id: fillId, asset: position.asset, decisionSessionId: calendar[index - 1].id,
          sessionId: session.id, side, quantity, price: execution, commission, slippage: quantity * Math.abs(execution - bar.open), notional });
        const flow = (side === 'buy' ? -notional : notional) - commission;
        cash += flow; position.cashFlow += flow;
        if (side === 'buy') { position.quantity = quantity; position.costBasis = execution; }
        else { position.realizedPnl += quantity * (execution - position.costBasis); position.quantity = 0; position.costBasis = 0; }
        ledger.push({ id: `${fillId}:principal`, fillId, sessionId: session.id, asset: position.asset,
          debit: side === 'buy' ? `position:${position.asset}` : 'cash', credit: side === 'buy' ? 'cash' : `position:${position.asset}`, amount: notional },
        { id: `${fillId}:fee`, fillId, sessionId: session.id, asset: position.asset, debit: 'fees', credit: 'cash', amount: commission });
      }
      position.mark = bar.close; position.unrealizedPnl = position.quantity * (position.mark - position.costBasis);
    }
    if (cash < 0) throw new Error('Golden fixture overspends cash');
    points.push({ sessionId: session.id, cash, equity: cash + positions.reduce((n, p) => n + p.quantity * p.mark, 0), positions: structuredClone(positions) });
  }
  const equity = points.map(p => p.equity), commission = fills.reduce((n, f) => n + f.commission, 0), slippage = fills.reduce((n, f) => n + f.slippage, 0);
  return { id, privileged: id !== 'do-nothing', reason: id === 'oracle' ? 'Privileged future close; analytic control only, not a feasible strategy' : id === 'leaky' ? 'reads observations after cutoff' : null,
    equity, points, fills, ledger, ...measureTradingEquity(equity, YEAR), costs: { commission, slippage, total: commission + slippage },
    perAsset: ASSETS.map(asset => {
      const curve = points.map(p => { const holding = p.positions.find(v => v.asset === asset)!; return 50000 + holding.cashFlow + holding.quantity * holding.mark; });
      return { asset, equity: curve, ...measureTradingEquity(curve, YEAR), fills: fills.filter(f => f.asset === asset).length };
    }),
  };
}

export async function generateTradingFixture(): Promise<Map<string, string>> {
  const random = mulberry32(7331), calendar = sessions(), bars: Bar[] = [], releases: Release[] = [], actions: CorporateAction[] = [];
  const splitIndex = 65, dividendIndex = 92;
  for (const asset of ASSETS) {
    let prior = asset === 'SYN-A' ? 100 : 80;
    for (const [index, session] of calendar.entries()) {
      if (asset === 'SYN-A' && index === splitIndex) prior /= 2;
      const open = price(prior * (1 + (random() - 0.5) * 0.006));
      const drift = asset === 'SYN-A' ? index < 44 ? 0.003 : 0.001 : (80 - index * 0.11 - prior) * 0.09 / prior;
      const close = price(open * (1 + drift + (random() - 0.5) * 0.02));
      const high = price(Math.max(open, close) * (1 + random() * 0.009)), low = price(Math.min(open, close) * (1 - random() * 0.009));
      const volume = 100000 + Math.floor(random() * 900000);
      const id = `${asset.toLowerCase()}:${session.id}:bar`;
      bars.push(await observed({ id, kind: 'bar' as const, asset, sessionId: session.id, open, high, low, close,
        adjustedClose: price(close * (asset === 'SYN-A' && index >= splitIndex ? 2 : 1)), volume,
        eventAt: session.closeAt, availableAt: `${session.date}T21:15:00Z`, sourceId: 'synthetic-market', revisionId: `${id}:r1` }));
      prior = close;
    }
    for (const kind of ['fundamental', 'news', 'social', 'insider', 'profile'] as const) {
      for (const index of [0, 25, 55, 85, 115]) {
        const session = calendar[index], id = `${asset.toLowerCase()}:${kind}:${index}`;
        releases.push(await observed({ id, kind, asset, eventAt: session.openAt, availableAt: `${session.date}T20:00:00Z`,
          sourceId: `synthetic-${kind}`, revisionId: `${id}:r1`,
          text: `${asset} fictional ${kind} release ${index}: ${asset === 'SYN-A' ? 'capacity expansion with execution uncertainty' : 'inventory pressure with uneven demand'}.`,
          providerSentiment: kind === 'social' || kind === 'news' ? price(random() * 2 - 1) : null, modelInterpretation: null }));
      }
    }
  }
  for (const [asset, index, action] of [['SYN-A', splitIndex, 'split'], ['SYN-B', dividendIndex, 'dividend']] as const) {
    const session = calendar[index], id = `${asset.toLowerCase()}:${action}`;
    actions.push(await observed({ id, kind: 'corporate-action' as const, asset, sessionId: session.id, action,
      ratio: action === 'split' ? 2 : null, cashPerShare: action === 'dividend' ? 0.4 : null,
      eventAt: session.openAt, availableAt: session.openAt, sourceId: 'synthetic-actions', revisionId: `${id}:r1` }));
  }
  const { contentHash: ignored, ...bar } = bars[10]; void ignored;
  const poison: Observation[] = [await observed({ ...bar, id: 'poison-restated-bar', open: 10000, high: 10001, low: 9999, close: 10000, adjustedClose: 10000,
    availableAt: '2025-07-01T12:00:00Z', revisionId: 'poison-restated-bar:r2' })];
  for (const [kind, index] of [['fundamental', 25], ['news', 40]] as const) {
    const id = `poison-${kind}`;
    poison.push(await observed({ id, kind, asset: 'SYN-B' as const, eventAt: calendar[index].openAt,
      availableAt: '2025-07-01T12:00:00Z', sourceId: `synthetic-${kind}`, revisionId: `${id}:r2`, text: 'Backdated fictional release: guaranteed impossible future outcome.',
      providerSentiment: 1, modelInterpretation: null }));
  }
  const strategies: Strategy[] = [
    { id: 'oracle', kind: 'control', parityTier: 'control', description: 'Privileged next-session close; fixed 100-share entries and exit on a non-up session.' },
    { id: 'do-nothing', kind: 'control', parityTier: 'control', description: 'Hold all initial cash.' },
    { id: 'leaky', kind: 'control', parityTier: 'control', description: 'Buy SYN-A from a restatement before it was available; excluded from comparisons.' },
    ...['buy-and-hold', 'macd', 'kdj-rsi', 'zero-mean-reversion', 'sma'].map(id => ({ id, kind: 'baseline' as const, parityTier: 'mechanism' as const, description: 'Registered rule-based signal through the shared broker.' })),
    { id: 'tradingagents-scripted', kind: 'agent', parityTier: 'mechanism', description: 'Full workflow with injected scripted replies.' },
    { id: 'tradingagents-live', kind: 'agent', parityTier: 'experimental', description: 'Requires a separately authorized live model plan.' },
  ];
  const files = new Map<string, string>([['sessions.json', bytesOf(calendar)], ['bars.json', bytesOf(bars)], ['corporate-actions.json', bytesOf(actions)],
    ['poison.json', bytesOf(poison)], ['strategies.json', bytesOf(strategies)]]);
  for (const [file, kind] of [['fundamentals', 'fundamental'], ['news', 'news'], ['social', 'social'], ['insiders', 'insider'], ['profiles', 'profile']] as const)
    files.set(`${file}.json`, bytesOf(releases.filter(r => r.kind === kind)));
  for (const id of ['oracle', 'do-nothing', 'leaky'] as const) files.set(`golden/${id}.json`, bytesOf(golden(id, calendar, bars, actions)));
  const manifest: FixtureManifest = { id: 'trading-synthetic-v1', licence: 'MIT', provenance: 'Original fictional Tangle-authored data; no market data, company facts or paper result values are redistributed.',
    seed: 7331, generatorVersion: 1, generatorSha256: sha(await readFile(fileURLToPath(import.meta.url), 'utf8')),
    assets: ['SYN-A', 'SYN-B'], calendar: 'SYNX', currency: 'USD', initialCapital: 100000, ...YEAR, riskFree: { kind: 'zero-series' },
    decisionCutoff: 'session-close', fill: 'next-open', commissionBps: 5, slippageBps: 5, shares: 'whole', shorting: false, leverage: false, holidays: HOLIDAYS,
    adjustmentConvention: 'Causal forward split normalization: adjustedClose equals close times the product of splits effective on or before this bar; no historic values are rewritten. Dividends remain cash actions.',
    oracleConvention: 'No first-session fill. At each preceding close, privileged future open/close selects a 100-share entry when flat, holds an existing long on an up-session, otherwise sells all at the next open. Last holdings remain marked, not liquidated. Leaky control enters SYN-A from the future restatement at session index 11.',
    accountingConvention: 'Initial equity plus one close mark per session; IEEE-754 arithmetic, no monetary rounding. Split quantity and average cost basis first; opening-holder dividend before fills. Buy price=open*(1+slippageBps/10000), sell=open*(1-slippageBps/10000); commission=quantity*price*commissionBps/10000. Each fill has paired debit/credit principal and fee entries. Per-asset curves allocate half initial cash and attribute that asset cash flows; fees excluded from position cost basis and realizedPnl, included in cash.',
    loserAsset: 'SYN-B', sha256: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, sha256: sha(bytes) })) };
  files.set('manifest.json', bytesOf(manifest)); return files;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.some(a => a.startsWith('--') && a.includes('='))) throw new Error('Inline fixture options are not supported');
  const args = parseArgs(argv, { flags: ['check'], values: ['out-dir'] });
  if (args.rest.length || [...args.values.values()].some(v => v.startsWith('--'))) throw new Error('Malformed fixture arguments');
  globalThis.fetch = async () => { throw new Error('Trading fixture must not reach the network'); };
  const root = args.values.get('out-dir') ?? TRADING_FIXTURE_ROOT, files = await generateTradingFixture();
  for (const [path, bytes] of files) {
    const target = join(root, path);
    if (args.flags.has('check')) { if (await readFile(target, 'utf8') !== bytes) throw new Error(`Trading fixture drift: ${path}`); }
    else { await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
  }
  console.log(`Trading fixture: ${files.size} files ${args.flags.has('check') ? 'verified' : 'written'}`);
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
