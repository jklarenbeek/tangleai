import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkFundManagerDecision, toOrderIntent, type RiskVerdict, type FundManagerOutput } from '@tangleai/trading';
import { riskFixture, checked } from './risk-fixture.ts';
import { scriptedModel, scriptedSpend } from './analyst-fixture.ts';
import { prepareTradingRiskDecisionDrive } from '../../benchmark/lib/trading-risk-runner.ts';

const f = await riskFixture(), run = await f.run({ response: f.response('adjust') });
assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
const riskVerdict = (run.output as { verdict: RiskVerdict }).verdict;
const input = { proposal: f.proposal, riskVerdict, snapshot: f.snapshot.snapshot, artifact: f.catalog.prompt('trading-fund-manager')!,
  provenance: { model: scriptedModel, spend: scriptedSpend() } };
const output: FundManagerOutput = { decision: 'approved', finalIntent: { action: 'buy', quantity: 1 }, reasons: ['Synthetic approval'],
  citations: [{ id: f.proposal.id, digest: f.proposal.revision }, { id: riskVerdict.id, digest: riskVerdict.revision }],
  inputProposalId: f.proposal.id, inputRiskVerdictId: riskVerdict.id };

it('a fund-manager artifact preserves exact proposal, verdict, prompt and observed provenance', async () => {
  const decision = checked(await checkFundManagerDecision({ ...input, output }));
  assert.equal(decision.proposalId, f.proposal.id); assert.equal(decision.riskVerdictId, riskVerdict.id); assert.equal(decision.action, 'approve');
  assert.deepEqual(decision.finalIntent, output.finalIntent); assert.deepEqual(decision.spend, input.provenance.spend);
  assert.deepEqual(checked(await checkFundManagerDecision({ ...input, output })), decision);
});
for (const decisionKind of ['rejected', 'approved'] as const) it(`${decisionKind} with hold produces no order`, async () => {
  const decision = checked(await checkFundManagerDecision({ ...input, output: { ...output, decision: decisionKind, finalIntent: { action: 'hold' } } }));
  const admission = checked(await toOrderIntent({ manifest: f.manifest, snapshot: f.snapshot, portfolio: f.portfolio, proposal: f.proposal, riskVerdict, decision }));
  assert.equal(admission.intent, null); assert.deepEqual(admission.violations, []);
});
it('an approval citing an id outside the proposal and risk verdict fails TTRD1004', async () => {
  for (const citation of [{ id: f.reports[0].id, digest: f.reports[0].revision }, { id: riskVerdict.id, digest: 'f'.repeat(64) }]) {
    const refused = await checkFundManagerDecision({ ...input, output: { ...output, citations: [citation] } });
    assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1004');
  }
});
it('substituted input ids and a rejection with a buy intent refuse', async () => {
  for (const delta of [{ inputProposalId: f.reports[0].id }, { inputRiskVerdictId: f.proposal.id }, { decision: 'rejected' }])
    assert.equal((await checkFundManagerDecision({ ...input, output: { ...output, ...delta } })).valid, false);
});
it('the fund manager is the only model output reaching deterministic order admission', async () => {
  const composed = await prepareTradingRiskDecisionDrive(f);
  assert.deepEqual(composed.region.messages.filter(m => m.to.node === 'order-validate' && m.to.port === 'decision').map(m => m.from), [{ node: 'check-fund-manager', port: 'decision' }]);
  const run = await composed.run(); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const value = run.output as { decision: { spend: { calls: number } }; admission: { intent: unknown; violations: unknown[] } };
  assert.equal(run.usage.physical, 18); assert.equal(value.decision.spend.calls, 2); assert.ok(value.admission.intent);
  assert.deepEqual(value.admission.violations, []);
});
