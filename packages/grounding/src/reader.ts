/** Read retained executions without resolving current settings or constructing clients. */
import type { MasStore } from '@tangleai/mas';
import type { GroundingStore } from './store.ts';
import type { GroundingReply, GroundingEvidenceView, EvidenceConflict } from './contracts.gen.ts';
import { groundingReject } from './errors.ts';
import { renderPrihaAnswer } from './render.ts';
export function createGroundingReader(options: { store: GroundingStore; mas: MasStore; replayed?: (runId: string) => number }) {
    const { store, mas } = options;
    async function traceFor(id: string) {
        const trace = await store.readTrace(id);
        if (!trace) groundingReject('TGRD1004', '/sessionId', 'The grounding session does not exist.');
        return trace;
    }
    async function get(sessionId: string): Promise<GroundingReply> {
        const trace = await traceFor(sessionId), session = trace.session, execution = session.execution;
        if (!execution) groundingReject('TGRD1004', '/execution', 'This session has no composed execution.');
        const profile = await store.getProfile(session.profileId, session.profileRevision);
        if (!profile) groundingReject('TGRD1009', '/profile', 'The retained profile is unavailable.');
        const native = await mas.readTrace(execution.runId), interaction = native?.interactions.find(row => row.status === 'waiting');
        const answer = trace.answers.find(row => row.id === session.answerIds.at(-1) && row.planId === session.planId);
        const web = trace.webRuns.filter(row => row.identity?.planId === session.planId);
        const disposition = session.status === 'failed' || native?.run.status === 'failed' ? 'failure'
            : interaction ? 'clarification' : answer ? answer.disposition === 'answer' ? 'answer' : 'refusal'
            : session.status === 'refused' ? 'refusal' : 'running';
        const issue = session.failure ?? session.optimization?.issue;
        const prompt = interaction?.prompt as { questions?: Array<{ id: string; text: string }> } | undefined;
        const policyReason = session.optimization?.stopReason;
        return { sessionId, disposition, ...(interaction && disposition === 'clarification' ? { question: { interactionId: interaction.id, revision: interaction.revision,
            text: prompt?.questions?.map(row => row.text).join('\n') ?? 'Clarification is required.', fields: prompt?.questions?.map(({ id, text }) => ({ id, text })) ?? [], responseSchema: interaction.responseSchema as NonNullable<GroundingReply['question']>['responseSchema'] } } : {}),
            ...(answer ? { answer: { text: renderPrihaAnswer(answer, { profile }), claims: answer.claims, citations: answer.citations,
                caveats: [...new Set(answer.claims.flatMap(row => row.caveats))], disposition: answer.disposition } }
                : disposition === 'refusal' ? { answer: { text: policyReason === 'emergency' ? profile.emergency.response.text ?? 'Use the emergency route specified by the service.'
                    : policyReason === 'insufficient_detail' ? 'Required information is still missing.' : 'This request is outside the supported information service.',
                    claims: [], citations: [], caveats: [], disposition: 'refuse' as const } } : {}),
            ...(disposition === 'failure' ? { failure: { code: issue?.code ?? native?.run.failure?.error.code ?? 'TGRD1009',
                detail: issue?.detail ?? native?.run.failure?.error.detail ?? 'The grounding execution failed.' } } : {}),
            ruleIds: session.optimization?.ruleIds ?? [], gaps: trace.intents.find(row => row.id === session.intentId)?.outstanding ?? [],
            trace: { calls: native?.run.budget.spent.turns ?? 0, tokens: native?.run.budget.spent.tokens ?? 0, ms: Math.ceil(native?.run.budget.spent.ms ?? 0),
                searches: web.reduce((n, row) => n + row.spend.searches, 0), fetches: web.reduce((n, row) => n + row.spend.fetches, 0),
                denied: web.reduce((n, row) => n + row.attempts.reduce((m, attempt) => m + attempt.denied.length, 0), 0),
                replayed: options.replayed?.(execution.runId) ?? 0,
                stopReason: answer?.stopReason ?? policyReason ?? native?.run.status ?? 'queued' },
            identities: { profileRevision: profile.revision, runId: execution.runId, workflowVersionId: execution.workflowVersionId, configIdentityId: execution.configIdentityId } };
    }
    async function evidence(sessionId: string): Promise<GroundingEvidenceView> {
        const trace = await traceFor(sessionId), plan = trace.plans.find(row => row.id === trace.session.planId);
        const rows = trace.evidence.filter(row => plan?.queries.some(query => query.id === row.queryId));
        const answer = trace.answers.find(row => row.id === trace.session.answerIds.at(-1) && row.planId === plan?.id);
        const used = new Set(answer?.citations.map(row => row.evidenceId) ?? []);
        return { candidates: rows.map(row => ({ id: row.id, lane: row.lane, authority: row.authority, times: row.times, citation: row.citation, used: used.has(row.id) })),
            unused: rows.filter(row => !used.has(row.id)).map(row => row.id) };
    }
    async function conflicts(sessionId: string): Promise<EvidenceConflict[]> {
        const trace = await traceFor(sessionId), plan = trace.plans.find(row => row.id === trace.session.planId);
        const native = trace.session.execution ? await mas.readTrace(trace.session.execution.runId) : undefined;
        const reconciled = native?.attempts.find(row => row.path === 'reconcile-model' && row.status === 'completed');
        const current = (reconciled?.output as { context?: { conflictIds?: string[] } } | undefined)?.context?.conflictIds;
        return trace.conflicts.filter(row => current ? current.includes(row.id) : plan?.queries.some(query => query.id === row.queryId));
    }
    return Object.freeze({ get, evidence, conflicts,
        async list(limit = 50) {
            const sessions = await store.listSessions(limit);
            return Promise.all(sessions.filter(row => row.execution).map(async row => ({ sessionId: row.id,
                disposition: (await get(row.id)).disposition, turn: row.turn, at: row.execution!.at })));
        } });
}
