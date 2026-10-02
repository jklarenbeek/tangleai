import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRADING_ANALYST_ROLES, checkAnalystReport, prepareTradingAnalystContext, buildAnalystRegion, createTradingHostBindings } from '@tangleai/trading';
import type { TradingAnalystRole, AnalystReport } from '@tangleai/trading';
import { analystFixture, scriptedModel, scriptedSpend } from './analyst-fixture.ts';
import { reidentify } from './fixtures.ts';
import indicatorReference from '../fixtures/trading-indicators.json' with { type: 'json' };

describe('immutable analyst lanes', () => {
  it('four lanes start before any is released', async () => {
    const f = await analystFixture(), arrived = new Set<string>();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const result = await f.run({ beforeCall: async (node, _invocation, phase) => {
      if (phase !== 'completion') return;
      arrived.add(node); if (arrived.size === 4) release(); await gate;
    } });
    assert.equal(result.status, 'completed', JSON.stringify(result.trace.attempts.filter(a => a.status !== 'completed')));
    const firstSettle = result.events.findIndex(e => /^analyst-[^/]+:completed$/.test(e));
    assert.ok(firstSettle >= 0, JSON.stringify(result.events));
    for (const role of TRADING_ANALYST_ROLES) assert.ok(result.events.indexOf(`analyst-${role}:enter`) >= 0 && result.events.indexOf(`analyst-${role}:enter`) < firstSettle);
    assert.equal(result.usage.roles, 4); assert.equal(result.usage.physical, 8); assert.equal(result.usage.repair, 0);
    const reports = result.output as Record<TradingAnalystRole, AnalystReport>;
    for (const role of TRADING_ANALYST_ROLES) { assert.equal(reports[role].spend.calls, 2); assert.equal(reports[role].spend.tokens, 20); }
  });
  it('every citation resolves inside the role projection and prompts expose no hidden slice or delayed mark', async () => {
    const f = await analystFixture(), result = await f.run(); assert.equal(result.status, 'completed');
    const reports = result.output as Record<TradingAnalystRole, AnalystReport>;
    for (const role of TRADING_ANALYST_ROLES) {
      const visible = f.host.context.projections[role].evidence;
      for (const finding of reports[role].analysis!.findings) for (const citation of finding.citations) assert.ok(visible.some(e => e.id === citation.id && e.digest === citation.digest));
      const messages = result.visibility.filter(v => v.node === `analyst-${role}` && v.phase === 'completion').flatMap(v => v.messages);
      const rendered = messages.map(m => m.content).join('\n');
      for (const other of TRADING_ANALYST_ROLES.filter(r => r !== role)) for (const e of f.host.context.projections[other].evidence) assert.equal(rendered.includes(e.id), false);
      assert.equal(rendered.includes('"marks"'), false); assert.equal(rendered.includes('"equity"'), false);
    }
    assert.ok(f.host.context.projections.technical.signals.some(s => s.value !== null));
    assert.equal(f.host.context.projections.news.signals.length, 0);
  });
  it('the technical projection exposes numeric native indicators from admitted bars', async () => {
    const f = await analystFixture(30), projection = f.host.context.projections.technical;
    const indicators = projection.indicators;
    assert.ok(indicators); assert.equal(indicators.observations, 30);
    const expected = indicatorReference.cases.find(c => c.id === f.snapshot.snapshot.asset)!.expected;
    for (const key of ['adx', 'plusDI', 'minusDI', 'cci', 'vwap', 'volumeRatio', 'k', 'd', 'j'] as const) {
      const actual = indicators.values[key], wanted = expected[key][29];
      assert.ok(actual !== null && wanted !== null && Math.abs(actual - wanted) < 1e-10, key);
    }
    for (const role of ['fundamentals', 'news', 'sentiment'] as const) assert.equal(f.host.context.projections[role].indicators, null);
  });
  for (const attack of ['invented', 'hidden', 'digest'] as const) it(`a ${attack} citation fails closed TTRD1004`, async () => {
    const f = await analystFixture(), out = f.report('news');
    out.findings[0].citations[0] = attack === 'hidden' ? { id: f.host.context.projections.fundamentals.evidence[0].id, digest: f.host.context.projections.fundamentals.evidence[0].digest }
      : { id: attack === 'invented' ? 'invented-evidence' : out.findings[0].citations[0].id, digest: '9'.repeat(64) };
    const checked = await checkAnalystReport({ output: out, projection: f.host.context.projections.news, snapshot: f.snapshot.snapshot,
      artifact: f.catalog.prompt('trading-analyst-news')!, provenance: { model: scriptedModel, spend: scriptedSpend() } });
    assert.equal(checked.valid, false); if (!checked.valid) assert.equal(checked.issues[0].code, 'TTRD1004');
    const run = await f.run({ response: node => node === 'analyst-news' ? out : f.report(node.replace('analyst-', '') as TradingAnalystRole) });
    assert.equal(run.status, 'failed'); assert.match(JSON.stringify(run.trace), /TTRD1004/);
  });
  it('an invalid report fails the stage after one repair', async () => {
    const f = await analystFixture(), result = await f.run({ response: node => node === 'analyst-news' ? {} : f.report(node.replace('analyst-', '') as TradingAnalystRole) });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.visibility.filter(v => v.node === 'analyst-news').map(v => v.phase), ['completion', 'normalization', 'repair']);
    assert.match(JSON.stringify(result.trace), /permanently invalid after one repair/);
  });
  it('a model tool request uses the native read boundary and its continuation is counted as completion', async () => {
    const f = await analystFixture(), requested = new Set<string>();
    const result = await f.run({ complete: async (node, _iteration, _phase, request) => {
      const raw = request as { messages: Array<{ role: string; content: string }> };
      if (node === 'analyst-news' && !requested.has(node)) {
        requested.add(node);
        return { message: { role: 'assistant', content: '', toolCalls: [{ id: 'future-read', name: 'news-items', arguments: JSON.stringify({ cutoffAt: '2026-01-01T00:00:00Z' }) }] },
          finishReason: 'tool_calls', usage: { prompt_tokens: 7, completion_tokens: 3 } };
      }
      if (node === 'analyst-news') assert.ok(raw.messages.some(m => m.role === 'tool' && m.content.includes('TTRD1003')));
      return { message: { role: 'assistant', content: JSON.stringify(f.report(node.replace('analyst-', '') as TradingAnalystRole)) }, finishReason: 'stop', usage: { prompt_tokens: 7, completion_tokens: 3 } };
    } });
    assert.equal(result.status, 'completed', JSON.stringify(result.trace.attempts));
    assert.equal(result.usage.tools, 1); assert.equal(f.host.audit.refusals.length, 1);
    assert.equal(result.usage.physical, 9); assert.equal(result.usage.roles, 4); assert.equal(result.usage.repair, 0);
    assert.deepEqual(result.visibility.filter(v => v.node === 'analyst-news').map(v => v.phase), ['completion', 'completion', 'normalization']);
  });
  it('an exhausted shared budget stops before the fourth completion with zero further calls', async () => {
    const f = await analystFixture(), result = await f.run({ runLimits: { calls: 3 } });
    assert.equal(result.status, 'failed'); assert.equal(result.usage.physical, 3); assert.ok(result.usage.roles < 4);
    assert.equal(result.usage.completion + result.usage.normalization, 3); assert.equal(result.usage.repair, 0);
    assert.match(JSON.stringify(result.trace), /TMAS2009/);
  });
  it('reports without evidence must explicitly abstain', async () => {
    const f = await analystFixture(0), projection = f.host.context.projections.news;
    for (const [signal, confidence, limitations] of [['bullish', 0.8, ['Missing']], ['neutral', 0, []]] as const) {
      const checked = await checkAnalystReport({ output: { findings: [], signal, confidence, horizon: 'Next session', limitations }, projection,
        snapshot: f.snapshot.snapshot, artifact: f.catalog.prompt('trading-analyst-news')!, provenance: { model: scriptedModel, spend: scriptedSpend() } });
      assert.equal(checked.valid, false);
    }
    assert.equal((await f.run()).status, 'completed');
  });
  it('a forged role projection cannot authorize a hidden citation', async () => {
    const f = await analystFixture(), foreign = f.host.context.projections.fundamentals.evidence[0];
    const projection = { ...f.host.context.projections.news, evidence: [foreign] }, output = f.report('news');
    output.findings[0].citations = [{ id: foreign.id, digest: foreign.digest }];
    const result = await checkAnalystReport({ output, projection, snapshot: f.snapshot.snapshot,
      artifact: f.catalog.prompt('trading-analyst-news')!, provenance: { model: scriptedModel, spend: scriptedSpend() } });
    assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, 'TTRD1004');
  });
  it('scope, calendar, manifest catalog and concurrency substitutions refuse before clients run', async () => {
    const f = await analystFixture(), source = { manifest: f.manifest, snapshot: f.snapshot, portfolio: f.portfolio };
    const future = f.observations.find(o => o.asset === f.snapshot.snapshot.asset && o.availableAt > f.snapshot.snapshot.cutoffAt)!;
    assert.equal((await prepareTradingAnalystContext({ ...source, snapshot: { ...f.snapshot, observations: [...f.snapshot.observations, future] } })).valid, false);
    assert.equal((await prepareTradingAnalystContext({ ...source, snapshot: { ...f.snapshot, sessions: f.sessions.slice(1) } })).valid, false);
    assert.equal((await buildAnalystRegion({ catalog: f.catalog, profile: 'scripted', limits: { ...f.manifest.limits, concurrency: 3 } })).valid, false);
    assert.equal((await createTradingHostBindings({ ...source, manifest: await reidentify(f.manifest, { promptCatalogRevision: '0'.repeat(64) }), catalog: f.catalog,
      providers: f.fixture.providers, provenance: () => ({ valid: true, value: { model: scriptedModel, spend: scriptedSpend() } }) })).valid, false);
  });
  it('host bindings detach content before asynchronous work and bind the declared model profile', async () => {
    const f = await analystFixture(), snapshot = structuredClone(f.snapshot), manifest = structuredClone(f.manifest);
    const pending = createTradingHostBindings({ catalog: f.catalog, manifest, snapshot, portfolio: f.portfolio, providers: f.fixture.providers,
      provenance: () => ({ valid: true, value: { model: { ...scriptedModel, profile: 'foreign-profile' }, spend: scriptedSpend() } }) });
    snapshot.observations.length = 0; manifest.assets.length = 0;
    const host = await pending; assert.ok(host.valid, JSON.stringify(host));
    const args = { state: {}, node: 'prepare-analyst-news', path: 'prepare-analyst-news', idempotencyKey: 'test', signal: new AbortController().signal };
    const prepared = await host.value.taskHandlers['prepare-analyst-news']({ ...args, value: { snapshot: f.snapshot.snapshot } }) as { variables: unknown };
    await assert.rejects(async () => host.value.taskHandlers['check-analyst-news']({ ...args, node: 'check-analyst-news', value: { ...prepared, out: f.report('news') } }), /TTRD1002/);
  });
});
