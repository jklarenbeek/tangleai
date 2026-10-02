/** Evidence-bound risk policy; the MAS loop owns scheduling and durable carry. */
import { equalsJson } from '@jarenjs/core/object';
import { validateGmplEvidence, mergeGmplFindings, type GmplCatalog, type GmplFinding } from '@tangleai/gmpl';
import { immutableTradingJson } from './identity.ts';
import { checkTradingArtifactScope, reportsToEvidence } from './evidence.ts';
import { createTradingRecord } from './records.ts';
import { validateTradingShape } from './schema.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingAnalystProvenance } from './analysts.ts';
import type { AnalystReport, ResearchVerdict, TradeProposal, RiskTurn, RiskVerdict, RiskTurnOutput, RiskVerdictOutput,
  TradingRiskState, TradingRiskJudgment, TradingProposedIntent, TradingRunManifest, MarketSnapshot, TradingSpend } from './contracts.gen.ts';

export const TRADING_RISK_PERSONAS = Object.freeze(['risky', 'neutral', 'conservative'] as const);
export interface TradingRiskWorkflowInput { reports: AnalystReport[]; verdict: ResearchVerdict; proposal: TradeProposal; }
export interface TradingRiskContext { manifest: TradingRunManifest; snapshot: MarketSnapshot; catalog: GmplCatalog; }
export interface TradingRiskProvenance extends TradingAnalystProvenance { attemptKey: string; attemptNumber: number; }
export function proposedTradingIntent(proposal: Pick<TradeProposal, 'action' | 'quantity' | 'targetWeight'>): TradingProposedIntent {
  if (proposal.action === 'hold') return { action: 'hold' };
  return proposal.quantity !== undefined ? { action: proposal.action, quantity: proposal.quantity } : { action: proposal.action, targetWeight: proposal.targetWeight! };
}
function checkedState(input: unknown, context: TradingRiskContext): TradingOutcome<TradingRiskState> {
  const state = validateTradingShape<TradingRiskState>('tradingRiskState', input); if (!state.valid) return state;
  const value = state.value, proposal = value.proposal, snapshot = context.snapshot;
  if (value.maxRounds !== context.manifest.rounds.risk || value.round > value.maxRounds || proposal.manifestId !== context.manifest.id
    || proposal.snapshotId !== snapshot.id || proposal.asset !== snapshot.asset || proposal.key.sessionId !== snapshot.sessionId
    || context.manifest.promptCatalogRevision !== context.catalog.document.revision)
    return tradingRefuse('TTRD1002', '/state', 'Risk carry differs from its bound decision and round limit');
  return state;
}
export async function initializeTradingRisk(input: TradingRiskWorkflowInput, context: TradingRiskContext): Promise<TradingOutcome<TradingRiskState>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '/input', 'Risk inputs must be finite JSON', cause); }
  const artifacts = [...input.reports, input.verdict, input.proposal];
  const scoped = await checkTradingArtifactScope(artifacts, context.snapshot); if (!scoped.valid) return scoped;
  const units = await reportsToEvidence(input.reports); if (!units.valid) return units;
  const result = validateGmplEvidence(input.verdict.result, units.value);
  if (!result.valid || result.value.disposition !== input.verdict.disposition || input.proposal.researchVerdictId !== input.verdict.id
    || input.proposal.assumedPortfolioId !== context.snapshot.portfolioId || artifacts.some(a => context.catalog.prompt(a.role)?.revision !== a.promptRevision)
    || input.proposal.citations.some(id => ![...input.reports, input.verdict].some(a => a.id === id)))
    return tradingRefuse('TTRD1004', '/input', 'Risk input must preserve the compiled report, research and proposal chain');
  return checkedState({ round: 1, maxRounds: context.manifest.rounds.risk, done: false, disposition: null, proposal: input.proposal,
    evidence: artifacts.map(a => ({ id: a.id, digest: a.revision, text: a.claims.map(c => c.text).join('\n') || ('summary' in a ? a.summary : a.rationale) })),
    turns: [], currentTurns: [], findings: [], history: [] }, context);
}
export async function checkRiskTurn(input: { state: TradingRiskState; persona: RiskTurn['persona']; output: unknown; context: TradingRiskContext;
  provenance: TradingRiskProvenance }): Promise<TradingOutcome<RiskTurn>> {
  const checked = checkedState(input.state, input.context); if (!checked.valid) return checked;
  const state = checked.value, output = validateTradingShape<RiskTurnOutput>('riskTurnOutput', input.output); if (!output.valid) return output;
  if (state.done || !TRADING_RISK_PERSONAS.includes(input.persona)) return tradingRefuse('TTRD1008', '/persona', 'Risk turn is outside the active round');
  if (new Set(output.value.claims.map(c => c.id)).size !== output.value.claims.length)
    return tradingRefuse('TTRD1004', '/claims', 'Risk claim identifiers must be unique within a turn');
  const origin = `risk-${state.round}-${input.persona}`;
  const findings: GmplFinding[] = output.value.claims.map(c => ({ id: `${origin}:${encodeURIComponent(c.id)}`, origin, reason: c.text,
    disposition: 'supported', critical: false, contradictory: false, citations: c.citations }));
  const evidence = validateGmplEvidence({ answer: output.value.position, disposition: 'completed', claims: output.value.claims.map(({ text, citations }) => ({ text, citations })), findings }, state.evidence);
  if (!evidence.valid) return tradingRefuse('TTRD1004', '/claims', 'Risk turn cites an artifact outside its delivered evidence', evidence.issues[0]);
  const prompt = input.context.catalog.prompt('trading-risk-position');
  if (!prompt) return tradingRefuse('TTRD1002', '/catalog', 'Risk position prompt is missing');
  const claims = output.value.claims.map(c => ({ text: c.text, citations: [...new Set(c.citations.map(v => v.id))] }));
  return createTradingRecord('risk-turn', { manifestId: state.proposal.manifestId, snapshotId: state.proposal.snapshotId, role: prompt.role.id,
    key: { ...state.proposal.key, stage: origin }, round: state.round, persona: input.persona, proposalId: state.proposal.id,
    position: output.value.position, claims, citations: [...new Set(claims.flatMap(c => c.citations))],
    previousTurnIds: state.turns.map(t => t.id), claimIds: findings.map(f => f.id), findings, recommendations: output.value.recommendations,
    model: input.provenance.model, spend: input.provenance.spend, promptRevision: prompt.revision,
    attemptKey: input.provenance.attemptKey, attemptNumber: input.provenance.attemptNumber });
}
export async function collectTradingRiskTurns(stateInput: TradingRiskState, turns: readonly RiskTurn[], context: TradingRiskContext): Promise<TradingOutcome<TradingRiskState>> {
  const checked = checkedState(stateInput, context); if (!checked.valid) return checked;
  const state = checked.value;
  if (state.done || turns.length !== TRADING_RISK_PERSONAS.length || TRADING_RISK_PERSONAS.some(p => turns.filter(t => t.persona === p).length !== 1))
    return tradingRefuse('TTRD1008', '/turns', 'Every declared risk persona must supply exactly one turn');
  const scoped = await checkTradingArtifactScope(turns, context.snapshot); if (!scoped.valid) return scoped;
  const ordered = TRADING_RISK_PERSONAS.map(p => turns.find(t => t.persona === p)!);
  if (ordered.some(t => t.round !== state.round || t.proposalId !== state.proposal.id || !t.findings || !t.claimIds
    || !equalsJson(t.claimIds, t.findings.map(f => f.id)) || !equalsJson(t.previousTurnIds, state.turns.map(t => t.id))))
    return tradingRefuse('TTRD1004', '/turns', 'Risk turns must preserve their round, delivered findings and prior visibility');
  for (const turn of ordered) {
    const result = validateGmplEvidence({ answer: turn.position, disposition: 'completed', claims: [], findings: turn.findings! }, state.evidence);
    if (!result.valid) return tradingRefuse('TTRD1004', '/turns/findings', 'Risk turn findings differ from delivered evidence', result.issues[0]);
  }
  const merged = mergeGmplFindings([state.findings, ...ordered.map(t => t.findings!)]);
  if (!merged.valid) return tradingRefuse('TTRD1004', '/findings', 'Concurrent risk findings conflict', merged.issues[0]);
  return checkedState({ ...state, currentTurns: ordered, findings: merged.value }, context);
}
export function gateTradingRiskRound(input: { state: TradingRiskState; output: unknown; context: TradingRiskContext; provenance: TradingRiskProvenance }): TradingOutcome<TradingRiskState> {
  const checked = checkedState(input.state, input.context); if (!checked.valid) return checked;
  const state = checked.value, output = validateTradingShape<RiskVerdictOutput>('riskVerdictOutput', input.output); if (!output.valid) return output;
  if (state.done || state.currentTurns.length !== 3) return tradingRefuse('TTRD1008', '/turns', 'Facilitator requires all current persona turns');
  const value = output.value, claims = [...value.acceptedClaims, ...value.rejectedClaims], delivered = [...state.turns, ...state.currentTurns].flatMap(t => t.claimIds ?? []);
  if (new Set(claims.map(c => c.id)).size !== claims.length || claims.some(c => !delivered.includes(c.id)))
    return tradingRefuse('TTRD1004', '/claims', 'Facilitator may disposition each delivered claim at most once');
  const findings = validateGmplEvidence({ answer: value.summary, disposition: 'completed', claims: [], findings: value.findings }, state.evidence, state.findings);
  if (!findings.valid) return tradingRefuse('TTRD1004', '/findings', 'Facilitator lost or substituted delivered evidence', findings.issues[0]);
  for (const [group, disposition] of [[value.acceptedClaims, 'supported'], [value.rejectedClaims, 'rejected-with-reason']] as const)
    if (group.some(c => !value.findings.some(f => f.id === c.id && f.disposition === disposition && (disposition !== 'rejected-with-reason' || f.reason === c.reason))))
      return tradingRefuse('TTRD1004', '/claims', 'Claim dispositions and retained finding reasons must agree');
  const contradiction = value.findings.some(f => f.contradictory && ['supported', 'contested', 'unresolved'].includes(f.disposition));
  const adjusted = value.action === 'adjust' && !contradiction, hold = value.action === 'hold', rejected = value.action === 'reject';
  const done = adjusted || hold || rejected || state.round >= state.maxRounds;
  const disposition = done ? adjusted ? 'adjusted' : hold ? 'hold' : rejected ? 'rejected' : 'no-consensus' : null;
  const judgment: TradingRiskJudgment = { round: state.round, output: value, ...immutableTradingJson(input.provenance) };
  return checkedState({ ...state, round: done ? state.round : state.round + 1, done, disposition, findings: value.findings,
    turns: [...state.turns, ...state.currentTurns], currentTurns: [], history: [...state.history, judgment] }, input.context);
}
export async function finalizeTradingRisk(stateInput: TradingRiskState, context: TradingRiskContext): Promise<TradingOutcome<{ verdict: RiskVerdict; turns: RiskTurn[] }>> {
  const checked = checkedState(stateInput, context); if (!checked.valid) return checked;
  const state = checked.value, last = state.history.at(-1), prompt = context.catalog.prompt('trading-risk-facilitator');
  if (!state.done || !state.disposition || !last || !prompt || state.turns.length !== 3 * state.round || state.history.length !== state.round)
    return tradingRefuse('TTRD1008', '/state', 'A risk verdict requires a terminal bounded round history');
  const unadjusted = state.disposition === 'no-consensus', adjustedIntent = unadjusted ? proposedTradingIntent(state.proposal) : last.output.adjustedIntent;
  const spend = Object.fromEntries(Object.keys(last.spend).map(key => [key, [...state.turns, ...state.history].reduce((n, item) => n + item.spend[key as keyof TradingSpend], 0)])) as unknown as TradingSpend;
  const claims = state.findings.map(f => ({ text: f.reason, citations: [...new Set(f.citations.map(c => c.id))] }));
  const verdict = await createTradingRecord('risk-verdict', { manifestId: state.proposal.manifestId, snapshotId: state.proposal.snapshotId,
    role: prompt.role.id, key: { ...state.proposal.key, stage: 'risk-verdict' }, proposalId: state.proposal.id,
    disposition: state.disposition, summary: last.output.summary, historyIds: state.turns.map(t => t.id), rounds: state.round,
    maxQuantity: adjustedIntent.quantity ?? 0, adjustedIntent, unadjusted, findings: state.findings, judgments: state.history,
    acceptedClaims: last.output.acceptedClaims, rejectedClaims: last.output.rejectedClaims, recommendations: last.output.recommendations,
    model: last.model, spend, promptRevision: prompt.revision, claims, citations: [...new Set(claims.flatMap(c => c.citations))] });
  return verdict.valid ? { valid: true, value: { verdict: verdict.value, turns: state.turns } } : verdict;
}
