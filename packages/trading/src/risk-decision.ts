/** Read-only risk and fund-manager composition, ending at deterministic intent admission. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { graphInvocation, taskInvocation, agentInvocation, masMessage, masRevisionOf, masWorkflowVersionIdOf,
  type MasRegistry, type MasTaskHandlerBinding, type MasMessageAdapter } from '@tangleai/mas';
import { renderGmplPrompt, type GmplCatalog } from '@tangleai/gmpl';
import { createTradingRiskHostBindings, tradingRiskInputSchema, type MaterializedTradingRisk } from './risk-round.ts';
import { checkTradingArtifactScope } from './evidence.ts';
import { checkedTradingAttempt } from './research.ts';
import { checkFundManagerDecision } from './fund-manager.ts';
import { toOrderIntent } from './order.ts';
import { immutableTradingJson } from './identity.ts';
import { tradingSchemaOf } from './schema.ts';
import { tradingTaskValue } from './host-bindings.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import type { TradingAnalystRegion } from './analysts.ts';
import type { TradingRiskWorkflowInput } from './risk-tasks.ts';
import type { TradeProposal, RiskVerdict, FundManagerDecision, Observation, TradingVisiblePortfolio, RiskPolicy } from './contracts.gen.ts';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export async function buildRiskAndDecisionRegion(input: { riskMaterialized: MaterializedTradingRisk; catalog: GmplCatalog; profile: string }): Promise<TradingOutcome<TradingAnalystRegion & { registry: MasRegistry }>> {
  const artifact = input.catalog.prompt('trading-fund-manager');
  if (!artifact || input.riskMaterialized.promptCatalogRevision !== input.catalog.document.revision)
    return tradingRefuse('TTRD1002', '/catalog', 'Risk and fund manager must share the compiled trading catalog');
  const proposal = tradingSchemaOf('tradeProposal'), verdict = tradingSchemaOf('riskVerdict'), decision = tradingSchemaOf('fundManagerDecision');
  const turns = { type: 'array', items: tradingSchemaOf('riskTurn') }, admission = tradingSchemaOf('tradingOrderAdmission'), riskInput = tradingRiskInputSchema();
  const role = { id: artifact.role.id, title: artifact.role.title, instructions: artifact.role.instructions, instructionsRevision: await masRevisionOf(artifact.role.instructions), capabilities: [] };
  const handlers = ['prepare-risk', 'prepare-fund-manager', 'check-fund-manager', 'order-validate'].map(id => ({ id: `trading-${id}`, title: id, effect: 'pure' as const, idempotency: 'not-required' as const }));
  const child = cloneJson(input.riskMaterialized.workflow);
  child.registry.revision = null; child.config.registryRevision = null; child.versionId = await masWorkflowVersionIdOf(child as unknown as Record<string, unknown>);
  const native = input.riskMaterialized.snapshot.document;
  const additions = { roles: [role], handlers, messageAdapters: [{ id: `trading-${artifact.id}`, version: artifact.revision }],
    subgraphs: [{ id: child.workflowId, versionId: child.versionId, workflow: child as unknown as Record<string, unknown> }] };
  for (const key of ['roles', 'handlers', 'messageAdapters', 'subgraphs'] as const) for (const added of additions[key]) {
    const previous = native[key].find(v => v.id === added.id);
    if (previous && !equalsJson(previous, added)) return tradingRefuse('TTRD1002', '/registry', 'Fund-manager composition cannot replace a host artifact');
  }
  const registry: MasRegistry = { ...native, ...Object.fromEntries(Object.entries(additions).map(([key, values]) => [key,
    [...native[key as keyof typeof additions], ...values.filter(v => !native[key as keyof typeof additions].some(p => p.id === v.id))]])) };
  const nodes = [
    taskInvocation({ id: 'prepare-risk', handler: 'trading-prepare-risk', input: { input: riskInput }, output: { input: riskInput, proposal } }),
    graphInvocation({ id: 'risk', subgraph: child.workflowId, input: { input: riskInput }, output: { verdict, turns } }),
    taskInvocation({ id: 'prepare-fund-manager', handler: 'trading-prepare-fund-manager', input: { proposal, verdict }, output: { variables: artifact.variableSchema } }),
    agentInvocation({ id: 'fund-manager', role: role.id, profile: input.profile, instructionsRevision: role.instructionsRevision, messageAdapter: `trading-${artifact.id}`,
      input: { variables: artifact.variableSchema }, output: { out: artifact.outputSchema } }),
    taskInvocation({ id: 'check-fund-manager', handler: 'trading-check-fund-manager', input: { variables: artifact.variableSchema, out: artifact.outputSchema }, output: { decision } }),
    taskInvocation({ id: 'order-validate', handler: 'trading-order-validate', input: { proposal, verdict, decision }, output: { admission } }),
  ];
  const messages = [masMessage(['prepare-risk', 'input'], ['risk', 'input']), masMessage(['prepare-risk', 'proposal'], ['prepare-fund-manager', 'proposal']),
    masMessage(['prepare-risk', 'proposal'], ['order-validate', 'proposal']), masMessage(['risk', 'verdict'], ['prepare-fund-manager', 'verdict']),
    masMessage(['risk', 'verdict'], ['order-validate', 'verdict']), masMessage(['prepare-fund-manager', 'variables'], ['fund-manager', 'variables']),
    masMessage(['prepare-fund-manager', 'variables'], ['check-fund-manager', 'variables']), masMessage(['fund-manager', 'out'], ['check-fund-manager', 'out']),
    masMessage(['check-fund-manager', 'decision'], ['order-validate', 'decision'])];
  return { valid: true, value: immutableTradingJson({ nodes, messages, registry, input: object({ input: riskInput }), output: object({ verdict, turns, decision, admission }),
    entry: [{ port: 'input', to: { node: 'prepare-risk', port: 'input' } }],
    exit: [{ port: 'verdict', from: { node: 'risk', port: 'verdict' } }, { port: 'turns', from: { node: 'risk', port: 'turns' } },
      { port: 'decision', from: { node: 'check-fund-manager', port: 'decision' } }, { port: 'admission', from: { node: 'order-validate', port: 'admission' } }] }) };
}

export async function createTradingRiskDecisionHostBindings(input: Parameters<typeof createTradingRiskHostBindings>[0] & { valuationObservations?: readonly Observation[] }) {
  let content: Pick<typeof input, 'manifest' | 'snapshot' | 'portfolio' | 'valuationObservations'>;
  try { content = immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio, valuationObservations: input.valuationObservations ?? [] }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Decision bindings require finite immutable content', cause); }
  const risk = await createTradingRiskHostBindings({ ...input, ...content }); if (!risk.valid) return risk;
  const catalog = input.catalog, trace = input.trace, provenance = input.provenance, artifact = catalog.prompt('trading-fund-manager');
  const profile = content.manifest.rolesByProfile['trading-fund-manager'] ?? content.manifest.rolesByProfile['fund-manager'];
  if (!artifact || !profile) return tradingRefuse('TTRD1002', '/rolesByProfile', 'Fund-manager prompt and model profile must be declared');
  const snapshot = content.snapshot.snapshot, portfolio = risk.value.context.portfolio;
  const taskHandlers: Record<string, MasTaskHandlerBinding> = { ...risk.value.taskHandlers };
  taskHandlers['trading-prepare-risk'] = ({ value }) => ({ input: value.input, proposal: (value.input as unknown as TradingRiskWorkflowInput).proposal });
  taskHandlers['trading-prepare-fund-manager'] = async ({ value }) => {
    const proposal = value.proposal as TradeProposal, verdict = value.verdict as RiskVerdict;
    tradingTaskValue(await checkTradingArtifactScope([proposal, verdict], snapshot));
    return { variables: { asset: snapshot.asset, proposal, risk_verdict: verdict, policy: content.manifest.riskPolicy, portfolio } };
  };
  taskHandlers['trading-check-fund-manager'] = async ({ value, path }) => {
    const variables = value.variables as { asset: string; proposal: TradeProposal; risk_verdict: RiskVerdict; policy: RiskPolicy; portfolio: TradingVisiblePortfolio };
    if (variables.asset !== snapshot.asset || !equalsJson(variables.policy, content.manifest.riskPolicy) || !equalsJson(variables.portfolio, portfolio))
      return tradingTaskValue(tradingRefuse('TTRD1002', '/variables', 'Fund manager substituted its immutable portfolio or policy'));
    const attempts = (await trace()).attempts.filter(a => a.path === path.slice(0, -'check-fund-manager'.length) + 'fund-manager' && a.status === 'completed');
    if (attempts.length !== 1) return tradingTaskValue(tradingRefuse('TTRD1004', '/trace', 'Fund manager requires one durable completed attempt'));
    const observed = tradingTaskValue(await checkedTradingAttempt(attempts[0], profile, provenance));
    return { decision: tradingTaskValue(await checkFundManagerDecision({ output: value.out, proposal: variables.proposal, riskVerdict: variables.risk_verdict,
      snapshot, artifact, provenance: observed })) };
  };
  taskHandlers['trading-order-validate'] = async ({ value }) => ({ admission: tradingTaskValue(await toOrderIntent({ ...content,
    proposal: value.proposal as TradeProposal, riskVerdict: value.verdict as RiskVerdict, decision: value.decision as FundManagerDecision })) });
  const messageAdapters = new Map<string, MasMessageAdapter>(risk.value.messageAdapters), id = `trading-${artifact.id}`;
  messageAdapters.set(id, { id, version: artifact.revision, render: ({ value }) => {
    const rendered = renderGmplPrompt(artifact, value.variables);
    if (!rendered.valid) return tradingTaskValue(tradingRefuse('TTRD1001', '/variables', 'Fund-manager variables refused', rendered.issues[0]));
    return rendered.value.user;
  } });
  return { valid: true as const, value: { ...risk.value, taskHandlers, messageAdapters } };
}
