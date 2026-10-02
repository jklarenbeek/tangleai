import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkTradeProposal, validateTradingRecord } from '@tangleai/trading';
import type { ResearchVerdict, TradeProposal, TradeProposalOutput, TradingOutcome } from '@tangleai/trading';
import { researchFixture, checked } from './research-fixture.ts';
import { reidentify } from './fixtures.ts';
import { scriptedModel, scriptedSpend } from './analyst-fixture.ts';

const f = await researchFixture(), run = await f.run(), result = run.output as { verdict: ResearchVerdict; proposal: TradeProposal };
assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
const output: TradeProposalOutput = { action: 'buy', quantity: 2, timing: 'next-open', horizon: 'Next session', rationale: 'Synthetic advice',
  citations: [{ id: result.verdict.id, digest: result.verdict.revision }], assumedPortfolioId: f.portfolio.id };
const input = { snapshot: f.snapshot.snapshot, portfolio: f.host.context.portfolio, reports: f.reports, verdict: result.verdict,
  artifact: f.catalog.prompt('trading-trader')!, provenance: { model: scriptedModel, spend: scriptedSpend() } };
const code = (o: TradingOutcome<unknown>) => o.valid ? null : o.issues[0].code;

it('a valid proposal binds its portfolio, prompt and report-only evidence without an execution record', async () => {
  const proposal = checked(await checkTradeProposal({ ...input, output }));
  assert.equal(proposal.kind, 'trade-proposal'); assert.equal(proposal.assumedPortfolioId, f.portfolio.id);
  assert.equal(proposal.researchVerdictId, result.verdict.id); assert.equal(proposal.quantity, 2); assert.equal(proposal.exceedsPosition, false);
  assert.equal((await validateTradingRecord(proposal)).valid, true);
  assert.ok(f.region.nodes.filter(n => n.kind === 'agent').every(n => !n.tools.length));
  assert.ok(f.region.registry.handlers.every(h => h.effect === 'pure' && !/commit|fill|ledger/.test(h.id)));
});
it('missing buy size, same-close timing, duplicate sizes, zero size and extra fields refuse TTRD1001', async () => {
  const { quantity: _quantity, ...withoutSize } = output;
  for (const invalid of [withoutSize, { ...output, timing: 'same-close' }, { ...output, targetWeight: 0.25 }, { ...output, quantity: 0 }, { ...output, maxRounds: 99 }])
    assert.equal(code(await checkTradeProposal({ ...input, output: invalid })), 'TTRD1001');
  assert.equal(code(await checkTradeProposal({ ...input, output: { ...withoutSize, action: 'hold' } })), null);
  assert.equal(code(await checkTradeProposal({ ...input, output: { ...withoutSize, targetWeight: 0.25 } })), null);
});
it('an observation citation, changed digest or another asset report refuses TTRD1004', async () => {
  for (const citations of [[{ id: f.snapshot.snapshot.observationIds[0], digest: '0'.repeat(64) }], [{ id: result.verdict.id, digest: '0'.repeat(64) }]])
    assert.equal(code(await checkTradeProposal({ ...input, output: { ...output, citations } })), 'TTRD1004');
  const foreign = await reidentify(f.reports[0], { key: { ...f.reports[0].key, asset: 'SYN-B' } });
  assert.equal(code(await checkTradeProposal({ ...input, reports: [foreign, ...f.reports.slice(1)], output: { ...output, citations: [{ id: foreign.id, digest: foreign.revision }] } })), 'TTRD1004');
});
it('overselling is retained as a counted proposal flag for the hard gate', async () => {
  const proposal = checked(await checkTradeProposal({ ...input, output: { ...output, action: 'sell', quantity: 10 } }));
  assert.equal(proposal.action, 'sell'); assert.equal(proposal.quantity, 10); assert.equal(proposal.exceedsPosition, true);
  assert.equal(proposal.kind, 'trade-proposal'); assert.deepEqual(f.host.context.portfolio, input.portfolio);
});
it('a different assumed portfolio and undeclared financial marks are refused', async () => {
  assert.equal(code(await checkTradeProposal({ ...input, output: { ...output, assumedPortfolioId: 'another-portfolio' } })), 'TTRD1002');
  assert.equal(code(await checkTradeProposal({ ...input, portfolio: { ...input.portfolio, equity: 1 } as typeof input.portfolio, output })), 'TTRD1001');
});
it('a readdressed verdict cannot smuggle a hidden native evidence citation', async () => {
  const native = structuredClone(result.verdict.result!); native.claims[0].citations[0].id = 'hidden-report:f1';
  const verdict = await reidentify(result.verdict, { result: native });
  assert.equal(code(await checkTradeProposal({ ...input, verdict, output: { ...output, citations: [{ id: verdict.id, digest: verdict.revision }] } })), 'TTRD1004');
});
it('invalid trader output fails after one native repair and produces no proposal', async () => {
  const script = f.response(), failed = await f.run({ response: (node, i, phase, messages) => node === 'trader' ? {} : script(node, i, phase, messages) });
  assert.equal(failed.status, 'failed'); assert.equal(failed.usage.repair, 1);
  assert.equal(failed.visibility.filter(v => v.node === 'trader').length, 3);
  assert.equal((failed.output as { proposal?: unknown } | null)?.proposal, undefined);
});
