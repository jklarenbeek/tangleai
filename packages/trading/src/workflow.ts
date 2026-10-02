/** One immutable decision document, assembled from the existing model regions. */
import { equalsJson } from '@jarenjs/core/object';
import { defineMasWorkflow, taskInvocation, masMessage, createMasRegistrySnapshot, validateMasWorkflow, planMasWorkflow,
  type MasRegistry, type MasTaskHandlerBinding, type MasMessageAdapter, type TraceView } from '@tangleai/mas';
import { createGmplCatalog, type GmplCatalog } from '@tangleai/gmpl';
import { buildAnalystRegion, TRADING_ANALYST_ROLES } from './analysts.ts';
import { tradingAnalystRegistry, createTradingHostBindings, tradingTaskValue, type TradingHostInput } from './host-bindings.ts';
import { buildResearchAndTraderRegion, createTradingResearchHostBindings, type MaterializedTradingResearch } from './trader.ts';
import { buildRiskAndDecisionRegion, createTradingRiskDecisionHostBindings } from './risk-decision.ts';
import { checkMaterializedTradingRisk, type MaterializedTradingRisk } from './risk-round.ts';
import { checkedTradingAttempt, checkMaterializedResearch, type TradingAttemptProvenance } from './research.ts';
import { tradingSchemaOf, validateTradingShape } from './schema.ts';
import { validateTradingRecord } from './records.ts';
import { immutableTradingJson } from './identity.ts';
import { tradingRefuse } from './errors.ts';
import type { TradingRunManifest, TradingDecisionRequest, TradingDecisionOutput, AnalystReport, Observation, Artifact } from './contracts.gen.ts';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (name: Parameters<typeof tradingSchemaOf>[0]) => ({ type: 'array', items: tradingSchemaOf(name) });
export interface TradingWorkflowInput {
  catalog: GmplCatalog; manifest: TradingRunManifest; researchMaterialized: MaterializedTradingResearch; riskMaterialized: MaterializedTradingRisk; profile: string;
}
export async function buildTradingDecisionWorkflow(input: TradingWorkflowInput) {
  const manifest = await validateTradingRecord(input.manifest); if (!manifest.valid) return manifest;
  const catalog = await createGmplCatalog(input.catalog.document); if (!catalog.valid) return catalog;
  const { researchMaterialized: research, riskMaterialized: risk } = input;
  if (manifest.value.kind !== 'manifest' || manifest.value.promptCatalogRevision !== catalog.value.document.revision
    || research.catalog.revision !== risk.catalog.revision)
    return tradingRefuse('TTRD1002', '/materialized', 'Decision regions require the same compiled catalog and host configuration');
  const checkedResearch = await checkMaterializedResearch(research, catalog.value, input.manifest); if (!checkedResearch.valid) return checkedResearch;
  const checkedRisk = await checkMaterializedTradingRisk(risk, catalog.value, input.manifest); if (!checkedRisk.valid) return checkedRisk;
  const profileFor = (role: string, group: string) => input.manifest.rolesByProfile[role] ?? input.manifest.rolesByProfile[group];
  const analystProfile = profileFor('trading-analyst-fundamentals', 'analyst');
  const traderProfile = profileFor('trading-trader', 'trader'), fundProfile = profileFor('trading-fund-manager', 'fund-manager');
  if (!analystProfile || !traderProfile || !fundProfile || TRADING_ANALYST_ROLES.some(role => !profileFor(`trading-analyst-${role}`, 'analyst'))) return tradingRefuse('TTRD1002', '/rolesByProfile', 'Every decision role must declare its profile');
  const analysts = await buildAnalystRegion({ catalog: catalog.value, profile: analystProfile, limits: input.manifest.limits }); if (!analysts.valid) return analysts;
  const debate = await buildResearchAndTraderRegion({ materialized: research, catalog: catalog.value, profile: traderProfile }); if (!debate.valid) return debate;
  const decision = await buildRiskAndDecisionRegion({ riskMaterialized: risk, catalog: catalog.value, profile: fundProfile }); if (!decision.valid) return decision;
  const analystRegistry = await tradingAnalystRegistry(catalog.value); if (!analystRegistry.valid) return analystRegistry;
  const nodes = [...analysts.value.nodes, ...debate.value.nodes, ...decision.value.nodes].map(node => {
    if (node.kind !== 'agent' || !node.id.startsWith('analyst-')) return node;
    return { ...node, profile: profileFor(node.role, 'analyst')! };
  });
  const reports = { ...array('analystReport'), minItems: 4, maxItems: 4 }, reportPorts = (analysts.value.output as { properties: Record<string, Record<string, unknown>> }).properties;
  const request = tradingSchemaOf('tradingDecisionRequest'), snapshot = tradingSchemaOf('marketSnapshot'), riskInput = (decision.value.input as { properties: { input: Record<string, unknown> } }).properties.input;
  const collected = { reports, 'research-verdict': tradingSchemaOf('researchVerdict'), 'debate-turns': array('debateTurn'), proposal: tradingSchemaOf('tradeProposal'),
    'risk-verdict': tradingSchemaOf('riskVerdict'), 'risk-turns': array('riskTurn'), decision: tradingSchemaOf('fundManagerDecision'), admission: tradingSchemaOf('tradingOrderAdmission') };
  nodes.unshift(taskInvocation({ id: 'snapshot-project', handler: 'trading-snapshot-project', input: { request }, output: { snapshot } }));
  nodes.push(taskInvocation({ id: 'evidence-project', handler: 'trading-evidence-project', input: reportPorts, output: { reports } }),
    taskInvocation({ id: 'assemble-risk', handler: 'trading-assemble-risk', input: { reports, verdict: tradingSchemaOf('researchVerdict'), proposal: tradingSchemaOf('tradeProposal') }, output: { input: riskInput } }),
    taskInvocation({ id: 'decision-output', handler: 'trading-decision-output', input: collected, output: { output: tradingSchemaOf('tradingDecisionOutput') } }));
  const messages = [...analysts.value.messages, ...debate.value.messages, ...decision.value.messages,
    ...analysts.value.entry.map(e => masMessage(['snapshot-project', 'snapshot'], [e.to.node, e.to.port])),
    ...analysts.value.exit.map(e => masMessage([e.from.node, e.from.port], ['evidence-project', e.port])),
    masMessage(['evidence-project', 'reports'], ['prepare-research', 'reports']), masMessage(['evidence-project', 'reports'], ['assemble-risk', 'reports']),
    masMessage(['check-research', 'verdict'], ['assemble-risk', 'verdict']), masMessage(['check-trader', 'proposal'], ['assemble-risk', 'proposal']),
    masMessage(['assemble-risk', 'input'], ['prepare-risk', 'input']),
    ...([['evidence-project', 'reports', 'reports'], ['check-research', 'verdict', 'research-verdict'], ['check-research', 'turns', 'debate-turns'],
      ['check-trader', 'proposal', 'proposal'], ['risk', 'verdict', 'risk-verdict'], ['risk', 'turns', 'risk-turns'],
      ['check-fund-manager', 'decision', 'decision'], ['order-validate', 'admission', 'admission']] as const)
      .map(([node, port, target]) => masMessage([node, port], ['decision-output', target], { id: `collect-${target}` }))];
  const registry: MasRegistry = { ...analystRegistry.value, registryId: 'trading-decision' };
  for (const source of [debate.value.registry, decision.value.registry]) for (const key of ['roles', 'handlers', 'tools', 'messageAdapters', 'contextAdapters', 'templates', 'subgraphs'] as const) {
    const rows = registry[key] as Array<{ id: string }>;
    for (const row of source[key]) {
      const prior = rows.find(r => r.id === row.id);
      if (prior && !equalsJson(prior, row)) return tradingRefuse('TTRD1002', '/registry', 'Decision composition cannot replace a declared host artifact');
      if (!prior) rows.push(row);
    }
  }
  for (const id of ['snapshot-project', 'evidence-project', 'assemble-risk', 'decision-output']) registry.handlers.push({ id: `trading-${id}`, title: id, effect: 'pure', idempotency: 'not-required' });
  const pinned = await createMasRegistrySnapshot(registry); if (!pinned.valid) return pinned;
  const workflow = await defineMasWorkflow({ workflowId: 'trading-decision', title: 'Causal trading decision', description: 'One bounded evidence chain ending at deterministic order admission.',
    input: object({ request }), output: object({ output: tradingSchemaOf('tradingDecisionOutput') }), nodes, messages,
    entry: [{ port: 'request', to: { node: 'snapshot-project', port: 'request' } }], exit: [{ port: 'output', from: { node: 'decision-output', port: 'output' } }],
    limits: input.manifest.limits, profile: input.profile, registryRevision: pinned.value.revision, configRegistryRevision: research.catalog.revision });
  const validated = await validateMasWorkflow(workflow, pinned.value, research.catalog); if (!validated.valid) return validated;
  const plan = await planMasWorkflow(validated.value); if (!plan.valid) return plan;
  return { valid: true as const, value: { workflow, validated: validated.value, plan: plan.value, snapshot: pinned.value, catalog: research.catalog,
    researchMaterialized: research, riskMaterialized: risk, manifestId: input.manifest.id, promptCatalogRevision: catalog.value.document.revision } };
}
export type MaterializedTradingDecision = Extract<Awaited<ReturnType<typeof buildTradingDecisionWorkflow>>, { valid: true }>['value'];

export async function createTradingDecisionHostBindings(input: Omit<TradingHostInput, 'provenance'> & { materialized: MaterializedTradingDecision;
  trace: () => Promise<TraceView>; provenance: TradingAttemptProvenance; valuationObservations?: readonly Observation[] }) {
  let content: Pick<typeof input, 'manifest' | 'snapshot' | 'portfolio' | 'valuationObservations'>;
  try { content = immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio, valuationObservations: input.valuationObservations ?? [] }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Decision host content must be finite JSON', cause); }
  const { materialized, trace, provenance } = input;
  if (materialized.manifestId !== content.manifest.id || materialized.promptCatalogRevision !== input.catalog.document.revision)
    return tradingRefuse('TTRD1002', '/materialized', 'Decision content differs from its immutable workflow');
  const expected = await buildTradingDecisionWorkflow({ manifest: content.manifest, catalog: input.catalog,
    researchMaterialized: materialized.researchMaterialized, riskMaterialized: materialized.riskMaterialized, profile: materialized.workflow.config.profile });
  if (!expected.valid || !equalsJson(materialized.workflow, expected.value.workflow) || !equalsJson(materialized.validated.workflow, expected.value.validated.workflow)
    || !equalsJson(materialized.plan, expected.value.plan) || materialized.snapshot.revision !== expected.value.snapshot.revision)
    return tradingRefuse('TTRD1002', '/materialized', 'Decision bindings require the declared bounded topology and execution plan');
  const analysts = await createTradingHostBindings({ ...input, ...content, provenance: async role => {
    const attempts = (await trace()).attempts.filter(a => a.path === `analyst-${role}` && a.status === 'completed');
    if (attempts.length !== 1) return tradingRefuse('TTRD1004', '/trace', 'Analyst requires one completed durable attempt');
    const profile = content.manifest.rolesByProfile[`trading-analyst-${role}`] ?? content.manifest.rolesByProfile.analyst;
    return checkedTradingAttempt(attempts[0], profile, provenance);
  } }); if (!analysts.valid) return analysts;
  const research = await createTradingResearchHostBindings({ ...input, ...content, materialized: materialized.researchMaterialized }); if (!research.valid) return research;
  const risk = await createTradingRiskDecisionHostBindings({ ...input, ...content, materialized: materialized.riskMaterialized }); if (!risk.valid) return risk;
  const snapshot = content.snapshot.snapshot;
  const request: TradingDecisionRequest = { manifestId: content.manifest.id, asset: snapshot.asset, sessionId: snapshot.sessionId, snapshotId: snapshot.id, portfolioId: content.portfolio.id };
  const taskHandlers: Record<string, MasTaskHandlerBinding> = { ...analysts.value.taskHandlers, ...research.value.taskHandlers, ...risk.value.taskHandlers };
  taskHandlers['trading-snapshot-project'] = ({ value }) => {
    if (!equalsJson(value.request, request)) return tradingTaskValue(tradingRefuse('TTRD1002', '/request', 'Decision request differs from its pinned evidence and portfolio'));
    if (snapshot.providerErrors.length) return tradingTaskValue(tradingRefuse('TTRD1007', '/providers', 'A required point-in-time provider is unavailable', snapshot.providerErrors));
    return { snapshot };
  };
  taskHandlers['trading-evidence-project'] = ({ value }) => ({ reports: TRADING_ANALYST_ROLES.map(role => value[role] as AnalystReport) });
  taskHandlers['trading-assemble-risk'] = ({ value }) => ({ input: value });
  taskHandlers['trading-decision-output'] = ({ value }) => {
    const artifacts = [...value.reports as Artifact[], ...value['debate-turns'] as Artifact[], value['research-verdict'] as Artifact, value.proposal as Artifact,
      ...value['risk-turns'] as Artifact[], value['risk-verdict'] as Artifact, value.decision as Artifact];
    return { output: tradingTaskValue(validateTradingShape<TradingDecisionOutput>('tradingDecisionOutput', { admission: value.admission, artifacts })) };
  };
  const messageAdapters = new Map<string, MasMessageAdapter>([...analysts.value.messageAdapters, ...research.value.messageAdapters, ...risk.value.messageAdapters]);
  return { valid: true as const, value: { taskHandlers, messageAdapters, toolBindings: analysts.value.toolBindings, audit: analysts.value.audit, request } };
}
