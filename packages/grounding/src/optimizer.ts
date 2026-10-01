/** Rules-first intent policy; GMPL/MAS own durable clarification and the structured-output owner repairs proposals. */
import { equalsJson } from '@jarenjs/core/object';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { createStructuredOutput } from '@tangleai/models/structured';
import { compileMasRuntime, createSharedBudgetClient, MasBudgetStop, planInteractionTransition,
    type MasChatClient, type MasRuntime, type MasStore, type MasRuntimeObserver } from '@tangleai/mas';
import { renderGmplPrompt } from '@tangleai/gmpl';
import type { GroundingProfile, GroundingSession, GroundingIssue, ClarifiedIntent, QueryPlan,
    TriageDecision, QueryDraft, OptimizerCheckpoint } from './contracts.gen.ts';
import type { GroundingStore } from './store.ts';
import { GroundingAbort, groundingIssue, groundingMust, groundingReject } from './errors.ts';
import { groundingIdOf, groundingRevisionOf, immutableGroundingJson } from './identity.ts';
import { loadGroundingProfile, evaluateProfileRules } from './profile.ts';
import { validateGroundingShape } from './schema.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { prepareGroundingClarification, clarificationState } from './clarification.ts';
import { expandGroundingPlan, inventedGroundingFacts, profileIntents, projectClarifiedIntent, triageDecisionErrors } from './intent.ts';

export interface OptimizerClient { client: MasChatClient; identity: ClarifiedIntent['modelIdentity']; }
export interface GroundingClarificationHost {
    store: MasStore;
    /** Executes one queued MAS segment using the host's existing durable worker. */
    execute(runtime: MasRuntime, runId: string): Promise<void>;
    now: () => string;
    deadlineFor: (afterMs: number) => string;
    observer?: MasRuntimeObserver;
}
export interface QueryOptimizerOptions {
    profile: GroundingProfile; clients: { triage: OptimizerClient; plan: OptimizerClient };
    budget?: Partial<{ calls: number; tokens: number; ms: number }>;
    store: GroundingStore; clock: () => number; clarification?: GroundingClarificationHost;
    /** Registered host data; only these phrases are covered by the invented-fact gate. */
    factVocabulary: readonly string[];
}
export interface OptimizerResponse {
    interactionId: string; expectedRevision: number; responseKey: string; value: { answers: { q1: string } };
}
export interface OptimizerValue {
    disposition: 'ready' | 'needs-clarification' | 'clarification' | 'planned' | 'refuse';
    session: GroundingSession; ruleIds: string[]; sourceKeys: string[]; spend: OptimizerCheckpoint['spent'];
    intent?: ClarifiedIntent; plan?: QueryPlan; interactionId?: string; interactionRevision?: number; question?: string; reason?: string;
}
export type OptimizerOutcome = { ok: true; value: OptimizerValue } | { ok: false; issue: GroundingIssue; session?: GroundingSession; stopReason?: string };
type Account = ReturnType<typeof createBudgetAccount>;
const storeValue = <T>(outcome: { ok: true; value: T } | { ok: false; issue: GroundingIssue }): T => {
    if (!outcome.ok) throw new GroundingAbort(outcome.issue); return outcome.value;
};
export function createQueryOptimizer(options: QueryOptimizerOptions) {
    const { store } = options;
    // Copy caller-owned policy data before its revision is pinned. A retained
    // optimizer must enforce the same terms even if the host reuses its array.
    const factVocabulary = Array.isArray(options.factVocabulary) ? Object.freeze([...options.factVocabulary]) : options.factVocabulary;
    const ready = (async () => {
        const profile = groundingMust(await loadGroundingProfile(options.profile));
        if (!Array.isArray(factVocabulary) || factVocabulary.some(term => typeof term !== 'string' || !term.trim()))
            groundingReject('TGRD1001', '/factVocabulary', 'Supply a closed nonblank user-fact vocabulary.');
        const budget = { calls: profile.budgets.calls, tokens: profile.budgets.tokens, ms: profile.budgets.ms, ...options.budget };
        for (const key of ['calls', 'tokens', 'ms'] as const)
            if (!Number.isSafeInteger(budget[key]) || budget[key] < 0 || budget[key] > profile.budgets[key])
                groundingReject('TGRD1007', '/budget/' + key, 'The optimizer cannot widen the profile budget.');
        return { profile, budget, vocabularyRevision: await groundingRevisionOf(factVocabulary) };
    })();
    const accountFor = (checkpoint: OptimizerCheckpoint) => createBudgetAccount({ turns: checkpoint.budget.calls,
        tokens: checkpoint.budget.tokens, ms: checkpoint.budget.ms,
        spent: { turns: checkpoint.spent.calls, tokens: checkpoint.spent.tokens, ms: checkpoint.spent.ms } }, options.clock);
    const spent = (account: Account) => { const value = account.spent(); return { calls: value.turns, tokens: value.tokens, ms: Math.ceil(value.ms) }; };
    async function sessionFor(input: Pick<GroundingSession, 'id'>) {
        const { profile, vocabularyRevision, budget } = await ready;
        const session = await store.getSession(input.id);
        if (!session || session.profileId !== profile.id || session.profileRevision !== profile.revision)
            groundingReject('TGRD1004', '/session', 'The session does not belong to this profile revision.');
        const checkpoint = session.optimization;
        if (checkpoint && (checkpoint.catalogRevision !== groundingArtifacts.revision || checkpoint.vocabularyRevision !== vocabularyRevision
            || !equalsJson(checkpoint.models, { triage: options.clients.triage.identity, plan: options.clients.plan.identity }) || !equalsJson(checkpoint.budget, budget)))
            groundingReject('TGRD1002', '/optimization', 'The resumed optimizer must preserve its artifacts, models, vocabulary and budget.');
        return session;
    }
    const checkpoint = async (session: GroundingSession, value: OptimizerCheckpoint) => storeValue(await store.transitionSession(session.id,
        { kind: 'recordOptimization', optimization: value }, session.revision));
    const transition = async (session: GroundingSession, command: Parameters<GroundingStore['transitionSession']>[1]) =>
        storeValue(await store.transitionSession(session.id, command, session.revision));
    const value = (session: GroundingSession, disposition: OptimizerValue['disposition'], extra: Partial<OptimizerValue> = {}): OptimizerOutcome => ({ ok: true,
        value: { disposition, session, ruleIds: session.optimization?.ruleIds ?? [], sourceKeys: session.optimization?.sourceKeys ?? [],
            spend: session.optimization?.spent ?? { calls: 0, tokens: 0, ms: 0 }, ...extra } });
    async function guarded(input: Pick<GroundingSession, 'id'>, work: (session: GroundingSession) => Promise<OptimizerOutcome>): Promise<OptimizerOutcome> {
        try { return await work(await sessionFor(input)); }
        catch (cause) { return { ok: false, issue: cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/optimizer', 'Optimizer host failed.', cause) }; }
    }
    async function fail(session: GroundingSession, phase: string, cause: unknown, account?: Account): Promise<OptimizerOutcome> {
        const reason = cause instanceof MasBudgetStop ? cause.reason : cause instanceof GroundingAbort && cause.issue.code === 'TGRD1007' ? cause.issue.detail : phase + '-unavailable';
        const issue = cause instanceof GroundingAbort ? cause.issue : groundingIssue(cause instanceof MasBudgetStop ? 'TGRD1007' : 'TGRD1001', '/' + phase, reason, cause);
        const next = { ...session.optimization!, stage: 'failed' as const, stopReason: reason, issue,
            ...(account ? { spent: spent(account) } : {}) }; delete next.inFlight;
        session = await checkpoint(session, next); session = await transition(session, { kind: 'fail', reason });
        return { ok: false, issue, session, stopReason: reason };
    }
    /** Exactly one structured-output repair loop owns both direct proposal stages. */
    async function generate<T>(stage: 'triage' | 'plan', query: string, context: Record<string, unknown>, account: Account,
        gate: (value: T) => Array<{ code: string; docPath: string; message: string }>): Promise<T> {
        const artifact = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + stage)!;
        const rendered = renderGmplPrompt(artifact, { query, evidence: [], context });
        if (!rendered.valid) groundingReject('TGRD1001', '/prompt', 'Prompt rendering failed.', rendered.issues[0]);
        const observed = createSharedBudgetClient(options.clients[stage].client, account);
        const generator = createStructuredOutput({ client: { ...observed, endpoint: observed.endpoint ?? { provider: 'scripted' } },
            schema: artifact.outputSchema, name: 'grounding_' + stage, maxRepairs: 1,
            gate: proposal => { const errors = gate(proposal as T); return { valid: !errors.length, errors }; } });
        const output = await generator.generate([{ role: 'system', content: rendered.value.system }, { role: 'user', content: rendered.value.user }]);
        if (output.errors) groundingReject('TGRD1001', '/' + stage, stage + '-unavailable', { code: 'structured-output',
            docPath: output.errors[0]?.docPath ?? output.errors[0]?.instancePath ?? '', message: JSON.stringify({ errors: output.errors, raw: output.raw, attempts: output.attempts }) });
        const charged = spent(account);
        if (charged.tokens > (await ready).budget.tokens) throw new MasBudgetStop('budget-tokens');
        if (charged.ms > (await ready).budget.ms) throw new MasBudgetStop('budget-ms');
        return output.value as T;
    }
    async function projected(session: GroundingSession, history: Parameters<typeof projectClarifiedIntent>[0]['history'], outstanding: string[], summary: string) {
        const { profile } = await ready, cp = session.optimization!;
        const ruleIds = outstanding.length ? [...new Set([...cp.ruleIds, 'clarification-cap'])] : cp.ruleIds;
        const intent = await projectClarifiedIntent({ profile, sessionId: session.id, originalQuery: cp.originalQuery, triage: cp.decision!, history,
            outstanding, refinedQuery: summary, promptRevision: cp.catalogRevision, modelIdentity: cp.models.triage, ruleIds });
        storeValue(await store.putIntent(intent));
        const exhausted = intent.outstanding.length > 0;
        session = await checkpoint(session, { ...cp, stage: exhausted ? 'refused' : 'ready', intentId: intent.id,
            ...(exhausted ? { stopReason: 'insufficient_detail', ruleIds } : {}) });
        if (exhausted) session = await transition(session, { kind: 'refuse' });
        return value(session, exhausted ? 'refuse' : 'ready', { intent, ...(exhausted ? { reason: 'insufficient_detail' } : {}) });
    }
    async function triage(input: Pick<GroundingSession, 'id'>, turn: string): Promise<OptimizerOutcome> {
        return guarded(input, async session => {
            const { profile, budget, vocabularyRevision } = await ready;
            if (typeof turn !== 'string' || !turn.trim() || turn.length > 16000) groundingReject('TGRD1001', '/turn', 'Supply a bounded nonblank turn.');
            if (session.optimization) {
                if (session.optimization.originalQuery !== turn) groundingReject('TGRD1002', '/turn', 'A session optimization is pinned to one turn.');
                return current(session);
            }
            if (session.status === 'open') session = await transition(session, { kind: 'triage' });
            else if (session.status !== 'triaging') groundingReject('TGRD1003', '/status', 'Triage starts from an open or explicitly refreshed session.');
            const rules = evaluateProfileRules(profile, { text: turn }), rule = rules.emergency ?? rules.outOfScope;
            const route = rules.emergency ? 'emergency' as const : rules.outOfScope ? 'out_of_scope' as const : 'simple' as const;
            session = await checkpoint(session, { startRevision: session.revision, originalQuery: turn, route, decision: null, stage: rule ? 'refused' : 'triaged',
                ruleIds: rule ? [rule] : [], sourceKeys: rules.emergency ? profile.emergency.response.sourceKeys : [],
                catalogRevision: groundingArtifacts.revision, vocabularyRevision, budget, spent: { calls: 0, tokens: 0, ms: 0 },
                models: { triage: options.clients.triage.identity, plan: options.clients.plan.identity }, ...(rule ? { stopReason: route } : { inFlight: 'triage' }) });
            if (rule) { session = await transition(session, { kind: 'refuse' }); return value(session, 'refuse', { reason: route }); }
            const account = accountFor(session.optimization!);
            try {
                const decision = await generate<TriageDecision>('triage', turn, { intents: profileIntents(profile), fields: profile.clarification.requiredFields,
                    supplied: session.userContext }, account, decision => triageDecisionErrors(profile, decision));
                const expansions = evaluateProfileRules(profile, { text: turn, intents: decision.intents }).expansions;
                const ruleIds = [...decision.requiredFields.map(id => 'clarify-' + id), ...expansions.map(rule => rule.ruleId)];
                const next = { ...session.optimization!, decision, route: decision.triage, spent: spent(account), ruleIds: ruleIds.length ? ruleIds : ['in-scope'] };
                delete next.inFlight; session = await checkpoint(session, next);
                return decision.triage === 'simple' ? projected(session, [], [], turn.length <= 4000 ? turn : '') : value(session, 'needs-clarification');
            } catch (cause) { return fail(session, 'triage', cause, account); }
        });
    }
    async function current(session: GroundingSession): Promise<OptimizerOutcome> {
        const cp = session.optimization;
        if (!cp) groundingReject('TGRD1003', '/optimization', 'Triage has not run.');
        if (cp.stage === 'failed') return { ok: false, issue: cp.issue!, session, stopReason: cp.stopReason };
        if (cp.inFlight) groundingReject('TGRD1003', '/optimization/inFlight', 'An unfinished optimizer operation requires inspection before retry.');
        const trace = await store.readTrace(session.id), intent = trace?.intents.find(intent => intent.id === cp.intentId);
        if (cp.stage === 'refused') return value(session, 'refuse', { intent, reason: cp.stopReason });
        if (cp.stage === 'planned') return value(session, 'planned', { intent, plan: trace?.plans.find(plan => plan.id === cp.planId) });
        if (cp.stage === 'ready') return value(session, 'ready', { intent });
        if (cp.runId && options.clarification) {
            const trace = await options.clarification.store.readTrace(cp.runId), interaction = trace?.interactions.find(row => row.status === 'waiting');
            if (interaction) {
                const prompt = interaction.prompt as { questions: Array<{ text: string }> };
                return value(session, 'clarification', { interactionId: interaction.id, interactionRevision: interaction.revision, question: prompt.questions[0]!.text });
            }
        }
        return value(session, 'needs-clarification');
    }
    async function clarify(input: Pick<GroundingSession, 'id'>): Promise<OptimizerOutcome> {
        return guarded(input, async session => {
            const { profile } = await ready;
            let cp = session.optimization;
            if (!cp || cp.route !== 'complex') groundingReject('TGRD1003', '/optimization', 'Only a complex triaged turn clarifies.');
            if (['ready', 'planned', 'refused', 'failed'].includes(cp.stage)) return current(session);
            if (profile.clarification.maxTurns === 0) return projected(session, [], cp.decision!.requiredFields, cp.originalQuery.slice(0, 4000));
            const host = options.clarification;
            if (!host) groundingReject('TGRD1009', '/clarification', 'Durable clarification requires a MAS store and segment host.');
            const retained = cp.runId ? await host.store.readTrace(cp.runId) : undefined;
            if (cp.inFlight) {
                if (cp.inFlight !== 'clarify' || !retained || !['waiting_for_input', 'completed', 'failed'].includes(retained.run.status))
                    groundingReject('TGRD1003', '/optimization/inFlight', 'An unfinished operation cannot be repeated automatically.');
                const previous = retained.run.budget.spent;
                const recovered = { ...cp, spent: { calls: Math.max(cp.spent.calls, previous.turns), tokens: Math.max(cp.spent.tokens, previous.tokens), ms: Math.max(cp.spent.ms, Math.ceil(previous.ms)) } };
                delete recovered.inFlight; session = await checkpoint(session, recovered); cp = session.optimization!;
            }
            if (session.status === 'awaiting_clarification') {
                if (retained?.interactions.some(row => row.status === 'waiting')) return current(session);
                if (!retained || retained.interactions.filter(row => row.status === 'responded').length !== session.turn + 1)
                    groundingReject('TGRD1003', '/interaction', 'A waiting session requires one committed host response before resuming.');
                // Recover the response/outbox commit if the process ended before
                // the grounding turn transition; accepted input is never replayed.
                session = await transition(session, { kind: 'answerClarification', fields: {} }); cp = session.optimization!;
            }
            const caseId = session.id + ':' + cp.startRevision;
            const prepared = await prepareGroundingClarification(profile, cp, factVocabulary, caseId), workflow = prepared.validated.workflow;
            const runId = cp.runId ?? await groundingIdOf('clarification', { sessionId: session.id, startRevision: cp.startRevision, workflow: workflow.versionId, originalQuery: cp.originalQuery });
            session = await checkpoint(session, { ...cp, runId, inFlight: 'clarify', stage: 'clarifying' });
            const account = accountFor(session.optimization!);
            try {
                const accept = <T>(outcome: { ok: true; value: T } | { ok: false; issue: unknown }): T => {
                    if (!outcome.ok) groundingReject('TGRD1003', '/clarification', 'MAS persistence refused.', outcome.issue); return outcome.value;
                };
                accept(await host.store.putWorkflowVersion(workflow));
                accept(await host.store.putRegistrySnapshot(prepared.snapshot.document as unknown as Record<string, unknown>, prepared.snapshot.revision));
                if (!await host.store.getRun(runId)) accept(await host.store.createRun({ runId, workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
                    registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
                    configRegistryRevision: prepared.catalog.revision, profile: workflow.config.profile,
                    input: { input: { caseId, query: cp.originalQuery, evidence: [] } }, limits: { ...workflow.limits } }));
                const compiled = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, { ...prepared.bindings, store: host.store,
                    toolBindings: {}, contextProviders: {}, clientFor: () => options.clients.triage.client, budgetAccount: account,
                    now: host.now, clock: options.clock, deadlineFor: host.deadlineFor, observer: host.observer });
                if (!compiled.valid) groundingReject('TGRD1009', '/clarification', 'MAS compilation refused.', compiled.issues[0]);
                await host.execute(compiled.value, runId);
                const trace = await host.store.readTrace(runId);
                if (!trace) groundingReject('TGRD1009', '/clarification', 'The executed MAS trace is missing.');
                const next = { ...session.optimization!, spent: spent(account) }; delete next.inFlight;
                session = await checkpoint(session, next);
                if (trace.run.status === 'failed') {
                    const reason = [...trace.attempts].reverse().map(attempt => attempt.stopReason).find(reason => reason?.startsWith('budget-'));
                    if (trace.run.failure?.error.code === 'TMAS2009') throw new MasBudgetStop(reason ?? account.stop() ?? 'budget-ms');
                    groundingReject('TGRD1001', '/clarification', 'clarification-unavailable', trace.run.failure?.error);
                }
                if (trace.run.status === 'waiting_for_input') {
                    session = await transition(session, { kind: 'askClarification' }); return current(session);
                }
                if (trace.run.status !== 'completed') groundingReject('TGRD1009', '/clarification', 'MAS segment did not finish or pause.');
                const state = clarificationState(trace);
                if (!state) groundingReject('TGRD1009', '/clarification', 'The committed clarification projection is missing.');
                return projected(session, state.history, state.result.outstandingQuestions ?? cp.decision!.requiredFields, state.refinedQuery);
            } catch (cause) { return fail(session, 'clarification', cause, account); }
        });
    }
    async function resume(input: Pick<GroundingSession, 'id'>, response: OptimizerResponse): Promise<OptimizerOutcome> {
        const accepted = await guarded(input, async session => {
            const host = options.clarification, cp = session.optimization;
            if (!host || !cp?.runId) groundingReject('TGRD1003', '/interaction', 'This session has no clarification run.');
            const interaction = await host.store.getInteraction(response.interactionId);
            if (!interaction || interaction.runId !== cp.runId) groundingReject('TGRD1004', '/interaction', 'The interaction belongs to another session.');
            if (interaction.status !== 'waiting') {
                const refused = planInteractionTransition(interaction.status, 'responded');
                if (!refused.ok) groundingReject('TGRD1003', '/interaction', 'MAS refused the repeated response.', refused.issue);
            }
            if (session.status !== 'awaiting_clarification') groundingReject('TGRD1003', '/status', 'The session is not waiting for this response.');
            const outcome = await host.store.respondInteraction(response.interactionId, response.value, response.expectedRevision, response.responseKey);
            if (!outcome.ok) groundingReject('TGRD1003', '/interaction', 'MAS refused the typed response.', outcome.issue);
            // Persist only the turn count here; host facts are projected from the accepted MAS trace.
            session = await transition(session, { kind: 'answerClarification', fields: {} });
            return value(session, 'needs-clarification');
        });
        return accepted.ok ? clarify(accepted.value.session) : accepted;
    }
    async function plan(input: Pick<GroundingSession, 'id'>): Promise<OptimizerOutcome> {
        return guarded(input, async session => {
            const { profile } = await ready, cp = session.optimization;
            if (!cp || !['ready', 'planned'].includes(cp.stage)) groundingReject('TGRD1003', '/optimization', 'A plan requires resolved intent.');
            if (cp.stage === 'planned') {
                if (!cp.intentId || !cp.planId) groundingReject('TGRD1002', '/optimization', 'A completed optimizer checkpoint requires its retained plan.');
                if (session.planId !== cp.planId) session = await transition(session, { kind: 'plan', intentId: cp.intentId, planId: cp.planId });
                return current(session);
            }
            if (cp.inFlight) groundingReject('TGRD1003', '/optimization/inFlight', 'An unfinished model proposal cannot be repeated automatically.');
            const intent = (await store.readTrace(session.id))?.intents.find(intent => intent.id === cp.intentId);
            if (!intent || intent.outstanding.length) groundingReject('TGRD1003', '/outstanding', 'Required user fields remain unknown.');
            session = await checkpoint(session, { ...cp, inFlight: 'plan' }); const account = accountFor(cp);
            try {
                const expansions = evaluateProfileRules(profile, { text: cp.originalQuery, intents: cp.decision!.intents }).expansions;
                const supplied = [intent.originalQuery, ...Object.values(intent.answered), ...Object.values(session.userContext)];
                const draft = await generate<QueryDraft>('plan', intent.summary || intent.originalQuery, { intent,
                    userFactVocabulary: factVocabulary, maxQueries: profile.clarification.maxQueries,
                    reservedExpansionQueries: expansions.flatMap(rule => rule.queries) }, account, draft => {
                    const errors: Array<{ code: string; docPath: string; message: string }> = [];
                    if (draft.queries.length > profile.clarification.maxQueries) errors.push({ code: 'TGRD1007', docPath: '/queries', message: 'Too many queries.' });
                    draft.queries.forEach((query, i) => {
                        if (!query.lanes.local && !query.lanes.web) errors.push({ code: 'TGRD1001', docPath: `/queries/${i}/lanes`, message: 'Enable at least one lane.' });
                        if (inventedGroundingFacts(query.text, supplied, factVocabulary).length) errors.push({ code: 'TGRD1001', docPath: `/queries/${i}/text`, message: 'An unsupplied registered user fact was introduced.' });
                    }); return errors;
                });
                const plan = await expandGroundingPlan({ profile, intent, intents: cp.decision!.intents, draft,
                    promptRevision: groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-plan')!.revision, modelIdentity: cp.models.plan });
                storeValue(await store.putPlan(plan));
                const next = { ...session.optimization!, stage: 'planned' as const, planId: plan.id, spent: spent(account) }; delete next.inFlight;
                session = await checkpoint(session, next); session = await transition(session, { kind: 'plan', intentId: intent.id, planId: plan.id });
                return value(session, 'planned', { intent, plan });
            } catch (cause) { return fail(session, 'plan', cause, account); }
        });
    }
    return Object.freeze({ triage, clarify, resume, plan });
}
