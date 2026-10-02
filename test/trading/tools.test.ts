import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTradingReadTools, TRADING_READ_TOOLS } from '@tangleai/trading';
import { analystFixture } from './analyst-fixture.ts';

const invocation = (role: string) => ({ signal: new AbortController().signal, idempotencyKey: null, invocation: { runId: 'test', node: `analyst-${role}`, path: `main/analyst-${role}` } });
describe('cutoff-bound analyst tools', () => {
  it('an after-cutoff tool request is refused TTRD1003 and counted before any provider call', async () => {
    const f = await analystFixture(), tool = f.host.toolBindings['news-items'];
    const result = await tool.handler({ cutoffAt: '2026-01-01T00:00:00Z' }, invocation('news'));
    assert.match(JSON.stringify(result), /TTRD1003/); assert.equal(f.host.audit.calls, 1); assert.equal(f.host.audit.refusals.length, 1); assert.equal(f.host.audit.returned, 0);
  });
  it('all five tools read only their role evidence and narrow limits and publication cutoff', async () => {
    const f = await analystFixture(), roles = ['technical', 'fundamentals', 'news', 'sentiment', 'sentiment'];
    for (const [i, id] of TRADING_READ_TOOLS.entries()) {
      const result = await f.host.toolBindings[id].handler({ limit: 1, cutoffAt: f.snapshot.snapshot.cutoffAt }, invocation(roles[i])) as { observations: Array<{ id: string; digest: string }> };
      assert.ok(result.observations, JSON.stringify(result)); assert.ok(result.observations.length <= 1);
      for (const e of result.observations) assert.ok(f.snapshot.observations.some(o => o.id === e.id && o.revision === e.digest));
    }
  });
  it('foreign assets, wider ranges, hidden roles, unknown fields and invalid dates refuse', async () => {
    const f = await analystFixture(), tool = f.host.toolBindings['news-items'];
    for (const args of [{ asset: 'FOREIGN' }, { since: '1900-01-01T00:00:00Z' }, { until: '2028-01-01T00:00:00Z' }, { cutoffAt: 'invalid' }, { limit: 0 }])
      assert.ok('error' in (await tool.handler(args, invocation('news')) as object));
    assert.match(JSON.stringify(await tool.handler({}, invocation('fundamentals'))), /TTRD1003/);
    assert.match(JSON.stringify(await tool.handler({}, { signal: new AbortController().signal, idempotencyKey: null })), /TTRD1003/);
  });
  it('a provider cannot expand or mutate the frozen snapshot', async () => {
    const f = await analystFixture(), hidden = f.host.context.projections.fundamentals.evidence[0].observation;
    const tools = createTradingReadTools({ context: f.host.context, providers: { ...f.fixture.providers, news: { items: async () => ({ outcome: 'ok', snapshotId: 'forged', refused: [], value: [hidden] }) } } });
    const result = await tools.toolBindings['news-items'].handler({}, invocation('news'));
    assert.match(JSON.stringify(result), /TTRD1003/); assert.equal(tools.audit.returned, 0);
    assert.ok(Object.isFrozen(f.host.context.projections.news.evidence));
  });
  it('provider errors remain counted failures, without fallback', async () => {
    const f = await analystFixture(), tools = createTradingReadTools({ context: f.host.context, providers: { ...f.fixture.providers, news: { items: async () => { throw Error('offline'); } } } });
    assert.match(JSON.stringify(await tools.toolBindings['news-items'].handler({}, invocation('news'))), /TTRD1007/); assert.equal(tools.audit.refusals.length, 1);
  });
});
