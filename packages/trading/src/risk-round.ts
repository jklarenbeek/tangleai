/** Three declared personas and a distinct facilitator, composed with native MAS builders. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { defineMasWorkflow, taskInvocation, agentInvocation, loopInvocation, masMessage, masRevisionOf, masWorkflowVersionIdOf, createMasRegistrySnapshot,
  validateMasWorkflow, planMasWorkflow, type MasWorkflow, type Invocation, type WorkflowLimits, type MasRegistry,
  type MasTaskHandlerBinding, type MasMessageAdapter, type TraceView } from '@tangleai/mas';
import { createGmplCatalog, renderGmplPrompt, type GmplCatalog, type GmplHostSnapshot, type GmplPromptArtifact } from '@tangleai/gmpl';
import { prepareTradingAnalystContext } from './analysts.ts';
import { checkedTradingAttempt, type TradingAttemptProvenance } from './research.ts';
import { immutableTradingJson } from './identity.ts';
import { validateTradingRecord } from './records.ts';
import { tradingSchemaOf } from './schema.ts';
import { tradingTaskValue } from './host-bindings.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import { TRADING_RISK_PERSONAS, initializeTradingRisk, checkRiskTurn, collectTradingRiskTurns, gateTradingRiskRound, finalizeTradingRisk,
  type TradingRiskWorkflowInput, type TradingRiskContext } from './risk-tasks.ts';
import type { TradingSnapshotBundle } from './snapshot.ts';
import type { TradingRunManifest, PortfolioSnapshot, TradingRiskState, RiskTurn } from './contracts.gen.ts';

const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items: Record<string, unknown>) => ({ type: 'array', items });
const task = (id: string, input: Parameters<typeof taskInvocation>[0]['input'], output: Parameters<typeof taskInvocation>[0]['output']) => taskInvocation({ id, handler: `trading-${id}`, input, output });
const agent = async (id: string, artifact: GmplPromptArtifact, profile: string) => agentInvocation({ id, role: artifact.role.id, profile,
  instructionsRevision: await masRevisionOf(artifact.role.instructions), messageAdapter: `trading-${artifact.id}`,
  input: { variables: artifact.variableSchema }, output: { out: artifact.outputSchema } });
export const tradingRiskInputSchema = () => object({ reports: array(tradingSchemaOf('analystReport')), verdict: tradingSchemaOf('researchVerdict'), proposal: tradingSchemaOf('tradeProposal') });

export async function buildRiskRound(input: { catalog: GmplCatalog; profile: string; limits: WorkflowLimits }): Promise<TradingOutcome<MasWorkflow>> {
  const position = input.catalog.prompt('trading-risk-position'), facilitator = input.catalog.prompt('trading-risk-facilitator');
  if (!position || !facilitator) return tradingRefuse('TTRD1002', '/catalog', 'Risk position and facilitator prompts are required');
  if (input.limits.concurrency < 3 || input.limits.fanOut < 7) return tradingRefuse('TTRD1009', '/limits', 'Risk lanes need three concurrent personas and seven state deliveries');
  const state = tradingSchemaOf('tradingRiskState'), turn = tradingSchemaOf('riskTurn'), nodes: Invocation[] = [], messages: ReturnType<typeof masMessage>[] = [];
  const entry: MasWorkflow['entry'] = [];
  for (const persona of TRADING_RISK_PERSONAS) {
    const id = `risk-${persona}`, prepare = `prepare-${id}`, check = `check-${id}`;
    nodes.push(task(prepare, { state }, { variables: position.variableSchema }), await agent(id, position, input.profile), task(check, { state, out: position.outputSchema }, { turn }));
    entry.push({ port: 'state', to: { node: prepare, port: 'state' } }, { port: 'state', to: { node: check, port: 'state' } });
    messages.push(masMessage([prepare, 'variables'], [id, 'variables']), masMessage([id, 'out'], [check, 'out']), masMessage([check, 'turn'], ['risk-turns', 'turns'], { aggregation: 'ordered-list' }));
  }
  nodes.push(task('risk-turns', { state, turns: array(turn) }, { state }), task('prepare-risk-facilitator', { state }, { variables: facilitator.variableSchema }),
    await agent('risk-facilitator', facilitator, input.profile), task('risk-gate', { state, out: facilitator.outputSchema }, { state }));
  entry.push({ port: 'state', to: { node: 'risk-turns', port: 'state' } });
  messages.push(masMessage(['risk-turns', 'state'], ['prepare-risk-facilitator', 'state']), masMessage(['risk-turns', 'state'], ['risk-gate', 'state']),
    masMessage(['prepare-risk-facilitator', 'variables'], ['risk-facilitator', 'variables']), masMessage(['risk-facilitator', 'out'], ['risk-gate', 'out']));
  return { valid: true, value: await defineMasWorkflow({ workflowId: 'trading-risk-round', title: 'Three risk perspectives',
    description: 'Independent risk positions precede one evidence-bound facilitator.', input: object({ state }), output: object({ state }), nodes, messages, entry,
    exit: [{ port: 'state', from: { node: 'risk-gate', port: 'state' } }], limits: input.limits, profile: input.profile, registryRevision: null, configRegistryRevision: null }) };
}
export async function buildRiskPattern(input: { body: MasWorkflow; maxRounds: number; profile: string; limits: WorkflowLimits }): Promise<MasWorkflow> {
  const state = tradingSchemaOf('tradingRiskState'), verdict = tradingSchemaOf('riskVerdict'), turns = array(tradingSchemaOf('riskTurn'));
  return defineMasWorkflow({ workflowId: 'trading-risk', title: 'Bounded risk review', description: 'Explicit terminal risk carry and immutable advisory verdict.',
    input: object({ input: tradingRiskInputSchema() }), output: object({ verdict, turns }), nodes: [
      task('risk-initialize', { input: tradingRiskInputSchema() }, { state }),
      loopInvocation({ id: 'risk-rounds', body: input.body.workflowId, input: { state }, output: { next: state }, init: [{ port: 'state', to: '/state' }],
        feedback: [{ from: '/state', to: '/state' }], result: [{ port: 'next', from: '/state' }], maxIterations: input.maxRounds, termination: { $eq: ['$.output.state.done', true] } }),
      task('risk-finalize', { state }, { verdict, turns })],
    messages: [masMessage(['risk-initialize', 'state'], ['risk-rounds', 'state']), masMessage(['risk-rounds', 'next'], ['risk-finalize', 'state'])],
    entry: [{ port: 'input', to: { node: 'risk-initialize', port: 'input' } }],
    exit: [{ port: 'verdict', from: { node: 'risk-finalize', port: 'verdict' } }, { port: 'turns', from: { node: 'risk-finalize', port: 'turns' } }],
    limits: input.limits, profile: input.profile, registryRevision: null, configRegistryRevision: null });
}
export async function materializeTradingRisk(input: { host: GmplHostSnapshot; manifest: TradingRunManifest; catalog: GmplCatalog }) {
  const manifest = await validateTradingRecord(input.manifest); if (!manifest.valid) return manifest;
  const catalog = await createGmplCatalog(input.catalog.document); if (!catalog.valid) return catalog;
  if (input.manifest.promptCatalogRevision !== catalog.value.document.revision || ['trading-risk-position', 'trading-risk-facilitator'].some(role =>
    (input.manifest.rolesByProfile[role] ?? input.manifest.rolesByProfile.risk) !== input.host.profile))
    return tradingRefuse('TTRD1002', '/catalog', 'Risk roles require the manifest catalog and host profile');
  const limits = Object.fromEntries(Object.entries(input.manifest.limits).map(([key, value]) => [key, Math.min(value, input.host.config.limits?.[key as keyof WorkflowLimits] ?? value)])) as unknown as WorkflowLimits;
  const body = await buildRiskRound({ catalog: catalog.value, profile: input.host.profile, limits }); if (!body.valid) return body;
  const workflow = cloneJson(await buildRiskPattern({ body: body.value, maxRounds: input.manifest.rounds.risk, profile: input.host.profile, limits }));
  const prompts = ['trading-risk-position', 'trading-risk-facilitator'].map(id => catalog.value.prompt(id)!);
  const roles = await Promise.all(prompts.map(async a => ({ id: a.role.id, title: a.role.title, instructions: a.role.instructions,
    instructionsRevision: await masRevisionOf(a.role.instructions), capabilities: [] })));
  const handlers = [...new Set([workflow, body.value].flatMap(w => w.nodes.filter(n => n.kind === 'task').map(n => n.handler)))].map(id => ({ id, title: id, effect: 'pure' as const, idempotency: 'not-required' as const }));
  const additions = { roles, handlers, messageAdapters: [{ id: 'json-schema', version: '0.1' }, ...prompts.map(a => ({ id: `trading-${a.id}`, version: a.revision }))],
    subgraphs: [{ id: body.value.workflowId, versionId: body.value.versionId, workflow: body.value as unknown as Record<string, unknown> }] };
  const registry = input.host.registry.document;
  for (const key of ['roles', 'handlers', 'messageAdapters', 'subgraphs'] as const) for (const added of additions[key]) {
    const previous = registry[key].find(v => v.id === added.id);
    if (previous && !equalsJson(previous, added)) return tradingRefuse('TTRD1002', '/registry', 'Risk composition cannot replace a host artifact');
  }
  const snapshot = await createMasRegistrySnapshot({ ...registry, ...Object.fromEntries(Object.entries(additions).map(([key, values]) => [key,
    [...registry[key as keyof typeof additions], ...values.filter(v => !registry[key as keyof typeof additions].some(p => p.id === v.id))]])) } as MasRegistry);
  if (!snapshot.valid) return snapshot;
  workflow.registry.revision = snapshot.value.revision; workflow.config.registryRevision = input.host.config.revision;
  workflow.versionId = await masWorkflowVersionIdOf(workflow as unknown as Record<string, unknown>);
  const validated = await validateMasWorkflow(workflow, snapshot.value, input.host.config); if (!validated.valid) return validated;
  const plan = await planMasWorkflow(validated.value); if (!plan.valid) return plan;
  return { valid: true as const, value: { workflow, body: body.value, validated: validated.value, plan: plan.value, snapshot: snapshot.value, catalog: input.host.config,
    profile: input.host.profile, rounds: input.manifest.rounds.risk, promptCatalogRevision: catalog.value.document.revision } };
}
export type MaterializedTradingRisk = Extract<Awaited<ReturnType<typeof materializeTradingRisk>>, { valid: true }>['value'];
/** Rebuild the bounded native topology before exposing its host bindings. */
export async function checkMaterializedTradingRisk(materialized: MaterializedTradingRisk, catalog: GmplCatalog, manifest: TradingRunManifest) {
  if (materialized.promptCatalogRevision !== catalog.document.revision || manifest.promptCatalogRevision !== catalog.document.revision
    || materialized.rounds !== manifest.rounds.risk || ['trading-risk-position', 'trading-risk-facilitator'].some(role =>
      (manifest.rolesByProfile[role] ?? manifest.rolesByProfile.risk) !== materialized.profile))
    return tradingRefuse('TTRD1002', '/materialized', 'Risk host differs from the materialized catalog, rounds or profiles');
  const expected = await materializeTradingRisk({ manifest: manifest, catalog: catalog,
    host: { registry: materialized.snapshot, config: materialized.catalog, profile: materialized.profile } });
  if (!expected.valid || !equalsJson(materialized.workflow, expected.value.workflow) || !equalsJson(materialized.body, expected.value.body)
    || !equalsJson(materialized.validated.workflow, expected.value.validated.workflow) || !equalsJson(materialized.plan, expected.value.plan))
    return tradingRefuse('TTRD1002', '/materialized', 'Risk bindings require the declared bounded topology and execution plan');
  return expected;
}
export async function createTradingRiskHostBindings(input: { manifest: TradingRunManifest; snapshot: TradingSnapshotBundle; portfolio: PortfolioSnapshot;
  catalog: GmplCatalog; materialized: MaterializedTradingRisk; trace: () => Promise<TraceView>; provenance: TradingAttemptProvenance }) {
  let content: Pick<typeof input, 'manifest' | 'snapshot' | 'portfolio'>;
  try { content = immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, portfolio: input.portfolio }); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Risk host requires finite immutable content', cause); }
  const prepared = await prepareTradingAnalystContext(content); if (!prepared.valid) return prepared;
  const catalog = await createGmplCatalog(input.catalog.document); if (!catalog.valid) return catalog;
  const { materialized, trace, provenance } = input;
  const expected = await checkMaterializedTradingRisk(materialized, catalog.value, content.manifest); if (!expected.valid) return expected;
  const profile = expected.value.profile;
  const context: TradingRiskContext = { manifest: content.manifest, snapshot: content.snapshot.snapshot, catalog: catalog.value };
  const variables = (state: TradingRiskState, persona: string) => ({ asset: context.snapshot.asset, persona, proposal: state.proposal,
    portfolio: prepared.value.portfolio, policy: content.manifest.riskPolicy, evidence: state.evidence, turns: [...state.turns, ...state.currentTurns], findings: state.findings });
  const observed = async (path: string) => {
    const attempts = (await trace()).attempts.filter(a => a.path === path && a.status === 'completed');
    if (attempts.length !== 1) return tradingTaskValue(tradingRefuse('TTRD1004', '/trace', 'Risk role requires one durable completed attempt'));
    const attempt = attempts[0], value = tradingTaskValue(await checkedTradingAttempt(attempt, profile, provenance));
    return { ...value, attemptKey: attempt.idempotencyKey, attemptNumber: attempt.attempt };
  };
  const taskHandlers: Record<string, MasTaskHandlerBinding> = {
    'trading-risk-initialize': async ({ value }) => ({ state: tradingTaskValue(await initializeTradingRisk(value.input as unknown as TradingRiskWorkflowInput, context)) }),
    'trading-risk-turns': async ({ value }) => ({ state: tradingTaskValue(await collectTradingRiskTurns(value.state as TradingRiskState, value.turns as RiskTurn[], context)) }),
    'trading-prepare-risk-facilitator': ({ value }) => ({ variables: variables(value.state as TradingRiskState, 'facilitator') }),
    'trading-risk-gate': async ({ value, path }) => ({ state: tradingTaskValue(gateTradingRiskRound({ state: value.state as TradingRiskState, output: value.out, context,
      provenance: await observed(path.slice(0, -'risk-gate'.length) + 'risk-facilitator') })) }),
    'trading-risk-finalize': async ({ value }) => tradingTaskValue(await finalizeTradingRisk(value.state as TradingRiskState, context)),
  };
  for (const persona of TRADING_RISK_PERSONAS) {
    taskHandlers[`trading-prepare-risk-${persona}`] = ({ value }) => ({ variables: variables(value.state as TradingRiskState, persona) });
    taskHandlers[`trading-check-risk-${persona}`] = async ({ value, path }) => ({ turn: tradingTaskValue(await checkRiskTurn({ state: value.state as TradingRiskState,
      persona, output: value.out, context, provenance: await observed(path.slice(0, -`check-risk-${persona}`.length) + `risk-${persona}`) })) });
  }
  const messageAdapters = new Map<string, MasMessageAdapter>();
  for (const role of ['trading-risk-position', 'trading-risk-facilitator']) {
    const artifact = catalog.value.prompt(role)!, id = `trading-${artifact.id}`;
    messageAdapters.set(id, { id, version: artifact.revision, render: ({ value }) => {
      const rendered = renderGmplPrompt(artifact, value.variables);
      if (!rendered.valid) return tradingTaskValue(tradingRefuse('TTRD1001', '/variables', 'Risk prompt variables refused', rendered.issues[0]));
      return rendered.value.user;
    } });
  }
  return { valid: true as const, value: { taskHandlers, messageAdapters, context: prepared.value } };
}
