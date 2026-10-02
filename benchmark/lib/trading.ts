/** Fixture admission and an independent point-in-time measurement oracle. */
import { readFile, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { asOfJoin, toEpoch } from '@jarenjs/core/series';
import { returnsOf } from '@jarenjs/core/finance/returns';
import schema from '../schemas/trading.schema.json' with { type: 'json' };
import { createReportValidator } from './validate.ts';
import { measureTradingEquity } from './trading-metrics.ts';
import type { Bar, CorporateAction, FixtureManifest, Golden, Observation, PoisonAudit, Release, Session, Strategy } from './trading.types.ts';

export const TRADING_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TRADING_FIXTURE_PATH = join(TRADING_ROOT, 'benchmark/fixtures/trading');
const MEMBERS = ['bars.json', 'corporate-actions.json', 'fundamentals.json', 'golden/do-nothing.json', 'golden/leaky.json', 'golden/oracle.json',
  'insiders.json', 'news.json', 'poison.json', 'profiles.json', 'sessions.json', 'social.json', 'strategies.json'];
const validators = new Map<string, ReturnType<typeof createReportValidator>>();
function shaped<T>(definition: keyof typeof schema.$defs, value: unknown, array = false): T {
  const key = `${definition}:${array}`;
  let validate = validators.get(key);
  if (!validate) {
    const item = { $ref: `#/$defs/${definition}` };
    validate = createReportValidator({ $defs: schema.$defs, ...(array ? { type: 'array', items: item } : item) });
    validators.set(key, validate);
  }
  const check = validate(value);
  if (!check.valid) throw new Error(`Invalid trading ${definition}: ${JSON.stringify(check.errors)}`);
  return value as T;
}
const bytesSha = (bytes: string): string => createHash('sha256').update(bytes).digest('hex');
export interface TradingFixture {
  manifest: FixtureManifest; sessions: Session[]; bars: Bar[]; actions: CorporateAction[];
  releases: Release[]; poison: Observation[]; strategies: Strategy[]; goldens: Golden[]; sha256: string;
}

export async function loadTradingFixture(root = TRADING_FIXTURE_PATH): Promise<TradingFixture> {
  if ((await lstat(join(root, 'manifest.json'))).isSymbolicLink()) throw new Error('Trading manifest must be a regular fixture file');
  const manifest = shaped<FixtureManifest>('fixtureManifest', JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')));
  if (!equalsJson(manifest.sha256.map(f => f.path), MEMBERS)) throw new Error('Trading fixture member registration differs');
  const disk = (await readdir(root)).filter(p => p !== 'golden').concat((await readdir(join(root, 'golden'))).map(p => `golden/${p}`)).sort();
  if (!equalsJson(disk, [...MEMBERS, 'manifest.json'].sort())) throw new Error('Unregistered trading fixture files');
  if (manifest.generatorSha256 !== bytesSha(await readFile(join(TRADING_ROOT, 'benchmark/scripts/trading-fixture.ts'), 'utf8')))
    throw new Error('Trading generator source drift');
  const documents = new Map<string, unknown>();
  for (const member of manifest.sha256) {
    const path = join(root, member.path), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Trading member is not a regular file: ${member.path}`);
    const bytes = await readFile(path, 'utf8');
    if (bytesSha(bytes) !== member.sha256) throw new Error(`Trading fixture hash drift: ${member.path}`);
    documents.set(member.path, JSON.parse(bytes));
  }
  const sessions = shaped<Session[]>('session', documents.get('sessions.json'), true);
  const bars = shaped<Bar[]>('bar', documents.get('bars.json'), true);
  const actions = shaped<CorporateAction[]>('corporateAction', documents.get('corporate-actions.json'), true);
  const releases = ['fundamentals', 'news', 'social', 'insiders', 'profiles'].flatMap(file => shaped<Release[]>('release', documents.get(`${file}.json`), true));
  const poison = shaped<Observation[]>('observation', documents.get('poison.json'), true);
  const strategies = shaped<Strategy[]>('strategy', documents.get('strategies.json'), true);
  const goldens = ['oracle', 'do-nothing', 'leaky'].map(id => shaped<Golden>('golden', documents.get(`golden/${id}.json`)));
  if (!sessions.length || new Set(sessions.map(s => s.id)).size !== sessions.length) throw new Error('Invalid trading session census');
  for (const [i, s] of sessions.entries()) {
    if (toEpoch(s.openAt) >= toEpoch(s.closeAt) || s.prev !== (sessions[i - 1]?.id ?? null) || s.next !== (sessions[i + 1]?.id ?? null)
      || i > 0 && toEpoch(sessions[i - 1].closeAt) >= toEpoch(s.openAt)) throw new Error(`Invalid trading session ${s.id}`);
  }
  const observations: Observation[] = [...bars, ...releases, ...actions, ...poison];
  if (new Set(observations.map(o => o.id)).size !== observations.length) throw new Error('Duplicate trading observation');
  for (const o of observations) {
    const { contentHash, ...body } = o;
    if (contentHash !== await canonicalSha256(body) || toEpoch(o.availableAt) < toEpoch(o.eventAt)) throw new Error(`Trading observation identity/time: ${o.id}`);
  }
  if (bars.length !== sessions.length * manifest.assets.length) throw new Error('Incomplete trading bars');
  for (const asset of manifest.assets) for (const session of sessions) {
    const found = bars.filter(b => b.asset === asset && b.sessionId === session.id);
    if (found.length !== 1) throw new Error(`Trading bar coverage: ${asset}/${session.id}`);
    const b = found[0], factor = actions.filter(a => a.asset === asset && a.action === 'split' && toEpoch(a.eventAt) <= toEpoch(b.eventAt)).reduce((n, a) => n * a.ratio!, 1);
    if (b.eventAt !== session.closeAt || toEpoch(b.availableAt) !== toEpoch(b.eventAt) + 15 * 60000 || b.high < Math.max(b.open, b.close)
      || b.low > Math.min(b.open, b.close) || b.adjustedClose !== Math.round(b.close * factor * 10000) / 10000)
      throw new Error(`Invalid trading bar or causal adjustment: ${b.id}`);
  }
  for (const golden of goldens) {
    const commission = golden.fills.reduce((n, f) => n + f.commission, 0), slippage = golden.fills.reduce((n, f) => n + f.slippage, 0);
    if (!equalsJson(golden.costs, { commission, slippage, total: commission + slippage })) throw new Error(`Trading golden cost drift: ${golden.id}`);
    if (new Set(golden.fills.map(f => f.id)).size !== golden.fills.length || new Set(golden.ledger.map(l => l.id)).size !== golden.ledger.length)
      throw new Error(`Duplicate golden fill/ledger identity: ${golden.id}`);
    const metrics = measureTradingEquity(golden.equity, manifest);
    if (!equalsJson(metrics, { metrics: golden.metrics, undefined: golden.undefined }) || golden.points.length !== sessions.length + 1
      || golden.equity[0] !== manifest.initialCapital || !equalsJson(golden.equity, golden.points.map(p => p.equity))) throw new Error(`Trading golden metric/coverage drift: ${golden.id}`);
    for (const [i, point] of golden.points.entries()) {
      if (point.sessionId !== (sessions[i - 1]?.id ?? null) || point.equity !== point.cash + point.positions.reduce((n, p) => n + p.quantity * p.mark, 0))
        throw new Error(`Unbalanced golden point: ${golden.id}/${i}`);
    }
    for (const asset of golden.perAsset) {
      if (!equalsJson(measureTradingEquity(asset.equity, manifest), { metrics: asset.metrics, undefined: asset.undefined })
        || asset.fills !== golden.fills.filter(f => f.asset === asset.asset).length) throw new Error(`Trading per-asset metric drift: ${asset.asset}`);
    }
  }
  return { manifest, sessions, bars, actions, releases, poison, strategies, goldens, sha256: await canonicalSha256(manifest) };
}

/** Hash the actual admitted values and derived windows, not just observation ids. */
export function preCutoffTradingSlice(fixture: TradingFixture, cutoffAt: string, poison: readonly Observation[] = []) {
  const cutoff = toEpoch(cutoffAt);
  const observations = [...fixture.bars, ...fixture.actions, ...fixture.releases, ...poison];
  const admitted = observations.filter(o => toEpoch(o.availableAt) <= cutoff);
  const bars = admitted.filter((o): o is Bar => o.kind === 'bar');
  const latest = asOfJoin(fixture.manifest.assets.map(asset => ({ asset, at: cutoffAt, value: null })), bars,
    { key: 'asset', direction: 'backward', right: { at: 'availableAt', value: 'adjustedClose' } });
  return { observations: admitted, latest: latest.map(m => ({ asset: m.left.asset as string, id: m.right?.id as string | undefined ?? null,
    adjustedClose: m.right?.value as number | undefined ?? null })),
  windows: fixture.manifest.assets.map(asset => {
    const window = bars.filter(b => b.asset === asset).sort((a, b) => toEpoch(a.eventAt) - toEpoch(b.eventAt));
    return { asset, bars: window, returns: returnsOf(window.map(b => b.adjustedClose)) };
  }) };
}

export async function auditTradingPoison(fixture: TradingFixture): Promise<PoisonAudit> {
  const cases: PoisonAudit['cases'] = [];
  for (const session of fixture.sessions) {
    const withoutSha256 = await canonicalSha256(preCutoffTradingSlice(fixture, session.closeAt));
    const withSha256 = await canonicalSha256(preCutoffTradingSlice(fixture, session.closeAt, fixture.poison));
    cases.push({ cutoffAt: session.closeAt, withoutSha256, withSha256,
      refused: fixture.poison.filter(o => toEpoch(o.availableAt) > toEpoch(session.closeAt)).map(o => o.id), influenced: Number(withoutSha256 !== withSha256) });
  }
  const influenced = cases.reduce((n, c) => n + c.influenced, 0);
  if (influenced) throw new Error(`Trading poison changed ${influenced} pre-cutoff slices`);
  return { cutoffs: cases.length, refused: cases.reduce((n, c) => n + c.refused.length, 0), influenced: 0, cases };
}
