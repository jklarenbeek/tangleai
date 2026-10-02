/** Role projections and canonical MAS lanes over one immutable decision snapshot. */
import { equalsJson } from '@jarenjs/core/object';
import { toEpoch } from '@jarenjs/core/series';
import { agentInvocation, taskInvocation, masMessage, masRevisionOf, type Invocation, type MessageEdge, type MasWorkflow, type WorkflowLimits } from '@tangleai/mas';
import { validateGmplPromptArtifact, type GmplCatalog, type GmplPromptArtifact } from '@tangleai/gmpl';
import { immutableTradingJson } from './identity.ts';
import { validateTradingRecord, createTradingRecord } from './records.ts';
import { validateTradingShape, tradingSchemaOf } from './schema.ts';
import { admit, cutoffFor, sessionIndex, snapshotBarStaleness } from './time.ts';
import { macdCross, kdjRsi, zeroMeanReversion, smaCross, tradingSignalWindow, TRADING_SIGNAL_DEFAULTS } from './baselines.ts';
import { adx, cci, vwap, volumeRatio, kdj } from './indicators.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingOutcome } from './errors.ts';
import type { TradingSnapshotBundle } from './snapshot.ts';
import type { TradingRunManifest, PortfolioSnapshot, TradingVisiblePortfolio, TradingAnalystRole, TradingAnalystProjection,
  AnalystReportOutput, AnalystReport, BarObservation, Observation, MarketSnapshot, TradingAnalystView, TradingTechnicalIndicators } from './contracts.gen.ts';

export const TRADING_ANALYST_ROLES: readonly TradingAnalystRole[] = Object.freeze(['fundamentals', 'sentiment', 'news', 'technical']);
const kinds: Record<TradingAnalystRole, readonly Observation['kind'][]> = {
  fundamentals: ['fundamental', 'profile'], sentiment: ['social', 'insider'], news: ['news'], technical: ['bar', 'corporate-action'],
};
export const TRADING_ANALYST_TOOLS: Readonly<Record<TradingAnalystRole, readonly string[]>> = immutableTradingJson({
  fundamentals: ['fundamentals-facts'], sentiment: ['social-items', 'insider-events'], news: ['news-items'], technical: ['bars-window'],
});
export interface TradingAnalystContext {
  snapshot: MarketSnapshot;
  portfolio: TradingVisiblePortfolio;
  projections: Record<TradingAnalystRole, TradingAnalystProjection>;
  observations: Observation[];
  from: string;
}
export interface TradingAnalystProvenance { model: AnalystReport['model']; spend: AnalystReport['spend']; }

/** Bind identity once per visible item; omit redundant storage metadata from role context. */
export function tradingAnalystView(projection: TradingAnalystProjection): TradingAnalystView {
  return immutableTradingJson({ ...projection, evidence: projection.evidence.map(({ id, digest, observation }) => {
    const { id: _id, revision: _revision, manifestId: _manifestId, asset: _asset, sourceId: _sourceId, sourceKey: _sourceKey, revisionId: _revisionId, contentHash: _contentHash, ...data } = observation;
    return { id, digest, data };
  }) });
}

export async function prepareTradingAnalystContext(input: { manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; portfolio: PortfolioSnapshot }): Promise<TradingOutcome<TradingAnalystContext>> {
  let frozen: typeof input;
  try { frozen = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Analyst inputs must be finite JSON', cause); }
  const { manifest, portfolio, snapshot: bundle } = frozen, { snapshot, observations } = bundle;
  for (const record of [manifest, portfolio, snapshot]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  const indexed = await sessionIndex(bundle.sessions); if (!indexed.valid) return indexed;
  const sessions = indexed.value.sessions, session = sessions.find(s => s.key === snapshot.sessionId);
  if (!session || sessions[0]?.key !== manifest.sessionRange.first || sessions.at(-1)?.key !== manifest.sessionRange.last || sessions.some(s => s.manifestId !== manifest.id))
    return tradingRefuse('TTRD1003', '/sessions', 'Analyst context requires the complete declared calendar');
  const cutoff = cutoffFor(session, manifest); if (!cutoff.valid) return cutoff;
  if (snapshot.manifestId !== manifest.id || portfolio.manifestId !== manifest.id || snapshot.portfolioId !== portfolio.id || !manifest.assets.includes(snapshot.asset) || snapshot.cutoffAt !== cutoff.value)
    return tradingRefuse('TTRD1002', '/snapshot', 'Snapshot, portfolio and manifest scope differ');
  if (portfolio.asOfSessionId !== null && (sessions.findIndex(s => s.key === portfolio.asOfSessionId) < 0 || sessions.findIndex(s => s.key === portfolio.asOfSessionId) > sessions.indexOf(session)))
    return tradingRefuse('TTRD1003', '/portfolio', 'A role cannot read a future portfolio');
  const admitted = await admit(observations, snapshot.cutoffAt); if (!admitted.valid) return admitted;
  if (admitted.value.refused.length || observations.some(o => o.asset !== snapshot.asset || o.manifestId !== manifest.id) ||
      new Set(observations.map(o => o.id)).size !== observations.length || !equalsJson(snapshot.observationIds, observations.map(o => o.id)))
    return tradingRefuse('TTRD1003', '/observations', 'Analyst evidence differs from the admitted immutable snapshot');
  const staleness = snapshotBarStaleness(sessions, session.key, observations); if (!staleness.valid) return staleness;
  if (staleness.value !== snapshot.staleness) return tradingRefuse('TTRD1003', '/staleness', 'Snapshot staleness differs from its bars');
  const visiblePortfolio: TradingVisiblePortfolio = { id: portfolio.id, manifestId: portfolio.manifestId, cash: portfolio.cash,
    positions: portfolio.positions, asOfSessionId: portfolio.asOfSessionId };
  const bySession = new Map<string, BarObservation>();
  for (const bar of observations) if (bar.kind === 'bar') {
    const prior = bySession.get(bar.sessionId);
    if (!prior || toEpoch(bar.availableAt) > toEpoch(prior.availableAt) || toEpoch(bar.availableAt) === toEpoch(prior.availableAt) && bar.id > prior.id) bySession.set(bar.sessionId, bar);
  }
  const bars = [...bySession.values()].sort((a, b) => toEpoch(a.eventAt) - toEpoch(b.eventAt));
  const signals: TradingAnalystProjection['signals'] = [];
  for (const [policy, evaluate] of Object.entries({ macd: macdCross, 'kdj-rsi': kdjRsi, 'mean-reversion': zeroMeanReversion, sma: smaCross })) {
    const result = evaluate(bars, manifest.signalParameters ?? TRADING_SIGNAL_DEFAULTS); if (!result.valid) return result;
    signals.push({ policy, value: result.value.at(-1) ?? null });
  }
  const window = tradingSignalWindow(bars); if (!window.valid) return window;
  const { high, low, close, availableAt } = window.value, volume = bars.map(b => b.volume);
  const parameters = { adxPeriod: 14, cciPeriod: 20, volumePeriod: 20, kPeriod: 9, dPeriod: 3 };
  const vectors = { ...adx(high, low, close, parameters.adxPeriod), cci: cci(high, low, close, parameters.cciPeriod),
    vwap: vwap(high, low, close, volume), volumeRatio: volumeRatio(volume, parameters.volumePeriod), ...kdj(high, low, close, parameters.kPeriod, parameters.dPeriod) };
  const indicators: TradingTechnicalIndicators = { priceBasis: 'causal-adjusted-ohlc', parameters, observations: bars.length,
    windowStartId: bars[0]?.id ?? null, windowEndId: bars.at(-1)?.id ?? null, availableAt: availableAt.at(-1) ?? null,
    values: { adx: vectors.adx.at(-1) ?? null, plusDI: vectors.plusDI.at(-1) ?? null, minusDI: vectors.minusDI.at(-1) ?? null,
      cci: vectors.cci.at(-1) ?? null, vwap: vectors.vwap.at(-1) ?? null, volumeRatio: vectors.volumeRatio.at(-1) ?? null,
      k: vectors.k.at(-1) ?? null, d: vectors.d.at(-1) ?? null, j: vectors.j.at(-1) ?? null } };
  const projections = {} as TradingAnalystContext['projections'];
  for (const role of TRADING_ANALYST_ROLES) projections[role] = { snapshotId: snapshot.id, asset: snapshot.asset, cutoffAt: snapshot.cutoffAt, role,
    evidence: observations.filter(o => kinds[role].includes(o.kind)).map(observation => ({ id: observation.id, digest: observation.revision, observation })),
    signals: role === 'technical' ? signals : [], indicators: role === 'technical' ? indicators : null, staleness: snapshot.staleness, providerErrors: snapshot.providerErrors };
  return { valid: true, value: immutableTradingJson({ snapshot, portfolio: visiblePortfolio, projections, observations, from: sessions[0].openAt }) };
}

export async function checkAnalystReport(input: { output: unknown; projection: TradingAnalystProjection; snapshot: MarketSnapshot; artifact: GmplPromptArtifact; provenance: TradingAnalystProvenance }): Promise<TradingOutcome<AnalystReport>> {
  const shaped = validateTradingShape<AnalystReportOutput>('analystReportOutput', input.output); if (!shaped.valid) return shaped;
  const projected = validateTradingShape<TradingAnalystProjection>('tradingAnalystProjection', input.projection); if (!projected.valid) return projected;
  const snapshotShape = await validateTradingRecord(input.snapshot); if (!snapshotShape.valid) return snapshotShape;
  const artifactShape = await validateGmplPromptArtifact(input.artifact);
  if (!artifactShape.valid) return tradingRefuse('TTRD1002', '/artifact', 'Prompt artifact identity is invalid', artifactShape.issues[0]);
  const projection = projected.value, snapshot = snapshotShape.value as MarketSnapshot, artifact = artifactShape.value, output = shaped.value;
  if (projection.snapshotId !== snapshot.id || projection.asset !== snapshot.asset || projection.cutoffAt !== snapshot.cutoffAt || artifact.id !== `trading-analyst-${projection.role}`)
    return tradingRefuse('TTRD1002', '/projection', 'Report projection and role artifact differ');
  const seen = new Set<string>();
  for (const [i, evidence] of projection.evidence.entries()) {
    const observation = evidence.observation, checked = await validateTradingRecord(observation); if (!checked.valid) return checked;
    if (seen.has(evidence.id) || evidence.id !== observation.id || evidence.digest !== observation.revision || !snapshot.observationIds.includes(evidence.id)
      || !kinds[projection.role].includes(observation.kind) || observation.asset !== snapshot.asset || observation.manifestId !== snapshot.manifestId
      || toEpoch(observation.eventAt) > toEpoch(snapshot.cutoffAt) || toEpoch(observation.availableAt) > toEpoch(snapshot.cutoffAt))
      return tradingRefuse('TTRD1004', `/projection/evidence/${i}`, 'Projection contains hidden, altered or unavailable evidence');
    seen.add(evidence.id);
  }
  for (const [i, finding] of output.findings.entries()) for (const [j, citation] of finding.citations.entries())
    if (!projection.evidence.some(e => e.id === citation.id && e.digest === citation.digest))
      return tradingRefuse('TTRD1004', `/findings/${i}/citations/${j}`, 'Citation is absent from this role projection or its digest changed');
  if (!output.findings.length && (output.signal !== 'neutral' || output.confidence !== 0 || !output.limitations.length))
    return tradingRefuse('TTRD1004', '/findings', 'An evidence-free report must explicitly abstain with a limitation');
  const claims = output.findings.map(f => ({ text: f.text, citations: [...new Set(f.citations.map(c => c.id))] }));
  return createTradingRecord('analyst-report', { manifestId: snapshot.manifestId, role: artifact.role.id, snapshotId: snapshot.id,
    citations: [...new Set(claims.flatMap(c => c.citations))], model: input.provenance.model, spend: input.provenance.spend,
    promptRevision: artifact.revision, claims, summary: output.findings.map(f => f.text).join('\n') || 'Abstained: ' + output.limitations.join('; '),
    signals: [{ name: output.signal, value: output.confidence, reason: output.horizon }], gaps: output.limitations, analysis: output,
    key: { manifestId: snapshot.manifestId, asset: snapshot.asset, sessionId: snapshot.sessionId, stage: artifact.role.id } });
}

export interface TradingAnalystRegion { nodes: Invocation[]; messages: MessageEdge[]; entry: MasWorkflow['entry']; exit: MasWorkflow['exit']; input: Record<string, unknown>; output: Record<string, unknown>; }
export async function buildAnalystRegion(input: { catalog: GmplCatalog; profile: string; limits: WorkflowLimits }): Promise<TradingOutcome<TradingAnalystRegion>> {
  if (input.limits.concurrency < TRADING_ANALYST_ROLES.length || input.limits.fanOut < TRADING_ANALYST_ROLES.length)
    return tradingRefuse('TTRD1009', '/limits', 'The analyst region needs capacity for every concurrent lane');
  const nodes: Invocation[] = [], messages: MessageEdge[] = [], entry: MasWorkflow['entry'] = [], exit: MasWorkflow['exit'] = [];
  const report = tradingSchemaOf('analystReport'), snapshot = tradingSchemaOf('marketSnapshot');
  const reportSchemas = Object.fromEntries(TRADING_ANALYST_ROLES.map(role => [role, { ...report, $id: `https://tangleai.dev/schemas/trading/analyst-lane/${role}` }]));
  for (const role of TRADING_ANALYST_ROLES) {
    const a = input.catalog.prompt(`trading-analyst-${role}`);
    if (!a) return tradingRefuse('TTRD1002', '/catalog', 'Analyst prompt artifact is missing');
    const prepare = `prepare-analyst-${role}`, agent = `analyst-${role}`, check = `check-analyst-${role}`;
    nodes.push(taskInvocation({ id: prepare, handler: prepare, input: { snapshot }, output: { variables: a.variableSchema } }),
      agentInvocation({ id: agent, role: a.role.id, profile: input.profile, instructionsRevision: await masRevisionOf(a.role.instructions),
        messageAdapter: `trading-${a.id}`, input: { variables: a.variableSchema }, output: { out: a.outputSchema }, tools: [...TRADING_ANALYST_TOOLS[role]] }),
      taskInvocation({ id: check, handler: check, input: { variables: a.variableSchema, out: a.outputSchema }, output: { report: reportSchemas[role] } }));
    messages.push(masMessage([prepare, 'variables'], [agent, 'variables']), masMessage([prepare, 'variables'], [check, 'variables']), masMessage([agent, 'out'], [check, 'out']));
    entry.push({ port: 'snapshot', to: { node: prepare, port: 'snapshot' } }); exit.push({ port: role, from: { node: check, port: 'report' } });
  }
  const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  return { valid: true, value: immutableTradingJson({ nodes, messages, entry, exit, input: object({ snapshot }),
    output: object(reportSchemas) }) };
}
