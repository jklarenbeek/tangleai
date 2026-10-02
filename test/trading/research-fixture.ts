import { TRADING_ANALYST_ROLES, type AnalystReport, type TradingAnalystRole } from '@tangleai/trading';
import { analystFixture } from './analyst-fixture.ts';
import { prepareTradingResearchDrive } from '../../benchmark/lib/trading-research-runner.ts';
export { checked, promptJson, attemptProvenance } from '../../benchmark/lib/trading-research-runner.ts';
export async function researchFixture(rounds = 2) {
  const f = await analystFixture(60, { rolesByProfile: { analyst: 'scripted', research: 'scripted', trader: 'scripted' }, rounds: { research: rounds, risk: 2 } });
  const analysts = await f.run(); if (analysts.status !== 'completed') throw Error(JSON.stringify(analysts.trace.run.failure));
  const outputs = analysts.output as Record<TradingAnalystRole, AnalystReport>, reports = TRADING_ANALYST_ROLES.map(role => outputs[role]);
  return { ...f, ...await prepareTradingResearchDrive({ ...f, reports }) };
}
