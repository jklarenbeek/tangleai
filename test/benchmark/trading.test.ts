import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createReportValidator } from '../../benchmark/lib/validate.ts';
import schema from '../../benchmark/schemas/trading.schema.json' with { type: 'json' };
import { generateTradingFixture } from '../../benchmark/scripts/trading-fixture.ts';
import { loadTradingFixture, preCutoffTradingSlice, auditTradingPoison, TRADING_FIXTURE_PATH } from '../../benchmark/lib/trading.ts';
import { buildTradingReport, validateTradingReport, tradingSource, renderReport, renderDocument, requireCapability } from '../../benchmark/lib/trading-report.ts';
import { measureTradingEquity } from '../../benchmark/lib/trading-metrics.ts';
import type { FixtureManifest, Golden, Trading } from '../../benchmark/lib/trading.types.ts';

const exec = promisify(execFile), fixture = await loadTradingFixture();
const source = { head: '1'.repeat(40), clean: true, files: [], sha256: await canonicalSha256({ head: '1'.repeat(40), files: [] }) };
const report = await buildTradingReport({ source });
async function rehash(value: Trading): Promise<Trading> { const { reportId: _, ...body } = value; value.reportId = await canonicalSha256(body); return value; }
const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

describe('registered trading measurement', () => {
  it('regenerates all original MIT fixture bytes with recorded provenance', async () => {
    assert.equal(fixture.manifest.licence, 'MIT'); assert.match(fixture.manifest.provenance, /Tangle-authored/);
    assert.equal(fixture.sessions.length, 124); assert.equal(fixture.bars.length, 248); assert.equal(fixture.manifest.seed, 7331);
    const generated = await generateTradingFixture(); assert.equal(generated.size, 14);
    for (const [path, bytes] of generated) assert.equal(await readFile(join(TRADING_FIXTURE_PATH, path), 'utf8'), bytes, path);
    for (const file of fixture.manifest.sha256) assert.equal(hash(generated.get(file.path)!), file.sha256);
  });
  it('reproduces privileged and cash controls while excluding the leaky control', () => {
    assert.equal(report.rows.length, 10);
    for (const id of ['oracle', 'do-nothing']) {
      const row = report.rows.find(r => r.id === id)!, golden = fixture.goldens.find(g => g.id === id)!;
      assert.equal(row.status, 'measured'); assert.equal(row.eligibility.eligible, true);
      for (const metric of ['cr', 'ar', 'sharpe', 'mdd'] as const) assert.equal(row.metrics![metric]?.toFixed(12), golden.metrics[metric]?.toFixed(12));
    }
    const cash = report.rows.find(r => r.id === 'do-nothing')!;
    assert.deepEqual([cash.metrics!.cr, cash.metrics!.mdd, cash.metrics!.sharpe], [0, 0, null]);
    assert.deepEqual(cash.undefined, [{ metric: 'sharpe', reason: 'zero volatility' }]);
    const leaky = report.rows.find(r => r.id === 'leaky')!;
    assert.equal(leaky.status, 'excluded'); assert.equal(leaky.eligibility.eligible, false); assert.equal(leaky.reason, 'reads observations after cutoff');
    assert.equal(fixture.manifest.loserAsset, 'SYN-B');
    const loser = fixture.bars.filter(b => b.asset === 'SYN-B'); assert.ok(loser.at(-1)!.adjustedClose < loser[0].adjustedClose);
    assert.equal(report.counts.implementationMissing, 6); assert.equal(report.counts.notRun, 1);
    for (const capability of ['instrument', 'controls']) assert.doesNotThrow(() => requireCapability(report, capability));
    for (const capability of ['baselines', 'agent', 'complete', 'unknown']) assert.throws(() => requireCapability(report, capability));
  });
  it('poison values and derived returns have zero influence at every decision cutoff', async () => {
    assert.equal(report.poison.cutoffs, 124); assert.equal(report.poison.refused, 372); assert.equal(report.poison.influenced, 0);
    for (const session of fixture.sessions) {
      const before = preCutoffTradingSlice(fixture, session.closeAt), after = preCutoffTradingSlice(fixture, session.closeAt, fixture.poison);
      assert.deepEqual(after, before);
      assert.ok(before.observations.every(o => o.availableAt <= session.closeAt));
      assert.ok(before.windows.every(w => w.bars.every(b => b.sessionId !== session.id)));
    }
    const broken = structuredClone(fixture); broken.poison[0].availableAt = fixture.sessions[11].closeAt;
    await assert.rejects(auditTradingPoison(broken), /poison changed/);
    const session = fixture.sessions[20], before = preCutoffTradingSlice(fixture, session.closeAt);
    const atPublication = preCutoffTradingSlice(fixture, `${session.date}T21:15:00Z`);
    assert.ok(before.latest.every(l => l.id !== `${l.asset.toLowerCase()}:${session.id}:bar`));
    assert.ok(atPublication.latest.every(l => l.id === `${l.asset.toLowerCase()}:${session.id}:bar`));
  });
  it('declares causal split normalization and retains exact cash-action entitlement', () => {
    const split = fixture.actions.find(a => a.action === 'split')!, before = fixture.bars.filter(b => b.asset === 'SYN-A' && b.eventAt < split.eventAt);
    assert.ok(before.every(b => b.adjustedClose === b.close));
    assert.ok(fixture.bars.filter(b => b.asset === 'SYN-A' && b.eventAt >= split.eventAt).every(b => b.adjustedClose === Math.round(b.close * 2 * 10000) / 10000));
    for (const golden of fixture.goldens) for (const point of golden.points) assert.equal(point.equity, point.cash + point.positions.reduce((n, p) => n + p.quantity * p.mark, 0));
    assert.ok(fixture.goldens.find(g => g.id === 'oracle')!.ledger.some(l => l.credit === 'dividends'));
  });
  it('maps degenerate native finance results to null with explicit reasons', () => {
    for (const curve of [[], [100], [0, 100, 101], [100, 100, 100]]) {
      const result = measureTradingEquity(curve, fixture.manifest);
      for (const metric of ['cr', 'ar', 'sharpe', 'mdd'] as const) {
        assert.equal(result.metrics[metric] === null, result.undefined.some(u => u.metric === metric));
        if (result.metrics[metric] !== null) assert.ok(Number.isFinite(result.metrics[metric]));
      }
    }
    assert.throws(() => measureTradingEquity([100, NaN], fixture.manifest), /finite/);
  });
  it('report refuses a typed annualization and rehashed fabricated measurements', async () => {
    const mutations: Array<(r: Trading) => void> = [
      r => { r.conventions.annualization = 252; }, r => { r.rows[0].metrics!.cr = 4; }, r => { r.rows[0].costs.total = 0; },
      r => { r.rows[2].eligibility.eligible = true; }, r => { r.rows[3].status = 'measured'; }, r => { r.rows[0].transactions++; },
      r => { r.rows[0].perAsset[1].cr = 1; }, r => { r.rows[1].undefined = []; }, r => { r.counts.measured++; },
      r => { r.rows.pop(); }, r => { r.rows[1].id = r.rows[0].id; }, r => { r.registration[0].description = 'forged'; },
      r => { r.poison.refused--; }, r => { r.poison.cases[0].withSha256 = '0'.repeat(64); },
      r => { r.capabilities.complete = true; }, r => { r.fixture.sha256 = '0'.repeat(64); }, r => { r.source.sha256 = '0'.repeat(64); },
    ];
    for (const mutate of mutations) { const copy = structuredClone(report); mutate(copy); assert.equal((await validateTradingReport(await rehash(copy))).valid, false); }
    const badHash = structuredClone(report); badHash.reportId = '0'.repeat(64); assert.equal((await validateTradingReport(badHash)).valid, false);
    assert.equal((await validateTradingReport(report)).valid, true);
  });
  it('native schema assertions reconcile row identity, exclusions and counts', () => {
    const validate = createReportValidator(schema); assert.equal(validate(report).valid, true);
    for (const mutate of [(r: Trading) => { r.rows[1].id = r.rows[0].id; }, (r: Trading) => { r.rows[2].reason = null; },
      (r: Trading) => { r.counts.measured++; }, (r: Trading) => { r.counts.transactions++; }]) {
      const copy = structuredClone(report); mutate(copy); assert.equal(validate(copy).valid, false);
    }
  });
  it('reproduces reports without a clock or network and binds current owner bytes', async () => {
    const original = globalThis.fetch; let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Network forbidden'); };
    try { const again = await buildTradingReport({ source }); assert.equal(renderReport(again), renderReport(report)); assert.equal(renderDocument(again), renderDocument(report)); }
    finally { globalThis.fetch = original; }
    assert.equal(requests, 0);
    const committed = JSON.parse(await readFile('benchmark/results/trading.json', 'utf8')) as Trading;
    assert.equal((await validateTradingReport(committed)).valid, true);
    const current = await tradingSource(); assert.deepEqual(committed.source.files, current.files);
    const rebuilt = await buildTradingReport({ source: committed.source });
    assert.equal(renderReport(rebuilt), await readFile('benchmark/results/trading.json', 'utf8'));
    assert.equal(renderDocument(rebuilt), await readFile('docs/TRADING_BENCHMARK.md', 'utf8'));
  });
  it('fixture checks refuse byte drift, path substitution and rehashed false goldens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trading-fixture-'));
    try {
      await cp(TRADING_FIXTURE_PATH, dir, { recursive: true });
      const run = (...args: string[]) => exec(process.execPath, ['benchmark/scripts/trading-fixture.ts', '--out-dir', dir, ...args]);
      await run('--check'); const file = join(dir, 'bars.json'), bytes = await readFile(file, 'utf8');
      await writeFile(file, bytes + ' '); await assert.rejects(run('--check'), /drift/); await assert.rejects(loadTradingFixture(dir), /hash drift/); await writeFile(file, bytes);
      const manifestFile = join(dir, 'manifest.json'), original = await readFile(manifestFile, 'utf8');
      const manifest = JSON.parse(original) as FixtureManifest; manifest.sha256[0].path = '../bars.json';
      await writeFile(manifestFile, JSON.stringify(manifest)); await assert.rejects(loadTradingFixture(dir), /member registration/); await writeFile(manifestFile, original);
      const goldenFile = join(dir, 'golden/oracle.json'), golden = JSON.parse(await readFile(goldenFile, 'utf8')) as Golden;
      golden.costs.commission += 10;
      const altered = JSON.stringify(golden); await writeFile(goldenFile, altered);
      const revised = JSON.parse(original) as FixtureManifest; revised.sha256.find(f => f.path === 'golden/oracle.json')!.sha256 = hash(altered);
      await writeFile(manifestFile, JSON.stringify(revised)); await assert.rejects(loadTradingFixture(dir), /golden cost/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('CLI detects drift without writing and refuses malformed or unavailable requests before output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'trading-cli-'));
    try {
      const run = (...args: string[]) => exec(process.execPath, ['benchmark/trading.ts', ...args], { maxBuffer: 1024 * 1024 });
      await run('--out-dir', dir, '--require', 'controls'); assert.deepEqual((await readdir(dir)).sort(), ['TRADING_BENCHMARK.md', 'trading.json']);
      const file = join(dir, 'trading.json'), bytes = await readFile(file, 'utf8'), before = await stat(file);
      await run('--out-dir', dir, '--check'); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
      const retained = JSON.parse(bytes) as Trading;
      retained.source.head = 'b'.repeat(40); retained.source.clean = false;
      retained.source.sha256 = await canonicalSha256({ head: retained.source.head, files: retained.source.files });
      await rehash(retained);
      await writeFile(file, renderReport(retained)); await writeFile(join(dir, 'TRADING_BENCHMARK.md'), renderDocument(retained));
      await run('--out-dir', dir, '--check');
      retained.source.files[0].sha256 = '0'.repeat(64);
      retained.source.sha256 = await canonicalSha256({ head: retained.source.head, files: retained.source.files });
      await rehash(retained);
      await writeFile(file, renderReport(retained)); await writeFile(join(dir, 'TRADING_BENCHMARK.md'), renderDocument(retained));
      await assert.rejects(run('--out-dir', dir, '--check'), /source drift/);
      await writeFile(file, bytes + ' '); const drifted = await stat(file);
      await assert.rejects(run('--out-dir', dir, '--check'), /drift/); assert.equal((await stat(file)).mtimeMs, drifted.mtimeMs);
      for (const capability of ['complete', 'unknown']) { await assert.rejects(run('--require', capability, '--out-dir', join(dir, 'absent'))); await assert.rejects(stat(join(dir, 'absent'))); }
      for (const args of [['--check=yes'], ['--json'], ['--json', '--check'], ['--unknown'], ['positional'], ['--out-dir=x'], ['--json', file, '--md', file]]) await assert.rejects(run(...args));
      const alt = join(dir, 'explicit'); await run('--json', join(alt, 'report.json'), '--md', join(alt, 'report.md'));
      assert.deepEqual((await readdir(alt)).sort(), ['report.json', 'report.md']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
