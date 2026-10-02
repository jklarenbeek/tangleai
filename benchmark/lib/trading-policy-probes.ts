/** Each policy probe counts its fresh analyst/research setup separately from risk and manager calls. */
import { createTradingRecord, createFixtureProviders, buildSnapshot, TRADING_ANALYST_ROLES, tradingArtifacts } from '@tangleai/trading';
import { createGmplCatalog } from '@tangleai/gmpl';
import type { RiskPolicy, TradingRecord, TradingRunManifest, TradeProposal, ResearchVerdict, AnalystReport, TradingAnalystRole, RiskVerdictOutput, FundManagerOutput } from '@tangleai/trading';
import type { TradingAnalystExecution } from './trading-analysts.ts';
import { prepareTradingAnalystDrive } from './trading-analyst-runner.ts';
import { prepareTradingResearchDrive, checked } from './trading-research-runner.ts';
import { prepareTradingRiskDecisionDrive } from './trading-risk-runner.ts';

export const TRADING_POLICY_PROBES: ReadonlyArray<{ id: string; policy?: Partial<RiskPolicy>; quantity?: number; side?: 'buy' | 'sell';
  manager?: 'approved' | 'modified'; modelQuantity?: number; action?: 'adjust' | 'hold' | 'reject'; limit?: string; admitted: boolean; adjusted?: boolean }> = [
  { id: 'approval', admitted: true }, { id: 'hold', action: 'hold', admitted: false }, { id: 'rejection', action: 'reject', admitted: false },
  { id: 'trader-size', manager: 'modified', modelQuantity: 500, admitted: true, adjusted: true },
  { id: 'policy-size', manager: 'modified', quantity: 1000, policy: { singleName: 0.01 }, admitted: true, adjusted: true },
  { id: 'cash', quantity: 100000, limit: '/riskPolicy/cashFloor', admitted: false },
  { id: 'gross', policy: { grossExposure: 0 }, limit: '/riskPolicy/grossExposure', admitted: false },
  { id: 'net', policy: { netExposure: 0 }, limit: '/riskPolicy/netExposure', admitted: false },
  { id: 'concentration', policy: { singleName: 0 }, limit: '/riskPolicy/singleName', admitted: false },
  { id: 'cash-floor', policy: { cashFloor: 100000 }, limit: '/riskPolicy/cashFloor', admitted: false },
  { id: 'liquidity', policy: { maxParticipation: 0 }, limit: '/riskPolicy/maxParticipation', admitted: false },
  { id: 'loss-floor', policy: { lossLimit: 0 }, limit: '/riskPolicy/lossLimit', admitted: false },
  { id: 'short', side: 'sell', limit: '/shorting', admitted: false },
];

export async function runTradingPolicyProbe(source: TradingAnalystExecution, probe: typeof TRADING_POLICY_PROBES[number]) {
  const { id: _id, revision: _revision, kind: _kind, ...body } = source.manifest;
  const manifest: TradingRunManifest = checked(await createTradingRecord('manifest', { ...body, riskPolicy: { ...source.manifest.riskPolicy, ...probe.policy } }));
  const rebind = async <T extends TradingRecord>(record: T): Promise<T> => {
    const { id: _id, revision: _revision, kind, ...data } = record;
    return checked(await createTradingRecord(kind, { ...data, manifestId: manifest.id } as never)) as T;
  };
  const sessions = await Promise.all(source.sessions.map(rebind)), observations = await Promise.all(source.observations.map(rebind)), portfolio = await rebind(source.portfolio);
  const catalog = checked(await createGmplCatalog(tradingArtifacts));
  const providers = checked(await createFixtureProviders({ manifestId: manifest.id, sessions, observations, eventAt: '2024-12-31T00:00:00Z', availableAt: '2024-12-31T12:00:00Z' })).providers;
  const snapshot = checked(await buildSnapshot({ manifest, asset: manifest.assets[0], session: sessions[60], portfolio, providers }));
  const content = { manifest, catalog, snapshot, portfolio }, analysis = await prepareTradingAnalystDrive({ ...content, providers }), arun = await analysis.run();
  if (arun.status !== 'completed') throw Error('Policy probe analyst setup failed: ' + JSON.stringify(arun.trace.run.failure));
  const reports = TRADING_ANALYST_ROLES.map(role => (arun.output as Record<TradingAnalystRole, AnalystReport>)[role]);
  const research = await prepareTradingResearchDrive({ ...content, reports }), script = research.response(), quantity = probe.quantity ?? 2, action = probe.side ?? 'buy';
  const rrun = await research.run({ response: async (node, i, phase, messages) => {
    const out = await script(node, i, phase, messages); return node === 'trader' ? { ...out as object, action, quantity } : out;
  } });
  if (rrun.status !== 'completed') throw Error('Policy probe research setup failed: ' + JSON.stringify(rrun.trace.run.failure));
  const { proposal, verdict } = rrun.output as { proposal: TradeProposal; verdict: ResearchVerdict };
  const composed = await prepareTradingRiskDecisionDrive({ ...content, reports, proposal, verdict }), response = composed.response(probe.action ?? 'adjust');
  const run = await composed.run({ response: async (node, i, phase, messages) => {
    const out = await response(node, i, phase, messages);
    if (node === 'risk-facilitator' && (!probe.action || probe.action === 'adjust')) (out as RiskVerdictOutput).adjustedIntent = { action, quantity };
    if (node === 'fund-manager' && (!probe.action || probe.action === 'adjust')) {
      const fund = out as FundManagerOutput; fund.decision = probe.manager ?? 'approved'; fund.finalIntent = { action, quantity: probe.modelQuantity ?? quantity };
    }
    return out;
  } });
  return { run, setupPhysicalCalls: arun.usage.physical + rrun.usage.physical };
}
