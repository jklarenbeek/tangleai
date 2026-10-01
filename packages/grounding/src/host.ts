/** Native MAS hosting of governed sessions; persistence and queue execution are injected. */
import { compileMasRuntime, BUILTIN_MESSAGE_ADAPTERS, MasInfrastructureCrash, MasBudgetStop,
    type MasAgentComponent, type MasAgentComponentInput, type MasHostBindings, type MasRuntime, type MasStore,
    type MasTaskInput, type MasToolBinding, type MasRuntimeObserver, type TraceView } from '@tangleai/mas';
import type { DocumentCorpusStore } from '@tangleai/documents/contracts';
import type { Embedder } from '@tangleai/models/embed';
import type { GroundingProfile, GroundingSession, GroundingExecution, GroundingIssue, GroundedAnswer, GroundingReply,
    EvidenceCandidate, EvidenceConflict, QueryPlan, ClarifiedIntent, LocalEvidenceAddress } from './contracts.gen.ts';
import type { GroundingStore } from './store.ts';
import type { WebTransport } from './web-transport.ts';
import type { CandidateRanker } from './ranker.ts';
import { createRrfRanker } from './ranker.ts';
import { selectGroundingContext } from './context.ts';
import { createLocalRetriever, type LocalRetrievalOptions, type LocalRetrievalOutcome } from './local.ts';
import { createWebLane, GROUNDING_WEB_TOOLS, type WebLaneOptions } from './web.ts';
import { createQueryOptimizer, type OptimizerClient, type OptimizerOutcome } from './optimizer.ts';
import { createGroundingWorkflow, type GroundingStageValue } from './workflow.ts';
import { GROUNDING_AGENT_STAGES } from './registry.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { evaluateProfileRules, loadGroundingProfile } from './profile.ts';
import { profileIntents } from './intent.ts';
import { reconcileEvidence, type ReconciliationFact } from './reconcile.ts';
import { interpretEvidenceConflicts } from './reconcile-model.ts';
import { createAnswerModel } from './answer-model.ts';
import { generateGroundedClaims } from './generate.ts';
import { createCitationResolver, validatePrihaClaims } from './validate.ts';
import { renderPrihaAnswer } from './render.ts';
import { groundingIdOf, groundingRevisionOf, immutableGroundingJson } from './identity.ts';
import { GroundingAbort, groundingIssue, groundingMust, groundingReject } from './errors.ts';
import { createGroundingReader } from './reader.ts';
import type { SessionCommand } from './session.ts';

export interface GroundingSegmentHost {
    store: MasStore;
    execute(runtime: MasRuntime, runId: string): Promise<void>;
    deadlineFor(afterMs: number): string;
}
export interface GroundingHostOptions {
    store: GroundingStore; corpus: DocumentCorpusStore; segments: GroundingSegmentHost;
    profile: GroundingProfile; embedder: Embedder; transport: WebTransport;
    clientFor(profile: string): OptimizerClient;
    now(): string; clock(): number; factVocabulary: readonly string[];
    ranker?: CandidateRanker; selection?: Partial<LocalRetrievalOptions>;
    observer?: MasRuntimeObserver;
    /** Host-owned facts and ordering are pinned experimental or domain policies. */
    policy?: { id: string; version: string; critical?: boolean;
        lanes?: { local: boolean; web: boolean };
        localRetrieval?: { lexical: boolean; expandParents: boolean };
        reconciliation?: 'governed' | 'disabled-experiment';
        local?: (session: GroundingSession, query: QueryPlan['queries'][number], selection: LocalRetrievalOptions) => Promise<LocalRetrievalOutcome>;
        facts?: (candidates: readonly EvidenceCandidate[]) => Promise<Record<string, ReconciliationFact>>;
        order?: (candidates: readonly EvidenceCandidate[]) => Promise<EvidenceCandidate[]> };
}
type Prepared = Awaited<ReturnType<typeof createGroundingWorkflow>>;
type QueryValue = { context: GroundingStageValue; index: number; queryId: string | null };
type LaneValue = { context: GroundingStageValue; queryId: string | null; evidenceIds: string[]; contextTokens: number; stopReason: string };
const must = <T>(result: { ok: true; value: T } | { ok: false; issue: unknown }): T => {
    if (!result.ok) groundingReject('TGRD1009', '/store', 'The native persistence operation failed.', result.issue); return result.value;
};
const fromOptimizer = (outcome: OptimizerOutcome): GroundingStageValue => {
    if (!outcome.ok) throw new GroundingAbort(outcome.issue);
    const value = outcome.value;
    return { sessionId: value.session.id, route: value.disposition === 'refuse' ? 'refuse' : value.disposition === 'needs-clarification' ? 'complex' : 'continue',
        intentId: value.intent?.id ?? value.session.intentId ?? null, planId: value.plan?.id ?? value.session.planId ?? null,
        answerId: null, evidenceIds: [], conflictIds: [] };
};
export async function createGroundingHost(options: GroundingHostOptions) {
    options = { ...options, transport: Object.freeze({ ...options.transport }), ...(options.policy ? { policy: Object.freeze({ ...options.policy, ...(options.policy.lanes ? { lanes: Object.freeze({ ...options.policy.lanes }) } : {}), ...(options.policy.localRetrieval ? { localRetrieval: Object.freeze({ ...options.policy.localRetrieval }) } : {}) }) } : {}),
        ...(options.selection ? { selection: Object.freeze({ ...options.selection }) } : {}) };
    const profile = groundingMust(await loadGroundingProfile(options.profile)), store = options.store, mas = options.segments.store;
    const vocabulary = immutableGroundingJson([...options.factVocabulary]), suppliedRanker = options.ranker ?? createRrfRanker();
    const ranker = Object.freeze({ ...suppliedRanker, rank: suppliedRanker.rank.bind(suppliedRanker) });
    const models: Record<string, OptimizerClient> = Object.fromEntries([...new Set(Object.values(profile.models))].map(name => [name, (() => { const model = options.clientFor(name); return { identity: immutableGroundingJson(model.identity), client: { ...model.client, complete: model.client.complete.bind(model.client) } }; })()]));
    const selection = { k: 6, minScore: 0, maxPerSource: 2, contextTokens: profile.budgets.contextTokens, ...options.selection };
    if (selection.contextTokens > profile.budgets.contextTokens) groundingReject('TGRD1007', '/selection', 'Context selection cannot widen the profile.');
    const configIdentityId = await groundingRevisionOf({ profileRevision: profile.revision,
        models: Object.fromEntries(Object.entries(models).map(([id, value]) => [id, value.identity])),
        transport: options.transport.revision, ranker: [ranker.id, ranker.version], vocabulary, selection,
        policy: options.policy ? [options.policy.id, options.policy.version, options.policy.critical ?? false, options.policy.lanes ?? null, options.policy.localRetrieval ?? null, options.policy.reconciliation ?? 'governed'] : null });
    must(await store.putProfile(profile));
    const prepared = new Map<string, Promise<Prepared>>();
    const activeTools = new Map<string, Parameters<NonNullable<WebLaneOptions['bindTools']>>[0]>();
    const executions = new Map<string, Promise<void>>();
    const replayed = new Map<string, number>();
    const reader = createGroundingReader({ store, mas, replayed: id => replayed.get(id) ?? 0 });
    const get = reader.get;
    const sessionFor = async (id: string) => {
        const session = await store.getSession(id);
        if (!session || session.profileId !== profile.id || session.profileRevision !== profile.revision)
            groundingReject('TGRD1004', '/sessionId', 'The session does not belong to the selected profile.');
        return session;
    };
    const transition = async (session: GroundingSession, command: Exclude<SessionCommand, { kind: 'start' }>) =>
        must(await store.transitionSession(session.id, command, session.revision));
    const optimizer = (client?: MasAgentComponentInput['client'], stage?: 'triage' | 'plan') => createQueryOptimizer({ profile, store,
        clients: { triage: { ...models[profile.models.triage]!, ...(stage === 'triage' && client ? { client } : {}) },
            plan: { ...models[profile.models.plan]!, ...(stage === 'plan' && client ? { client } : {}) } },
        clock: options.clock, factVocabulary: vocabulary });
    async function preparation(sessionId: string, cycle: number) {
        const key = sessionId + ':' + cycle;
        let value = prepared.get(key);
        if (!value) {
            value = createGroundingWorkflow({ profile, caseId: key, factVocabulary: vocabulary, currentOptimization: async () => {
                const current = await sessionFor(sessionId);
                if (current.execution?.cycle !== cycle || !current.optimization) groundingReject('TGRD1002', '/execution', 'This clarification belongs to an obsolete execution.');
                return current.optimization;
            } });
            prepared.set(key, value);
        }
        return value;
    }
    async function retainFailure(id: string, cause: unknown) {
        if (cause instanceof MasInfrastructureCrash) throw cause;
        const issue = cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/host', 'A grounding dependency failed.', cause);
        const session = await sessionFor(id);
        if (!['answered', 'refused', 'failed'].includes(session.status)) await transition(session, { kind: 'fail', reason: issue.detail, issue });
        return issue;
    }
    async function traceFor(id: string) {
        const trace = await store.readTrace(id);
        if (!trace) groundingReject('TGRD1009', '/trace', 'The grounding trace is unavailable.');
        return trace;
    }
    async function executionFor(session: GroundingSession) {
        const execution = session.execution;
        if (!execution || execution.configIdentityId !== configIdentityId) groundingReject('TGRD1002', '/execution', 'Resume requires the same models, profile, transport and policy.');
        return execution;
    }
    async function planFor(context: GroundingStageValue) {
        const trace = await traceFor(context.sessionId), plan = trace.plans.find(row => row.id === context.planId);
        if (!plan || trace.session.planId !== plan.id) groundingReject('TGRD1004', '/planId', 'The workflow must use its current retained plan.');
        return plan;
    }
    async function candidatesFor(context: GroundingStageValue) {
        const trace = await traceFor(context.sessionId);
        const byId = new Map(trace.evidence.map(row => [row.id, row]));
        return context.evidenceIds.map(id => { const value = byId.get(id); if (!value) groundingReject('TGRD1004', '/evidence', 'A workflow evidence address is missing.'); return value; });
    }
    async function conflictsFor(context: GroundingStageValue) {
        const trace = await traceFor(context.sessionId), byId = new Map(trace.conflicts.map(row => [row.id, row]));
        return context.conflictIds.map(id => { const value = byId.get(id); if (!value) groundingReject('TGRD1004', '/conflicts', 'A workflow conflict address is missing.'); return value; });
    }
    async function rawPlan(context: GroundingStageValue): Promise<GroundingStageValue> {
        let session = await sessionFor(context.sessionId);
        const execution = await executionFor(session);
        if (session.status === 'open') session = await transition(session, { kind: 'triage' });
        const payload = { sessionId: session.id, executionId: execution.runId, originalQuery: execution.originalQuery, triage: 'simple' as const,
            reason: 'Explicit raw-query control.', answered: {}, outstanding: [], constraints: [], priorities: [], summary: execution.originalQuery.slice(0, 4000),
            turnsUsed: 0, ruleIds: ['raw-query-control'], promptRevision: groundingArtifacts.revision, modelIdentity: null };
        const intent: ClarifiedIntent = { ...payload, id: await groundingIdOf('intent', payload) };
        const queries = [{ id: await groundingIdOf('query', { intentId: intent.id, text: execution.originalQuery }),
            text: execution.originalQuery, why: 'Unoptimized original query.', lanes: options.policy?.lanes ?? { local: true, web: true }, ruleIds: ['raw-query-control'] }];
        const planPayload = { intentId: intent.id, queries, profileRevision: profile.revision,
            promptRevision: groundingArtifacts.revision, modelIdentity: null };
        const plan: QueryPlan = { ...planPayload, id: await groundingIdOf('plan', planPayload) };
        must(await store.putIntent(intent)); must(await store.putPlan(plan));
        if (session.status === 'triaging') session = await transition(session, { kind: 'plan', intentId: intent.id, planId: plan.id });
        return { ...context, intentId: intent.id, planId: plan.id };
    }
    async function bind(p: Prepared, sessionId: string, runId: string): Promise<MasHostBindings> {
        const guarded = <T>(work: () => Promise<T>) => work().catch(async cause => { await retainFailure(sessionId, cause); throw cause; });
        const toolBindings: Record<string, MasToolBinding> = Object.fromEntries(GROUNDING_WEB_TOOLS.map(tool => [tool.name, {
            handler: async (input, context) => {
                const local = context.invocation ? activeTools.get(context.invocation.path) : undefined;
                if (!local || context.invocation?.runId !== runId) groundingReject('TGRD1004', '/tools', 'The web tool has no owning query invocation.');
                context.signal.throwIfAborted(); return local.execute(tool.name, input);
            },
        } satisfies MasToolBinding]));
        const tasks: MasHostBindings['taskHandlers'] = { ...p.clarification?.bindings.taskHandlers };
        const add = (name: string, handler: (input: MasTaskInput) => Promise<unknown>) => { tasks['grounding-' + name] = input => guarded(() => handler(input)); };
        const contextOf = (input: MasTaskInput) => input.value.context as unknown as GroundingStageValue;
        add('rules', async input => {
            const context = contextOf(input), session = await sessionFor(sessionId), execution = await executionFor(session);
            const rules = evaluateProfileRules(profile, { text: execution.originalQuery });
            if (rules.emergency || rules.outOfScope) return { context: fromOptimizer(await optimizer().triage(session, execution.originalQuery)) };
            return { context };
        });
        for (const name of ['ready', 'refuse']) add(name, async input => ({ context: contextOf(input) }));
        add('clarify-input', async () => {
            const session = await sessionFor(sessionId), execution = await executionFor(session);
            return { input: { caseId: sessionId + ':' + execution.cycle, query: execution.originalQuery, evidence: [] } };
        });
        add('clarify-project', async input => {
            const context = contextOf(input);
            const result = profile.clarification.maxTurns ? await optimizer().completeClarification({ id: sessionId }, { store: mas, runId }) : await optimizer().clarify({ id: sessionId });
            return { context: { ...context, ...fromOptimizer(result) } };
        });
        add('expand', async input => {
            const context = contextOf(input);
            if (context.route !== 'refuse') {
                const session = await sessionFor(sessionId);
                if (session.status === 'planning') await transition(session, { kind: 'retrieve' });
            }
            return { context };
        });
        add('query', async input => {
            const context = contextOf(input), index = Number(input.node.slice('query-'.length)) - 1;
            const plan = context.route === 'refuse' ? undefined : await planFor(context);
            return { query: { context, index, queryId: plan?.queries[index]?.id ?? null } };
        });
        add('local', async input => {
            const value = input.value.query as unknown as QueryValue, { context, queryId } = value;
            const empty: LaneValue = { context, queryId, evidenceIds: [], contextTokens: 0, stopReason: 'disabled' };
            if (!queryId || context.route === 'refuse') return { lane: empty };
            const plan = await planFor(context), query = plan.queries.find(row => row.id === queryId)!;
            if (!query.lanes.local) return { lane: empty };
            const native = await mas.readTrace(runId);
            const used = (native?.attempts ?? []).filter(row => row.status === 'completed' && row.invocationId.startsWith('local-'))
                .reduce((sum, row) => sum + ((row.output as { lane?: LaneValue })?.lane?.contextTokens ?? 0), 0);
            const local = createLocalRetriever({ store: options.corpus, manifests: store, session: await sessionFor(sessionId), embedder: options.embedder,
                ranker, lanes: { semantic: true, lexical: options.policy?.localRetrieval?.lexical ?? true }, expandParents: options.policy?.localRetrieval?.expandParents ?? true,
                budgets: { contextTokens: profile.budgets.contextTokens }, now: options.now, clock: options.clock });
            const bounded = { ...selection, contextTokens: Math.max(0, Math.min(selection.contextTokens, profile.budgets.contextTokens - used)) };
            const result = options.policy?.local ? await options.policy.local(await sessionFor(sessionId), query, bounded) : await local.retrieve(query, bounded);
            if (!result.ok) throw new GroundingAbort(result.issue);
            if (!Number.isSafeInteger(result.census.contextTokens) || result.census.contextTokens < 0 || result.census.contextTokens > bounded.contextTokens)
                groundingReject('TGRD1007', '/local', 'The registered retriever exceeded its context ceiling.');
            must(await store.putEvidence(result.candidates));
            return { lane: { ...empty, evidenceIds: result.candidates.map(row => row.id), contextTokens: result.census.contextTokens, stopReason: result.reason } };
        });
        add('join', async input => {
            const lanes = Object.values(input.value) as unknown as LaneValue[], context = lanes[0]!.context;
            const ids = [...new Set(lanes.flatMap(row => row.evidenceIds))];
            return { context: { ...context, evidenceIds: ids } };
        });
        add('reconcile', async input => {
            const context = contextOf(input);
            if (context.route === 'refuse') return { context };
            const session = await sessionFor(sessionId), candidates = await candidatesFor(context), plan = await planFor(context);
            if (session.status === 'retrieving') await transition(session, { kind: 'reconcile' });
            const facts: Record<string, ReconciliationFact> = {};
            for (const candidate of candidates) {
                if (candidate.lane === 'local') {
                    const address = candidate.address as LocalEvidenceAddress;
                    const manifest = await store.getManifest(address.sourceId, address.versionId);
                    const version = await options.corpus.getVersion(address.versionId);
                    facts[candidate.id] = { ...(manifest ? { jurisdiction: manifest.jurisdiction } : {}), ...(version ? { versionStatus: version.status } : {}) };
                }
            }
            const custom = await options.policy?.facts?.(candidates);
            if (custom) for (const row of candidates) facts[row.id] = { ...facts[row.id], ...custom[row.id] };
            const result = await reconcileEvidence(profile, candidates, { sessionId, now: options.now(), facts, rules: options.policy?.reconciliation ?? 'governed',
                criticalQueries: options.policy?.critical ? plan.queries.map(row => row.id) : [] });
            const ordered = options.policy?.order ? await options.policy.order(result.admitted) : result.admitted;
            const ids = new Map(result.admitted.map(row => [row.id, JSON.stringify(row)]));
            if (new Set(ordered.map(row => row.id)).size !== ordered.length || ordered.some(row => ids.get(row.id) !== JSON.stringify(row)))
                groundingReject('TGRD1005', '/order', 'Ordering cannot invent or relabel admitted facts.');
            const selected = selectGroundingContext(ordered, selection.contextTokens);
            must(await store.putConflict(result.conflicts));
            return { context: { ...context, evidenceIds: selected.candidates.map(row => row.id), conflictIds: result.conflicts.map(row => row.id) } };
        });
        add('validate', async input => {
            const context = contextOf(input);
            if (context.route === 'refuse' && !context.answerId) return { context };
            const trace = await traceFor(sessionId), answer = trace.answers.find(row => row.id === context.answerId);
            if (!answer) groundingReject('TGRD1008', '/answer', 'The retained claim ledger is missing.');
            const candidates = trace.evidence.filter(row => context.evidenceIds.includes(row.id));
            const resolver = await createCitationResolver(candidates, options.corpus);
            const draft = { disposition: answer.disposition, claims: answer.claims.map(row => ({ id: row.id, text: row.text, critical: row.critical, citations: row.evidenceIds, caveats: row.caveats })), ...(answer.reason ? { reason: answer.reason } : {}) };
            const checked = validatePrihaClaims(draft as never, resolver.view);
            if (!checked.valid) groundingReject('TGRD1008', '/claims', 'The retained ledger failed the native claim gate.', checked.errors[0]);
            renderPrihaAnswer(answer, { profile }); return { context };
        });
        add('answer', async input => ({ context: contextOf(input) }));
        const components = new Map<string, MasAgentComponent>();
        for (const stage of GROUNDING_AGENT_STAGES) {
            const id = 'grounding-' + stage, revision = p.snapshot.document.agentExecutors!.find(row => row.id === id)!.version;
            components.set(id, { id, version: revision, execute: input => guarded(async () => {
                const context = (stage === 'web-agent' ? (input.input.value.query as unknown as QueryValue).context : input.input.value.context) as GroundingStageValue;
                const session = await sessionFor(sessionId), execution = await executionFor(session);
                const client: typeof input.client = { ...input.client, async complete(request) {
                    try { return await input.client.complete(request); }
                    catch (cause) {
                        if (cause instanceof MasBudgetStop || cause instanceof GroundingAbort) throw cause;
                        throw new GroundingAbort(groundingIssue('TGRD1009', '/model', 'The configured grounding model failed.', cause));
                    }
                } };
                if (stage === 'web-agent') {
                    const value = input.input.value.query as unknown as QueryValue;
                    const lane: LaneValue = { context, queryId: value.queryId, evidenceIds: [], contextTokens: 0, stopReason: 'disabled' };
                    if (!value.queryId || context.route === 'refuse') return { lane };
                    const query = (await planFor(context)).queries.find(row => row.id === value.queryId)!;
                    if (!query.lanes.web) return { lane };
                    try {
                        const web = createWebLane({ profile, store, transport: options.transport, client,
                            modelIdentity: models[profile.models.plan]!.identity, clock: options.clock, now: options.now, signal: input.signal,
                            bindTools: tools => { activeTools.set(input.path, tools); return input.toolbox as never; } });
                        const result = await web.retrieve(session, value.queryId);
                        if (!result.ok) throw new GroundingAbort(result.issue);
                        if (result.run.issue) throw new GroundingAbort(result.run.issue);
                        return { lane: { ...lane, evidenceIds: result.candidates.map(row => row.id), stopReason: result.run.stopReason } };
                    } finally { activeTools.delete(input.path); }
                }
                if (context.route === 'refuse') return { context };
                if (stage === 'triage') return { context: execution.mode === 'raw' ? context : fromOptimizer(await optimizer(client, 'triage').triage(session, execution.originalQuery)) };
                if (stage === 'plan') return { context: execution.mode === 'raw' ? await rawPlan(context) : fromOptimizer(await optimizer(client, 'plan').plan(session)) };
                const admitted = await candidatesFor(context), conflicts = await conflictsFor(context);
                if (stage === 'reconcile') {
                    const model = await createAnswerModel({ profile, client, modelIdentity: models[profile.models.reconcile]!.identity, clock: options.clock });
                    const result = await interpretEvidenceConflicts({ model, query: execution.originalQuery, admitted, conflicts, store });
                    return { context: { ...context, conflictIds: result.conflicts.map(row => row.id) } };
                }
                let current = await sessionFor(sessionId);
                if (current.status === 'reconciling') current = await transition(current, { kind: 'answer' });
                const result = await generateGroundedClaims({ profile, client, modelIdentity: models[profile.models.generate]!.identity,
                    query: execution.originalQuery, plan: await planFor(context), sessionId, store, corpus: options.corpus, admitted, conflicts,
                    expectedRevision: current.revision, clock: options.clock, critical: options.policy?.critical ?? false, factVocabulary: vocabulary, interpretConflicts: false, failOnDependencyError: true });
                if (!result.ok) throw new GroundingAbort(result.issue);
                return { context: { ...context, answerId: result.answer.id } };
            }) });
        }
        const declaredAdapters = new Set(p.snapshot.document.messageAdapters.map(row => row.id));
        const messageAdapters = new Map([...(p.clarification?.bindings.messageAdapters ?? BUILTIN_MESSAGE_ADAPTERS)].filter(([id]) => declaredAdapters.has(id)));
        for (const stage of GROUNDING_AGENT_STAGES) {
            const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-' + stage)!;
            messageAdapters.set(artifact.id, { id: artifact.id, version: artifact.revision, render: input => JSON.stringify(input.value) });
        }
        return { store: mas, taskHandlers: tasks, toolBindings, contextProviders: {}, agentComponents: components, messageAdapters,
            clientFor: node => models[node.profile]!.client, now: options.now, clock: options.clock, deadlineFor: options.segments.deadlineFor,
            observer: { ...options.observer, onNodeReplay(path) { replayed.set(runId, (replayed.get(runId) ?? 0) + 1); options.observer?.onNodeReplay?.(path); },
                onNodeRestored(path) { replayed.set(runId, (replayed.get(runId) ?? 0) + 1); options.observer?.onNodeRestored?.(path); },
                onRegionRestored(paths) { replayed.set(runId, (replayed.get(runId) ?? 0) + paths.length); options.observer?.onRegionRestored?.(paths); } } };
    }
    async function synchronize(sessionId: string, trace: TraceView) {
        let session = await sessionFor(sessionId);
        const responded = trace.interactions.filter(row => row.status === 'responded').length;
        if (session.status === 'awaiting_clarification' && responded > session.turn) session = await transition(session, { kind: 'answerClarification', fields: {} });
        if (trace.run.status === 'waiting_for_input' && trace.interactions.some(row => row.status === 'waiting') && session.status === 'triaging')
            await transition(session, { kind: 'askClarification' });
        if (trace.run.status === 'failed') await retainFailure(sessionId, new GroundingAbort(groundingIssue('TGRD1009', '/workflow', 'The native grounding workflow failed.', trace.run.failure?.error)));
    }
    async function execute(sessionId: string) {
        const session = await sessionFor(sessionId);
        if (session.status === 'failed') return;
        const execution = await executionFor(session), p = await preparation(sessionId, execution.cycle);
        if (p.workflow.versionId !== execution.workflowVersionId) groundingReject('TGRD1002', '/workflow', 'The resumed workflow bytes changed.');
        must(await mas.putWorkflowVersion(p.workflow));
        must(await mas.putRegistrySnapshot(p.snapshot.document as unknown as Record<string, unknown>, p.snapshot.revision));
        if (!await mas.getRun(execution.runId)) must(await mas.createRun({ runId: execution.runId, workflowId: p.workflow.workflowId,
            workflowVersionId: p.workflow.versionId, registryRevision: p.snapshot.revision, executableRevision: p.plan.executableRevision,
            configRegistryRevision: p.catalog.revision, profile: p.workflow.config.profile,
            input: { context: { sessionId, route: 'continue', intentId: null, planId: null, answerId: null, evidenceIds: [], conflictIds: [] } }, limits: { ...p.workflow.limits } }));
        const runtime = compileMasRuntime(p.validated, p.plan, p.snapshot, await bind(p, sessionId, execution.runId));
        if (!runtime.valid) groundingReject('TGRD1009', '/runtime', 'The native grounding runtime did not bind.', runtime.issues[0]);
        const before = await mas.readTrace(execution.runId); if (before) await synchronize(sessionId, before);
        await options.segments.execute(runtime.value, execution.runId);
        const trace = await mas.readTrace(execution.runId);
        if (!trace) groundingReject('TGRD1009', '/run', 'The native run disappeared.');
        await synchronize(sessionId, trace);
    }
    async function enqueue(sessionId: string) {
        let pending = executions.get(sessionId);
        if (!pending) {
            pending = execute(sessionId); executions.set(sessionId, pending);
            try { await pending; } finally { executions.delete(sessionId); }
        } else await pending;
        return get(sessionId);
    }
    async function start(input: { text: string; conversationId: string; mode?: 'optimized' | 'raw'; defer?: boolean; failure?: GroundingIssue }) {
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000) groundingReject('TGRD1001', '/text', 'Supply a bounded nonblank question.');
        let session = must(await store.createSession({ conversationId: input.conversationId, profileId: profile.id, profileRevision: profile.revision }));
        if (session.execution) {
            if (session.execution.originalQuery !== input.text || session.execution.mode !== (input.mode ?? 'optimized')) groundingReject('TGRD1002', '/conversationId', 'The conversation id already belongs to another grounding request.');
        } else {
            const p = await preparation(session.id, 0);
            const payload = { sessionId: session.id, cycle: 0, workflowVersionId: p.workflow.versionId, configIdentityId, originalQuery: input.text, mode: input.mode ?? 'optimized' as const };
            const execution: GroundingExecution = { ...payload, runId: await groundingIdOf('grounding-run', payload), previousRunId: null, at: options.now(), reason: null };
            const { sessionId: _id, ...retained } = execution as GroundingExecution & { sessionId?: string };
            session = await transition(session, { kind: 'attachExecution', execution: retained });
        }
        if (input.failure) await retainFailure(session.id, new GroundingAbort(input.failure));
        return input.defer || input.failure ? get(session.id) : enqueue(session.id);
    }
    async function respond(sessionId: string, interactionId: string, response: unknown) {
        const session = await sessionFor(sessionId), execution = await executionFor(session), interaction = await mas.getInteraction(interactionId);
        if (!interaction || interaction.runId !== execution.runId) groundingReject('TGRD1004', '/interactionId', 'The interaction belongs to another execution.');
        const key = await groundingIdOf('grounding-response', { interactionId, response });
        must(await mas.respondInteraction(interactionId, response, interaction.status === 'responded' ? interaction.revision - 1 : interaction.revision, key));
        return enqueue(sessionId);
    }
    async function refresh(sessionId: string, reason: string) {
        const session = await sessionFor(sessionId), prior = session.execution;
        if (!prior) groundingReject('TGRD1004', '/execution', 'Refresh requires a retained execution.');
        const cycle = prior.cycle + 1, p = await preparation(sessionId, cycle);
        const payload = { sessionId, cycle, previousRunId: prior.runId, reason, workflowVersionId: p.workflow.versionId, configIdentityId, mode: prior.mode, originalQuery: prior.originalQuery };
        const { sessionId: _id, ...next } = payload;
        await transition(session, { kind: 'refresh', reason, execution: { ...next, runId: await groundingIdOf('grounding-run', payload), at: options.now() } });
        return enqueue(sessionId);
    }
    return Object.freeze({ start, enqueue, respond, refresh, ...reader, prepare: preparation, bind });
}
export type GroundingHost = Awaited<ReturnType<typeof createGroundingHost>>;
