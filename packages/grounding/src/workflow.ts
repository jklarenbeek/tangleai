/** One MAS document composes policy, the GMPL child, retrieval and the claim ledger. */
import { agentInvocation, taskInvocation, graphInvocation, switchInvocation, masMessage, defineMasWorkflow,
    masWorkflowVersionIdOf, createMasConfigCatalog, validateMasWorkflow, planMasWorkflow, projectMasPlan,
    type Invocation, type MessageEdge, type MasWorkflow, type JsonSchema } from '@tangleai/mas';
import { groundingMust, groundingReject } from './errors.ts';
import { loadGroundingProfile } from './profile.ts';
import type { GroundingProfile, OptimizerCheckpoint } from './contracts.gen.ts';
import { prepareGroundingClarification } from './clarification.ts';
import { createGroundingRegistry, type GroundingAgentStage } from './registry.ts';
const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text: JsonSchema = { type: 'string', minLength: 1 };
const nullable: JsonSchema = { type: ['string', 'null'] };
export const GROUNDING_STAGE_SCHEMA = object({ sessionId: text, route: { enum: ['continue', 'complex', 'refuse'] },
    intentId: nullable, planId: nullable, answerId: nullable,
    evidenceIds: { type: 'array', items: text }, conflictIds: { type: 'array', items: text } });
export interface GroundingStageValue {
    sessionId: string; route: 'continue' | 'complex' | 'refuse'; intentId: string | null; planId: string | null; answerId: string | null;
    evidenceIds: string[]; conflictIds: string[];
}
export const GROUNDING_QUERY_SCHEMA = object({ context: GROUNDING_STAGE_SCHEMA, index: { type: 'integer', minimum: 0 }, queryId: nullable });
export const GROUNDING_LANE_SCHEMA = object({ context: GROUNDING_STAGE_SCHEMA, queryId: nullable,
    evidenceIds: { type: 'array', items: text }, contextTokens: { type: 'integer', minimum: 0 }, stopReason: text });
export function groundingWorkflowLimits(profile: GroundingProfile) {
    return { calls: profile.budgets.calls, tokens: profile.budgets.tokens, ms: profile.budgets.ms,
        toolRounds: profile.budgets.searches + profile.budgets.fetches, fanOut: Math.max(8, profile.clarification.maxQueries * 2 + 2),
        concurrency: 1, iterations: Math.max(1, profile.clarification.maxTurns), contextChars: Math.max(1, profile.budgets.tokens * 4),
        traceBytes: Math.max(1024, profile.budgets.tokens * 64) };
}
export async function createGroundingWorkflow(options: { profile: GroundingProfile; caseId: string; factVocabulary: readonly string[];
    currentOptimization: () => Promise<OptimizerCheckpoint> }) {
    const profile = groundingMust(await loadGroundingProfile(options.profile)), limits = groundingWorkflowLimits(profile);
    const clarification = profile.clarification.maxTurns ? await prepareGroundingClarification(profile, null, options.factVocabulary, options.caseId,
        { current: options.currentOptimization }) : undefined;
    const child = clarification ? JSON.parse(JSON.stringify(clarification.validated.workflow)) as MasWorkflow : undefined;
    const embedded: MasWorkflow[] = clarification ? [...clarification.snapshot.subgraphs.values()].map(row => JSON.parse(JSON.stringify(row)) as MasWorkflow) : [];
    if (child) embedded.push(child);
    for (const row of embedded) {
        row.registry.revision = null; row.config.registryRevision = null;
        for (const key of Object.keys(limits) as Array<keyof typeof limits>) row.limits[key] = Math.min(row.limits[key], limits[key]);
        row.versionId = await masWorkflowVersionIdOf(row as unknown as Record<string, unknown>);
    }
    const snapshot = await createGroundingRegistry(clarification?.snapshot,
        embedded.map(workflow => ({ id: workflow.workflowId, versionId: workflow.versionId, workflow: workflow as unknown as Record<string, unknown> })));
    const config = await createMasConfigCatalog({ profiles: [...new Set(Object.values(profile.models))], tools: ['web_search', 'web_fetch'], contexts: [], limits });
    if (!config.valid) groundingReject('TGRD1009', '/config', 'Grounding CONFIG catalog refused.', config.issues[0]);
    const nodes: Invocation[] = [], messages: MessageEdge[] = [];
    const task = (id: string, handler: string, input: Record<string, JsonSchema> = { context: GROUNDING_STAGE_SCHEMA },
        output: Record<string, JsonSchema> = { context: GROUNDING_STAGE_SCHEMA }) => {
        nodes.push(taskInvocation({ id, handler: 'grounding-' + handler, effect: 'effectful', input, output }));
    };
    const agent = (id: string, stage: GroundingAgentStage, input: Record<string, JsonSchema> = { context: GROUNDING_STAGE_SCHEMA }, output: Record<string, JsonSchema> = { context: GROUNDING_STAGE_SCHEMA }) => {
        const role = snapshot.document.roles.find(row => row.id === 'grounding-' + stage)!;
        const model = stage === 'web-agent' ? profile.models.plan : profile.models[stage];
        nodes.push(agentInvocation({ id, role: role.id, profile: model, instructionsRevision: role.instructionsRevision,
            executor: role.id, messageAdapter: role.id, tools: stage === 'web-agent' ? ['web_search', 'web_fetch'] : [], input, output }));
    };
    const edge = (a: string, b: string, from = 'context', to = 'context') => messages.push(masMessage([a, from], [b, to], { id: `${a}-${from}-${b}-${to}` }));
    task('rules', 'rules'); agent('triage', 'triage'); edge('rules', 'triage');
    const complexNodes = child ? ['clarify-input', 'clarification', 'clarify-project'] : ['clarify-project'];
    nodes.push(switchInvocation({ id: 'intent-route', input: { context: GROUNDING_STAGE_SCHEMA }, output: { next: GROUNDING_STAGE_SCHEMA }, mode: 'one-of', default: 'simple', branches: [
        { id: 'complex', when: { $eq: ['$.context.route', 'complex'] }, nodes: complexNodes, result: { node: 'clarify-project', port: 'context' } },
        { id: 'refused', when: { $eq: ['$.context.route', 'refuse'] }, nodes: ['refuse'], result: { node: 'refuse', port: 'context' } },
        { id: 'simple', when: { $eq: ['$.context.route', 'continue'] }, nodes: ['ready'], result: { node: 'ready', port: 'context' } },
    ] }));
    edge('triage', 'intent-route'); task('ready', 'ready'); task('refuse', 'refuse'); edge('intent-route', 'ready'); edge('intent-route', 'refuse');
    if (child) {
        const input = (child.input.schema as { properties: Record<string, JsonSchema> }).properties.input;
        const result = (child.output.schema as { properties: Record<string, JsonSchema> }).properties.result;
        task('clarify-input', 'clarify-input', { context: GROUNDING_STAGE_SCHEMA }, { input });
        nodes.push(graphInvocation({ id: 'clarification', subgraph: child.workflowId, input: { input }, output: { result } }));
        task('clarify-project', 'clarify-project', { context: GROUNDING_STAGE_SCHEMA, result });
        edge('intent-route', 'clarify-input'); edge('clarify-input', 'clarification', 'input', 'input');
        edge('intent-route', 'clarify-project'); edge('clarification', 'clarify-project', 'result', 'result');
    } else { task('clarify-project', 'clarify-project'); edge('intent-route', 'clarify-project'); }
    agent('plan', 'plan'); edge('intent-route', 'plan', 'next'); task('expand', 'expand'); edge('plan', 'expand');
    const joined: Record<string, JsonSchema> = {};
    for (let i = 0; i < profile.clarification.maxQueries; i++) {
        const id = 'query-' + (i + 1), local = 'local-' + (i + 1), web = 'web-' + (i + 1);
        task(id, 'query', { context: GROUNDING_STAGE_SCHEMA }, { query: GROUNDING_QUERY_SCHEMA }); edge('expand', id);
        task(local, 'local', { query: GROUNDING_QUERY_SCHEMA }, { lane: GROUNDING_LANE_SCHEMA }); edge(id, local, 'query', 'query');
        agent(web, 'web-agent', { query: GROUNDING_QUERY_SCHEMA }, { lane: GROUNDING_LANE_SCHEMA }); edge(id, web, 'query', 'query');
        joined[local] = GROUNDING_LANE_SCHEMA; joined[web] = GROUNDING_LANE_SCHEMA;
        edge(local, 'join', 'lane', local); edge(web, 'join', 'lane', web);
    }
    task('join', 'join', joined); task('reconcile', 'reconcile'); edge('join', 'reconcile');
    agent('reconcile-model', 'reconcile'); edge('reconcile', 'reconcile-model');
    agent('generate', 'generate'); edge('reconcile-model', 'generate');
    task('validate', 'validate'); edge('generate', 'validate'); task('answer', 'answer'); edge('validate', 'answer');
    const workflow = await defineMasWorkflow({ workflowId: 'grounding-session', title: 'Grounded session',
        description: 'Profile rules, durable clarification, dual retrieval, reconciliation and validated claim citations. Binding: ' + options.caseId,
        input: object({ context: GROUNDING_STAGE_SCHEMA }), output: object({ context: GROUNDING_STAGE_SCHEMA }),
        entry: [{ port: 'context', to: { node: 'rules', port: 'context' } }], exit: [{ port: 'context', from: { node: 'answer', port: 'context' } }],
        nodes, messages, limits, profile: profile.models.triage, registryRevision: snapshot.revision, configRegistryRevision: config.value.revision });
    const validated = await validateMasWorkflow(workflow, snapshot, config.value);
    if (!validated.valid) groundingReject('TGRD1009', '/workflow', 'Grounding workflow failed semantic validation.', validated.issues[0]);
    const planned = await planMasWorkflow(validated.value);
    if (!planned.valid) groundingReject('TGRD1009', '/plan', 'Grounding workflow lowering failed.', planned.issues[0]);
    return { profile, workflow, validated: validated.value, plan: planned.value, snapshot, catalog: config.value,
        clarification, mermaid: projectMasPlan(planned.value) };
}
