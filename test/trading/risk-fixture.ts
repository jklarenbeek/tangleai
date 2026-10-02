import { TRADING_ANALYST_ROLES, type AnalystReport, type ResearchVerdict, type TradeProposal, type TradingAnalystRole, type TradingRunManifest, type TradingProposedIntent } from '@tangleai/trading';
import { analystFixture } from './analyst-fixture.ts';
import { prepareTradingResearchDrive, checked, promptJson, attemptProvenance } from '../../benchmark/lib/trading-research-runner.ts';
import { prepareTradingRiskDrive } from '../../benchmark/lib/trading-risk-runner.ts';
export { checked, promptJson, attemptProvenance };
export async function riskFixture(overrides: Partial<TradingRunManifest> = {}, intent: TradingProposedIntent = { action: 'buy', quantity: 2 }, sessionIndex = 60) {
  const f = await analystFixture(sessionIndex, { rolesByProfile: { analyst: 'scripted', research: 'scripted', trader: 'scripted', risk: 'scripted', 'fund-manager': 'scripted' }, rounds: { research: 2, risk: 2 }, ...overrides });
  const analysis = await f.run(); if (analysis.status !== 'completed') throw Error(JSON.stringify(analysis.trace.run.failure));
  const outputs = analysis.output as Record<TradingAnalystRole, AnalystReport>, reports = TRADING_ANALYST_ROLES.map(r => outputs[r]);
  const research = await prepareTradingResearchDrive({ ...f, reports }), script = research.response();
  const run = await research.run({ response: async (node, i, phase, messages) => {
    const output = await script(node, i, phase, messages);
    if (node !== 'trader') return output;
    const { quantity: _quantity, targetWeight: _weight, ...proposal } = output as TradeProposal;
    return { ...proposal, ...intent };
  } });
  if (run.status !== 'completed') throw Error(JSON.stringify(run.trace.run.failure));
  const { verdict, proposal } = run.output as { verdict: ResearchVerdict; proposal: TradeProposal };
  return { ...f, reports, verdict, proposal, ...await prepareTradingRiskDrive({ ...f, reports, verdict, proposal }) };
}
