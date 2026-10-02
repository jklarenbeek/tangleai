/** Research and trader receipts reuse the measured analyst artifacts, with no hidden setup calls. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGmplCatalog } from '@tangleai/gmpl';
import { tradingArtifacts, createMemoryTradingStore, checkTradeProposal, prepareTradingAnalystContext, tradingWorkflowIssue } from '@tangleai/trading';
import type { ResearchVerdict, DebateTurn, TradeProposal, TradeProposalOutput } from '@tangleai/trading';
import type { TradingFixture } from './trading.ts';
import type { ResearchMeasurement, TraderMeasurement, ResearchProbeMeasurement } from './trading.types.ts';
import { tradingAnalystExecution, type TradingAnalystExecution } from './trading-analysts.ts';
import { prepareTradingResearchDrive, checked } from './trading-research-runner.ts';
import { scriptedModel, scriptedSpend } from './trading-analyst-runner.ts';

type Output = { verdict: ResearchVerdict; turns: DebateTurn[]; proposal: TradeProposal };
export interface TradingResearchExecution {
  measurement: [ResearchMeasurement, TraderMeasurement]; analysts: TradingAnalystExecution;
  cases: Array<TradingAnalystExecution['cases'][number] & { output: Output }>;
}
const zeroUsage = () => ({ physicalCalls: 0, normalizations: 0, repairs: 0, replays: 0, restores: 0 });
async function executeResearch(fixture: TradingFixture): Promise<TradingResearchExecution> {
  const analysts = await tradingAnalystExecution(fixture), catalog = checked(await createGmplCatalog(tradingArtifacts));
  const { manifest, portfolio } = analysts, analystMeasurementSha256 = await canonicalSha256(analysts.measurement);
  const common = () => ({ status: 'measured' as const, reason: null, total: 0, reproduced: 0, ...zeroUsage(), manifestId: manifest.id,
    catalogRevision: catalog.document.revision, analystMeasurementSha256, limits: manifest.limits, probes: [] });
  const research: ResearchMeasurement = { id: 'research-scripted', ...common(), maxRounds: manifest.rounds.research,
    rounds: 0, turns: 0, retainedFindings: 0, completed: 0, rejected: 0, noConsensus: 0, cases: [] };
  const trader: TraderMeasurement = { id: 'trader-scripted', ...common(), proposals: 0, exceedsPosition: 0, financialWrites: 0, replayWrites: 0, cases: [] };
  const store = createMemoryTradingStore(); checked(await store.put('manifests', manifest));
  for (const session of analysts.sessions) checked(await store.put('sessions', session));
  for (const observation of analysts.observations) checked(await store.put('observations', observation));
  checked(await store.initializePortfolio(portfolio));
  const financial = async () => Promise.all((['decisions', 'orders', 'fills', 'ledger', 'portfolios'] as const).map(table => store.list(table)));
  const before = await financial();
  const cases: TradingResearchExecution['cases'] = [];
  for (const [index, entry] of analysts.cases.entries()) {
    const { snapshot, reports } = entry, asset = snapshot.snapshot.asset, sessionId = snapshot.snapshot.sessionId;
    const analystOutputsSha256 = await canonicalSha256(Object.fromEntries(reports.map(r => [r.role.replace('trading-analyst-', ''), r])));
    if (analystOutputsSha256 !== analysts.measurement.cases[index].outputSha256) throw Error('Research inputs differ from measured analyst outputs');
    const drive = await prepareTradingResearchDrive({ manifest, catalog, snapshot, portfolio, reports }), run = await drive.run();
    if (run.status !== 'completed') throw Error(`Registered research failed at ${asset}/${sessionId}: ${JSON.stringify(run.trace.run.failure)}`);
    const output = run.output as Output, evidenceIds = new Set(reports.map(r => r.id));
    cases.push({ snapshot, reports, output });
    if (output.verdict.citations.some(id => !evidenceIds.has(id)) || output.turns.some(t => t.citations.some(id => !evidenceIds.has(id))))
      throw Error('Research escaped its measured analyst artifact projection');
    const researchCalls = run.visibility.filter(v => v.node !== 'trader'), traderCalls = run.visibility.filter(v => v.node === 'trader');
    if (output.verdict.spend.calls !== researchCalls.length || output.proposal.spend.calls !== traderCalls.length
      || output.verdict.spend.calls + output.proposal.spend.calls !== run.usage.physical) throw Error('Research role spend differs from physical requests');
    const r = { asset, sessionId, rounds: output.verdict.rounds!, turns: output.turns.length, retainedFindings: output.verdict.result!.findings.length,
      disposition: output.verdict.disposition as 'completed' | 'no-consensus' | 'rejected', physicalCalls: researchCalls.length,
      normalizations: researchCalls.filter(v => v.phase === 'normalization').length, repairs: researchCalls.filter(v => v.phase === 'repair').length,
      replays: run.usage.replays, restores: run.usage.restores, analystOutputsSha256, verdictSha256: await canonicalSha256(output.verdict), reproduced: false };
    r.reproduced = r.rounds === manifest.rounds.research && r.turns === 4 * r.rounds && r.disposition === 'no-consensus' && r.retainedFindings === 2
      && r.physicalCalls === 2 * (5 * r.rounds + 1) && r.normalizations === 5 * r.rounds + 1 && r.repairs === 0;
    checked(await store.put('snapshots', snapshot.snapshot));
    const artifacts = [...reports, ...output.turns, output.verdict, output.proposal];
    for (const artifact of artifacts) checked(await store.stageArtifact(artifact.key, artifact));
    let replayWrites = 0;
    for (const artifact of artifacts) replayWrites += checked(await store.stageArtifact(artifact.key, artifact)).writes;
    if (!equalsJson(await financial(), before)) throw Error('Research or trader changed a financial record');
    const financialWrites = 0;
    const t = { asset, sessionId, valid: output.proposal.kind === 'trade-proposal', exceedsPosition: output.proposal.exceedsPosition,
      physicalCalls: traderCalls.length, normalizations: traderCalls.filter(v => v.phase === 'normalization').length, repairs: traderCalls.filter(v => v.phase === 'repair').length,
      replays: 0, restores: 0, proposalSha256: await canonicalSha256(output.proposal), financialWrites, replayWrites, reproduced: false };
    t.reproduced = t.valid && t.physicalCalls === 2 && t.normalizations === 1 && t.repairs === 0 && financialWrites === 0 && replayWrites === 0;
    research.cases.push(r); trader.cases.push(t);
    for (const key of ['rounds', 'turns', 'retainedFindings', ...Object.keys(zeroUsage())] as Array<'rounds' | 'turns' | 'retainedFindings' | keyof ReturnType<typeof zeroUsage>>) research[key] += r[key];
    if (r.disposition === 'completed') research.completed++; else if (r.disposition === 'rejected') research.rejected++; else research.noConsensus++;
    trader.proposals += Number(t.valid); trader.exceedsPosition += Number(t.exceedsPosition);
    for (const key of ['financialWrites', 'replayWrites', ...Object.keys(zeroUsage())] as Array<'financialWrites' | 'replayWrites' | keyof ReturnType<typeof zeroUsage>>) trader[key] += t[key];
    if (index !== analysts.cases.length - 1) continue;
    const probe = (id: string, candidate: typeof run, passed: boolean, refusalCode: string | null): ResearchProbeMeasurement => ({ id, passed,
      physicalCalls: candidate.usage.physical, normalizations: candidate.usage.normalization, repairs: candidate.usage.repair,
      replays: candidate.usage.replays, restores: candidate.usage.restores, refusals: candidate.trace.attempts.filter(a => a.status === 'failed').length, refusalCode });
    const dir = await mkdtemp(join(tmpdir(), 'trading-research-receipt-'));
    try {
      const recovered = await drive.run({ databasePath: join(dir, 'recovery.sqlite'), crashBefore: 'research/rounds/2/check-rebuttal-2' });
      research.probes.push(probe('crash-recovery', recovered, recovered.status === 'completed' && recovered.crashes === 1 && recovered.reopens === 1
        && recovered.usage.restores > 0 && recovered.usage.physical === run.usage.physical && equalsJson(recovered.output, output)
        && equalsJson(recovered.trace.run.budget.spent, run.trace.run.budget.spent), null));
    } finally { await rm(dir, { recursive: true, force: true }); }
    const contradicted = await drive.run({ response: drive.response({ action: 'accept', contradiction: true }) });
    const contradictedVerdict = (contradicted.output as Output | null)?.verdict;
    research.probes.push(probe('overruled-accept', contradicted, contradicted.status === 'completed' && contradictedVerdict?.disposition === 'no-consensus'
      && contradictedVerdict.judgments!.every(j => j.action === 'continue' && j.judgment.action === 'accept'), null));
    const budget = await drive.run({ runLimits: { calls: 3 } });
    research.probes.push(probe('shared-budget', budget, budget.status === 'failed' && budget.usage.physical === 3 && budget.visibility.every(v => v.node !== 'trader')
      && tradingWorkflowIssue(budget.trace.run)?.code === 'TTRD1009', tradingWorkflowIssue(budget.trace.run)?.code ?? null));
    const script = drive.response();
    const dropped = await drive.run({ response: async (node, i, phase, messages) => {
      const reply = await script(node, i, phase, messages) as { result?: { findings: unknown[] } }; if (node === 'synthesis') reply.result!.findings = []; return reply;
    } });
    research.probes.push(probe('retained-findings', dropped, dropped.status === 'failed' && JSON.stringify(dropped.trace.run.failure).includes('TGMPL1005')
      && dropped.visibility.every(v => v.node !== 'trader'), dropped.trace.run.failure?.error.code ?? null));
    const invalid = await drive.run({ response: (node, i, phase, messages) => node === 'trader' ? {} : script(node, i, phase, messages) });
    trader.probes.push(probe('one-repair', invalid, invalid.status === 'failed' && invalid.visibility.filter(v => v.node === 'trader').length === 3 && invalid.usage.repair === 1,
      invalid.trace.run.failure?.error.code ?? null));
    const context = checked(await prepareTradingAnalystContext({ manifest, snapshot, portfolio }));
    const validOutput: TradeProposalOutput = { action: 'buy', quantity: 2, timing: 'next-open', horizon: 'Next session', rationale: 'Synthetic proposal check',
      citations: [{ id: output.verdict.id, digest: output.verdict.revision }], assumedPortfolioId: portfolio.id };
    for (const [id, candidate, expected] of [
      ['observation-citation', { ...validOutput, citations: [{ id: snapshot.snapshot.observationIds[0], digest: '0'.repeat(64) }] }, 'TTRD1004'],
      ['same-close', { ...validOutput, timing: 'same-close' }, 'TTRD1001'],
      ['oversell-flag', { ...validOutput, action: 'sell', quantity: 1 }, null],
    ] as const) {
      const checkedProposal = await checkTradeProposal({ output: candidate, snapshot: snapshot.snapshot, portfolio: context.portfolio, reports, verdict: output.verdict,
        artifact: catalog.prompt('trading-trader')!, provenance: { model: scriptedModel, spend: scriptedSpend() } });
      const code = checkedProposal.valid ? null : checkedProposal.issues[0].code;
      trader.probes.push({ id, passed: expected === null ? checkedProposal.valid && checkedProposal.value.exceedsPosition : code === expected,
        ...zeroUsage(), refusals: Number(!checkedProposal.valid), refusalCode: code });
    }
  }
  for (const row of [research, trader]) {
    row.total = row.cases.length; row.reproduced = row.cases.filter(c => c.reproduced).length;
    if (row.total !== analysts.measurement.total || row.reproduced !== row.total || row.probes.length !== 4 || row.probes.some(p => !p.passed))
      throw Error(`Registered ${row.id} acceptance failed: ${JSON.stringify({ failed: row.cases.filter(c => !c.reproduced), probes: row.probes })}`);
  }
  return { measurement: [research, trader], analysts, cases };
}
let cached: { identity: string; result: Promise<TradingResearchExecution> } | undefined;
async function cachedResearchExecution(fixture: TradingFixture): Promise<TradingResearchExecution> {
  const identity = await canonicalSha256(fixture);
  if (cached?.identity !== identity) cached = { identity, result: executeResearch(cloneJson(fixture)) };
  return cached.result;
}
export async function tradingResearchExecution(fixture: TradingFixture): Promise<TradingResearchExecution> { return cloneJson(await cachedResearchExecution(fixture)); }
export async function measureTradingResearch(fixture: TradingFixture): Promise<[ResearchMeasurement, TraderMeasurement]> { return cloneJson((await cachedResearchExecution(fixture)).measurement); }
