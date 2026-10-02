/** Read-only research/trader composition. This region has no financial write binding. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { graphInvocation, taskInvocation, agentInvocation, masMessage, masRevisionOf, masWorkflowVersionIdOf,
  type MasRegistry, type MasTaskHandlerBinding, type MasMessageAdapter, type TraceView } from '@tangleai/mas';
import { gmplSchemaOf, renderGmplPrompt, validateGmplPromptArtifact, validateGmplEvidence, type GmplCatalog, type GmplPromptArtifact } from '@tangleai/gmpl';
import { prepareTradingAnalystContext, type TradingAnalystProvenance, type TradingAnalystRegion } from './analysts.ts';
import { checkTradingArtifactScope, researchInput, reportsToEvidence } from './evidence.ts';
import { materializeResearch, researchVerdict, checkedTradingAttempt, checkMaterializedResearch, type TradingAttemptProvenance } from './research.ts';
import { tradingTaskValue } from './host-bindings.ts';
import { immutableTradingJson } from './identity.ts';
import { createTradingRecord } from './records.ts';
import { tradingSchemaOf, validateTradingShape } from './schema.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingSnapshotBundle } from './snapshot.ts';
import type { AnalystReport, ResearchVerdict, TradeProposal, TradeProposalOutput, MarketSnapshot, TradingVisiblePortfolio, TradingRunManifest, PortfolioSnapshot } from './contracts.gen.ts';

export type MaterializedTradingResearch = Extract<Awaited<ReturnType<typeof materializeResearch>>, { valid: true }>['value'];
export async function checkTradeProposal(input: { output: unknown; snapshot: MarketSnapshot; portfolio: TradingVisiblePortfolio; reports: readonly AnalystReport[];
  verdict: ResearchVerdict; artifact: GmplPromptArtifact; provenance: TradingAnalystProvenance }): Promise<TradingOutcome<TradeProposal>> {
  try { input = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Trader checking requires finite JSON', cause); }
  const output = validateTradingShape<TradeProposalOutput>('tradeProposalOutput', input.output); if (!output.valid) return output;
  const portfolio = validateTradingShape<TradingVisiblePortfolio>('tradingVisiblePortfolio', input.portfolio); if (!portfolio.valid) return portfolio;
  const artifact = await validateGmplPromptArtifact(input.artifact);
  if (!artifact.valid || artifact.value.id !== 'trading-trader') return tradingRefuse('TTRD1002', '/artifact', 'Trader requires its declared prompt artifact');
  const visible = await checkTradingArtifactScope([...input.reports, input.verdict], input.snapshot); if (!visible.valid) return visible;
  const projected = await researchInputForProposal(input); if (!projected.valid) return projected;
  if (portfolio.value.id !== input.snapshot.portfolioId || portfolio.value.manifestId !== input.snapshot.manifestId || output.value.assumedPortfolioId !== portfolio.value.id)
    return tradingRefuse('TTRD1002', '/assumedPortfolioId', 'Proposal assumes a different portfolio');
  for (const citation of output.value.citations) if (!visible.value.some(a => a.id === citation.id && a.revision === citation.digest))
    return tradingRefuse('TTRD1004', '/citations', 'Trader may cite only its visible report and verdict artifacts');
  const { citations, ...proposal } = output.value, ids = [...new Set(citations.map(c => c.id))];
  return createTradingRecord('trade-proposal', { ...proposal, manifestId: input.snapshot.manifestId, asset: input.snapshot.asset,
    role: artifact.value.role.id, snapshotId: input.snapshot.id, researchVerdictId: input.verdict.id,
    key: { manifestId: input.snapshot.manifestId, asset: input.snapshot.asset, sessionId: input.snapshot.sessionId, stage: 'trade-proposal' },
    citations: ids, claims: [{ text: proposal.rationale, citations: ids }], model: input.provenance.model, spend: input.provenance.spend, promptRevision: artifact.value.revision,
    exceedsPosition: proposal.action === 'sell' && proposal.quantity !== undefined && proposal.quantity > (portfolio.value.positions.find(p => p.asset === input.snapshot.asset)?.quantity ?? 0) });
}
async function researchInputForProposal(input: { reports: readonly AnalystReport[]; verdict: ResearchVerdict }): Promise<TradingOutcome<true>> {
  if (input.verdict.kind !== 'research-verdict' || input.verdict.role !== 'trading-research-verdict' || !input.verdict.result)
    return tradingRefuse('TTRD1004', '/verdict', 'Trader requires a reconstructed research verdict');
  const evidence = await reportsToEvidence(input.reports); if (!evidence.valid) return evidence;
  const result = validateGmplEvidence(input.verdict.result, evidence.value);
  if (!result.valid || result.value.disposition !== input.verdict.disposition) return tradingRefuse('TTRD1004', '/verdict', 'Verdict does not preserve its report evidence and disposition');
  return { valid: true, value: true };
}

const reportsSchema = () => ({ type: 'array', items: tradingSchemaOf('analystReport'), minItems: 4, maxItems: 4 });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export async function buildResearchAndTraderRegion(input: { materialized: MaterializedTradingResearch; catalog: GmplCatalog; profile: string }): Promise<TradingOutcome<TradingAnalystRegion & { registry: MasRegistry }>> {
  const bound = await checkMaterializedResearch(input.materialized, input.catalog); if (!bound.valid) return bound;
  const artifact = input.catalog.prompt('trading-trader'); if (!artifact) return tradingRefuse('TTRD1002', '/catalog', 'Trader prompt is absent');
  const reports = reportsSchema(), research = gmplSchemaOf('gmplInput'), result = gmplSchemaOf('gmplPatternResult'), verdict = tradingSchemaOf('researchVerdict');
  const turns = { type: 'array', items: tradingSchemaOf('debateTurn') }, proposal = tradingSchemaOf('tradeProposal');
  const role = { id: artifact.role.id, title: artifact.role.title, instructions: artifact.role.instructions, instructionsRevision: await masRevisionOf(artifact.role.instructions), capabilities: [] };
  const handlers = ['prepare-research', 'check-research', 'prepare-trader', 'check-trader'].map(id => ({ id: `trading-${id}`, title: id, effect: 'pure' as const, idempotency: 'not-required' as const }));
  const native = input.materialized.snapshot.document;
  const child = cloneJson(input.materialized.validated.workflow);
  child.registry.revision = null; child.config.registryRevision = null;
  child.versionId = await masWorkflowVersionIdOf(child as unknown as Record<string, unknown>);
  const additions = { roles: [role], handlers, messageAdapters: [{ id: `trading-${artifact.id}`, version: artifact.revision }],
    subgraphs: [{ id: child.workflowId, versionId: child.versionId, workflow: child as unknown as Record<string, unknown> }] };
  for (const key of ['roles', 'handlers', 'messageAdapters', 'subgraphs'] as const) for (const added of additions[key]) {
    const previous = native[key].find(v => v.id === added.id);
    if (previous && !equalsJson(previous, added)) return tradingRefuse('TTRD1002', '/registry', 'Trading composition cannot replace a host artifact');
  }
  const registry: MasRegistry = { ...native, ...Object.fromEntries(Object.entries(additions).map(([key, values]) => [key,
    [...native[key as keyof typeof additions], ...values.filter(v => !native[key as keyof typeof additions].some(p => p.id === v.id))]])) };
  const nodes = [
    taskInvocation({ id: 'prepare-research', handler: 'trading-prepare-research', input: { reports }, output: { input: research, reports } }),
    graphInvocation({ id: 'research', subgraph: input.materialized.validated.workflow.workflowId, input: { input: research }, output: { result } }),
    taskInvocation({ id: 'check-research', handler: 'trading-check-research', input: { reports, result }, output: { verdict, turns } }),
    taskInvocation({ id: 'prepare-trader', handler: 'trading-prepare-trader', input: { reports, verdict }, output: { variables: artifact.variableSchema } }),
    agentInvocation({ id: 'trader', role: role.id, profile: input.profile, instructionsRevision: role.instructionsRevision, messageAdapter: `trading-${artifact.id}`, input: { variables: artifact.variableSchema }, output: { out: artifact.outputSchema } }),
    taskInvocation({ id: 'check-trader', handler: 'trading-check-trader', input: { variables: artifact.variableSchema, out: artifact.outputSchema }, output: { proposal } }),
  ];
  const messages = [masMessage(['prepare-research', 'input'], ['research', 'input']), masMessage(['prepare-research', 'reports'], ['check-research', 'reports']),
    masMessage(['prepare-research', 'reports'], ['prepare-trader', 'reports']), masMessage(['research', 'result'], ['check-research', 'result']),
    masMessage(['check-research', 'verdict'], ['prepare-trader', 'verdict']), masMessage(['prepare-trader', 'variables'], ['trader', 'variables']),
    masMessage(['prepare-trader', 'variables'], ['check-trader', 'variables']), masMessage(['trader', 'out'], ['check-trader', 'out'])];
  return { valid: true, value: immutableTradingJson({ nodes, messages, registry, input: object({ reports }), output: object({ proposal, verdict, turns }),
    entry: [{ port: 'reports', to: { node: 'prepare-research', port: 'reports' } }],
    exit: [{ port: 'proposal', from: { node: 'check-trader', port: 'proposal' } }, { port: 'verdict', from: { node: 'check-research', port: 'verdict' } }, { port: 'turns', from: { node: 'check-research', port: 'turns' } }] }) };
}

export async function createTradingResearchHostBindings(input: { manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; portfolio: PortfolioSnapshot;
  catalog: GmplCatalog; materialized: MaterializedTradingResearch; trace: () => Promise<TraceView>; provenance: TradingAttemptProvenance }) {
  let content: Pick<typeof input, 'manifest' | 'snapshot' | 'portfolio'>;
  try { content = immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Research host content must be finite JSON', cause); }
  const trace = input.trace, provenance = input.provenance, catalog = input.catalog;
  if (content.manifest.promptCatalogRevision !== catalog.document.revision) return tradingRefuse('TTRD1002', '/catalog', 'Research host catalog differs from the manifest');
  const bound = await checkMaterializedResearch(input.materialized, catalog, content.manifest); if (!bound.valid) return bound;
  const prepared = await prepareTradingAnalystContext(content); if (!prepared.valid) return prepared;
  const context = prepared.value, session = content.snapshot.sessions.find(s => s.key === context.snapshot.sessionId)!;
  const artifact = catalog.prompt('trading-trader'); if (!artifact) return tradingRefuse('TTRD1002', '/catalog', 'Trader prompt is absent');
  const profile = content.manifest.rolesByProfile[artifact.role.id] ?? content.manifest.rolesByProfile.trader;
  if (!profile) return tradingRefuse('TTRD1002', '/rolesByProfile', 'Trader model profile is absent');
  const taskHandlers: Record<string, MasTaskHandlerBinding> = { ...input.materialized.bindings.taskHandlers };
  taskHandlers['trading-prepare-research'] = async ({ value }) => {
    const reports = value.reports as AnalystReport[];
    tradingTaskValue(await checkTradingArtifactScope(reports, context.snapshot));
    return { reports, input: tradingTaskValue(await researchInput({ manifest: content.manifest, asset: context.snapshot.asset, session, reports })) };
  };
  taskHandlers['trading-check-research'] = async ({ value, path }) => {
    const output = await researchVerdict({ manifest: content.manifest, snapshot: context.snapshot, session, reports: value.reports as AnalystReport[], catalog,
      result: value.result, trace: await trace(), scope: path.slice(0, -'check-research'.length) + 'research', provenance });
    return tradingTaskValue(output);
  };
  taskHandlers['trading-prepare-trader'] = async ({ value }) => {
    tradingTaskValue(await checkTradingArtifactScope([...(value.reports as AnalystReport[]), value.verdict as ResearchVerdict], context.snapshot));
    return { variables: { asset: context.snapshot.asset, cutoff_at: context.snapshot.cutoffAt, reports: value.reports, verdict: value.verdict, portfolio: context.portfolio } };
  };
  taskHandlers['trading-check-trader'] = async ({ value, path }) => {
    const variables = value.variables as { asset: string; cutoff_at: string; reports: AnalystReport[]; verdict: ResearchVerdict; portfolio: TradingVisiblePortfolio };
    if (variables.asset !== context.snapshot.asset || variables.cutoff_at !== context.snapshot.cutoffAt || !equalsJson(variables.portfolio, context.portfolio))
      return tradingTaskValue(tradingRefuse('TTRD1002', '/variables', 'Trader substituted its bound snapshot or portfolio'));
    const attempts = (await trace()).attempts.filter(a => a.path === path.slice(0, -'check-trader'.length) + 'trader' && a.status === 'completed');
    if (attempts.length !== 1) return tradingTaskValue(tradingRefuse('TTRD1004', '/trace', 'Trader requires one durable completed attempt'));
    const observed = tradingTaskValue(await checkedTradingAttempt(attempts[0], profile, provenance));
    return { proposal: tradingTaskValue(await checkTradeProposal({ output: value.out, snapshot: context.snapshot, portfolio: context.portfolio,
      reports: variables.reports, verdict: variables.verdict, artifact, provenance: observed })) };
  };
  const messageAdapters = new Map<string, MasMessageAdapter>(input.materialized.bindings.messageAdapters), id = `trading-${artifact.id}`;
  messageAdapters.set(id, { id, version: artifact.revision, render: ({ value }) => {
    const rendered = renderGmplPrompt(artifact, value.variables);
    if (!rendered.valid) return tradingTaskValue(tradingRefuse('TTRD1001', '/variables', 'Trader prompt variables refused', rendered.issues[0]));
    return rendered.value.user;
  } });
  return { valid: true as const, value: { taskHandlers, messageAdapters, context } };
}
