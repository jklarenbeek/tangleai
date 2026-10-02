/** Measured risk and fund-manager stages consume the retained research outputs directly. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGmplCatalog } from '@tangleai/gmpl';
import { tradingArtifacts, createMemoryTradingStore, initializeTradingRisk, collectTradingRiskTurns } from '@tangleai/trading';
import type { RiskVerdict, RiskTurn, FundManagerDecision, TradingOrderAdmission, RiskVerdictOutput } from '@tangleai/trading';
import type { RiskMeasurement, FundManagerMeasurement, ResearchProbeMeasurement } from './trading.types.ts';
import type { TradingFixture } from './trading.ts';
import { tradingResearchExecution } from './trading-research.ts';
import { prepareTradingRiskDecisionDrive } from './trading-risk-runner.ts';
import { runTradingPolicyProbe, TRADING_POLICY_PROBES } from './trading-policy-probes.ts';
import { checked } from './trading-research-runner.ts';

type Output = { verdict: RiskVerdict; turns: RiskTurn[]; decision: FundManagerDecision; admission: TradingOrderAdmission };
const zeroUsage = () => ({ physicalCalls: 0, normalizations: 0, repairs: 0, replays: 0, restores: 0 });
async function executeRisk(fixture: TradingFixture): Promise<[RiskMeasurement, FundManagerMeasurement]> {
  const research = await tradingResearchExecution(fixture), { analysts } = research, { manifest, portfolio } = analysts;
  const catalog = checked(await createGmplCatalog(tradingArtifacts)), researchMeasurementSha256 = await canonicalSha256(research.measurement);
  const common = () => ({ status: 'measured' as const, reason: null, total: 0, reproduced: 0, ...zeroUsage(), manifestId: manifest.id,
    catalogRevision: catalog.document.revision, researchMeasurementSha256, limits: manifest.limits, probes: [] });
  const risk: RiskMeasurement = { id: 'risk-scripted', ...common(), maxRounds: manifest.rounds.risk, rounds: 0, turns: 0, retainedFindings: 0,
    adjusted: 0, hold: 0, rejected: 0, noConsensus: 0, cases: [] };
  const fund: FundManagerMeasurement = { id: 'fund-manager-scripted', ...common(), approved: 0, modified: 0, rejected: 0, intents: 0, violations: 0, adjustments: 0,
    financialWrites: 0, replayWrites: 0, cases: [] };
  const store = createMemoryTradingStore(); checked(await store.put('manifests', manifest));
  for (const session of analysts.sessions) checked(await store.put('sessions', session));
  for (const observation of analysts.observations) checked(await store.put('observations', observation));
  checked(await store.initializePortfolio(portfolio));
  const financial = async () => Promise.all((['decisions', 'orders', 'fills', 'ledger', 'portfolios'] as const).map(table => store.list(table)));
  const before = await financial();
  for (const [index, entry] of research.cases.entries()) {
    const { snapshot, reports, output: previous } = entry, asset = snapshot.snapshot.asset, sessionId = snapshot.snapshot.sessionId;
    if (await canonicalSha256(previous.verdict) !== research.measurement[0].cases[index].verdictSha256
      || await canonicalSha256(previous.proposal) !== research.measurement[1].cases[index].proposalSha256) throw Error('Risk input differs from its measured research predecessor');
    const content = { manifest, catalog, snapshot, portfolio, reports, proposal: previous.proposal, verdict: previous.verdict,
      valuationObservations: analysts.observations.filter(o => o.asset !== asset && toEpoch(o.availableAt) <= toEpoch(snapshot.snapshot.cutoffAt)) };
    const drive = await prepareTradingRiskDecisionDrive(content), run = await drive.run();
    if (run.status !== 'completed') throw Error(`Registered risk failed at ${asset}/${sessionId}: ${JSON.stringify(run.trace.run.failure)}`);
    const output = run.output as Output, riskCalls = run.visibility.filter(v => v.node !== 'fund-manager'), fundCalls = run.visibility.filter(v => v.node === 'fund-manager');
    if (output.verdict.spend.calls !== riskCalls.length || output.decision.spend.calls !== fundCalls.length
      || riskCalls.length + fundCalls.length !== run.usage.physical) throw Error('Risk role spend differs from observed physical calls');
    const r = { asset, sessionId, rounds: output.verdict.rounds!, turns: output.turns.length, retainedFindings: output.verdict.findings!.length,
      disposition: output.verdict.disposition as 'adjusted' | 'hold' | 'rejected' | 'no-consensus', physicalCalls: riskCalls.length,
      normalizations: riskCalls.filter(v => v.phase === 'normalization').length, repairs: riskCalls.filter(v => v.phase === 'repair').length,
      replays: run.usage.replays, restores: run.usage.restores, researchOutputsSha256: await canonicalSha256(previous), verdictSha256: await canonicalSha256(output.verdict),
      turnsByPersona: { risky: output.turns.filter(t => t.persona === 'risky').length, neutral: output.turns.filter(t => t.persona === 'neutral').length, conservative: output.turns.filter(t => t.persona === 'conservative').length }, reproduced: false };
    r.reproduced = r.rounds === manifest.rounds.risk && r.turns === 3 * r.rounds && r.retainedFindings === r.turns && r.disposition === 'no-consensus'
      && Object.values(r.turnsByPersona).every(count => count === r.rounds) && r.physicalCalls === 8 * r.rounds && r.normalizations === 4 * r.rounds && r.repairs === 0;
    checked(await store.put('snapshots', snapshot.snapshot));
    const artifacts = [...reports, ...previous.turns, previous.verdict, previous.proposal, ...output.turns, output.verdict, output.decision];
    for (const artifact of artifacts) checked(await store.stageArtifact(artifact.key, artifact));
    let replayWrites = 0; for (const artifact of artifacts) replayWrites += checked(await store.stageArtifact(artifact.key, artifact)).writes;
    if (!equalsJson(await financial(), before)) throw Error('Risk or fund-manager stage changed a financial record');
    const f = { asset, sessionId, decision: output.decision.decision!, intent: output.admission.intent !== null,
      violations: output.admission.violations.map(v => v.code + ':' + v.path), adjustments: output.admission.adjustments.map(v => v.code + ':' + v.path),
      physicalCalls: fundCalls.length, normalizations: fundCalls.filter(v => v.phase === 'normalization').length, repairs: fundCalls.filter(v => v.phase === 'repair').length,
      replays: 0, restores: 0, decisionSha256: await canonicalSha256(output.decision), admissionSha256: await canonicalSha256(output.admission), financialWrites: 0, replayWrites, reproduced: false };
    f.reproduced = f.decision === 'approved' && f.physicalCalls === 2 && f.normalizations === 1 && !f.repairs && !f.financialWrites && !f.replayWrites
      && !f.adjustments.length && output.admission.violations.every(v => v.code === 'TTRD1007') && (f.intent || f.violations.length > 0);
    risk.cases.push(r); fund.cases.push(f);
    for (const key of ['rounds', 'turns', 'retainedFindings', ...Object.keys(zeroUsage())] as Array<'rounds' | 'turns' | 'retainedFindings' | keyof ReturnType<typeof zeroUsage>>) risk[key] += r[key];
    if (r.disposition === 'adjusted') risk.adjusted++; else if (r.disposition === 'hold') risk.hold++; else if (r.disposition === 'rejected') risk.rejected++; else risk.noConsensus++;
    fund[f.decision]++; fund.intents += Number(f.intent); fund.violations += f.violations.length; fund.adjustments += f.adjustments.length;
    for (const key of ['financialWrites', 'replayWrites', ...Object.keys(zeroUsage())] as Array<'financialWrites' | 'replayWrites' | keyof ReturnType<typeof zeroUsage>>) fund[key] += f[key];
    if (index !== research.cases.length - 1) continue;
    const probe = (id: string, candidate: typeof run, passed: boolean): ResearchProbeMeasurement => ({ id, passed, physicalCalls: candidate.usage.physical,
      normalizations: candidate.usage.normalization, repairs: candidate.usage.repair, replays: candidate.usage.replays, restores: candidate.usage.restores,
      refusals: candidate.trace.attempts.filter(a => a.status === 'failed').length, refusalCode: candidate.trace.run.failure?.error.code ?? null });
    const dir = await mkdtemp(join(tmpdir(), 'trading-risk-receipt-'));
    try {
      const recovered = await drive.run({ databasePath: join(dir, 'risk.sqlite'), crashBefore: 'risk/risk-rounds/2/check-risk-conservative' });
      risk.probes.push(probe('crash-recovery', recovered, recovered.status === 'completed' && recovered.crashes === 1 && recovered.reopens === 1
        && recovered.usage.restores > 0 && recovered.usage.physical === run.usage.physical && equalsJson(recovered.output, output)
        && equalsJson(recovered.trace.run.budget.spent, run.trace.run.budget.spent)));
    } finally { await rm(dir, { recursive: true, force: true }); }
    const context = { manifest, snapshot: snapshot.snapshot, catalog }, state = checked(await initializeTradingRisk({ reports, proposal: previous.proposal, verdict: previous.verdict }, context));
    const missing = await collectTradingRiskTurns(state, [], context);
    risk.probes.push({ id: 'missing-persona', passed: !missing.valid && missing.issues[0].code === 'TTRD1008', ...zeroUsage(), refusals: Number(!missing.valid), refusalCode: missing.valid ? null : missing.issues[0].code });
    for (const id of ['unknown-claim', 'retained-findings']) {
      const script = drive.response(), candidate = await drive.run({ response: async (node, i, phase, messages) => {
        const out = await script(node, i, phase, messages);
        if (node === 'risk-facilitator') { const judgment = out as RiskVerdictOutput; if (id === 'unknown-claim') judgment.acceptedClaims.push({ id: 'invented', reason: 'Invalid synthetic acceptance' }); else judgment.findings.shift(); }
        return out;
      } });
      risk.probes.push(probe(id, candidate, candidate.status === 'failed' && JSON.stringify(candidate.trace.run.failure).includes('TTRD1004') && candidate.visibility.every(v => v.node !== 'fund-manager')));
    }
  }
  for (const definition of TRADING_POLICY_PROBES) {
    const { run, setupPhysicalCalls } = await runTradingPolicyProbe(analysts, definition), output = run.output as Output | null;
    const admission = output?.admission, passed = run.status === 'completed' && !!admission && (admission.intent !== null) === definition.admitted
      && (!definition.limit || admission.intent === null && admission.violations.some(v => v.code === 'TTRD1005' && v.path === definition.limit))
      && (!definition.adjusted || admission.adjustments.length > 0 && admission.intent!.quantity < (definition.modelQuantity ?? definition.quantity ?? 2));
    fund.probes.push({ id: definition.id, passed, physicalCalls: run.usage.physical, setupPhysicalCalls,
      normalizations: run.usage.normalization, repairs: run.usage.repair, replays: run.usage.replays, restores: run.usage.restores,
      refusals: admission?.violations.length ?? run.trace.attempts.filter(a => a.status === 'failed').length,
      refusalCode: admission?.violations[0]?.code ?? run.trace.run.failure?.error.code ?? null,
      policyViolations: admission?.violations.map(v => v.path) ?? [], adjustments: admission?.adjustments.map(v => v.path) ?? [], admitted: admission?.intent !== null && admission !== undefined });
  }
  for (const row of [risk, fund]) {
    row.total = row.cases.length; row.reproduced = row.cases.filter(c => c.reproduced).length;
    if (row.total !== research.cases.length || row.reproduced !== row.total || row.probes.some(p => !p.passed)) throw Error(`Registered ${row.id} acceptance failed: ${JSON.stringify({ failed: row.cases.filter(c => !c.reproduced), probes: row.probes })}`);
  }
  return [risk, fund];
}
let cached: { identity: string; result: Promise<[RiskMeasurement, FundManagerMeasurement]> } | undefined;
export async function measureTradingRisk(fixture: TradingFixture): Promise<[RiskMeasurement, FundManagerMeasurement]> {
  const identity = await canonicalSha256(fixture);
  if (cached?.identity !== identity) cached = { identity, result: executeRisk(cloneJson(fixture)) };
  return cloneJson(await cached.result);
}
