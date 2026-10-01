/** Scripted software census: execute the public optimizer and inspect retained host facts. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createQueryOptimizer, evaluateProfileRules, groundingArtifacts, inventedGroundingFacts,
    normalizeGroundingText, type GroundingProfile, type OptimizerOutcome, type OptimizerValue } from '@tangleai/grounding';
import { openTangleDb, createGroundingStore, createGroundingClarificationHost } from '@tangleai/store';
import { matchesPredicates } from './grounding.ts';
import type { Predicates } from './grounding.types.ts';
import type { PrihaConversation, PrihaOptimizerCase, PrihaOptimizerRow, PrihaOptimizerReport } from './priha.types.ts';

const AT = '2026-06-01T00:00:00.000Z';
const must = (outcome: OptimizerOutcome): OptimizerValue => {
    if (!outcome.ok) throw Error(outcome.issue.code + ': ' + outcome.issue.detail); return outcome.value;
};
function grade(conversation: PrihaConversation, row: PrihaOptimizerCase, profile: GroundingProfile, vocabulary: string[]): PrihaOptimizerCase {
    const expected = conversation.expected, actual = Object.values(row.answered), supplied = [conversation.initial.text, ...conversation.human.slice(0, row.turns).map(turn => turn.text)];
    const available = [...conversation.initial.facts, ...conversation.human.slice(0, row.turns).flatMap(turn => turn.facts)];
    const facts = conversation.factPredicates.filter(predicate => available.includes(predicate.fact));
    row.triageCorrect = row.triage === 'unclassified' ? null : row.triage === expected.triage;
    row.planCorrect = row.queries.length === expected.queries.length && expected.queries.every((predicate, i) => matchesPredicates(row.queries[i]!.text, predicate as Predicates)) && equalsJson(row.ruleIds, expected.ruleIds);
    row.outcomeCorrect = row.outcome === expected.outcome && row.turns === expected.turns;
    row.factsPreserved = expected.facts.every(fact => {
        const predicate = conversation.factPredicates.find(predicate => predicate.fact === fact);
        return predicate !== undefined && actual.some(text => matchesPredicates(text, predicate.predicates as Predicates));
    });
    row.inventedFacts = actual.filter(text => !supplied.includes(text) || !facts.some(predicate => matchesPredicates(text, predicate.predicates as Predicates))).length
        + inventedGroundingFacts(row.queries.map(query => query.text).join(' '), supplied, vocabulary).length;
    const expansion = profile.expansions.find(rule => expected.ruleIds.includes(rule.id));
    row.communityQuery = expansion ? expansion.addQueries.every(text => row.queries.some(query => normalizeGroundingText(query.text) === normalizeGroundingText(text) && query.ruleIds.includes(expansion.id))) : null;
    row.passed = row.triageCorrect === true && row.planCorrect && row.outcomeCorrect && row.factsPreserved && row.inventedFacts === 0
        && row.communityQuery !== false && equalsJson(row.requiredFields, expected.requiredFields) && row.error === null;
    return row;
}
function emptyCase(conversation: PrihaConversation): PrihaOptimizerCase {
    return { conversation: conversation.key, triage: 'unclassified', outcome: 'unoptimized', requiredFields: [], ruleIds: [], sourceKeys: [], queries: [],
        answered: {}, outstanding: [], turns: 0, calls: 0, tokens: 0, reopens: 0, replayedNodes: 0, sessionId: null, runId: null,
        triageCorrect: null, planCorrect: false, outcomeCorrect: false, factsPreserved: false, inventedFacts: 0, communityQuery: null, passed: false, error: null };
}
function summarize(key: PrihaOptimizerRow['key'], cases: PrihaOptimizerCase[]): PrihaOptimizerRow {
    const sum = (field: 'turns' | 'calls' | 'tokens' | 'inventedFacts') => cases.reduce((total, row) => total + row[field], 0);
    const complex = cases.filter(row => row.triage === 'complex'), resolved = complex.filter(row => row.outcome === 'resolved').length;
    const triageCorrect = key === 'drag-no-optimizer' ? null : cases.filter(row => row.triageCorrect).length;
    const planCorrect = cases.filter(row => row.planCorrect).length;
    return { key, status: 'executed', tier: 'scripted', cases, metrics: { cases: cases.length, planned: cases.filter(row => row.queries.length).length,
        refused: cases.filter(row => row.outcome === 'refuse' || row.outcome === 'exhausted').length,
        turns: sum('turns'), calls: sum('calls'), tokens: sum('tokens'), triageCorrect, triageAccuracy: triageCorrect === null ? null : triageCorrect / cases.length,
        planCorrect, planAccuracy: planCorrect / cases.length, outcomeCorrect: cases.filter(row => row.outcomeCorrect).length,
        factsPreserved: cases.filter(row => row.factsPreserved).length, inventedFacts: sum('inventedFacts'),
        communityRequired: cases.filter(row => row.communityQuery !== null).length, communityPresent: cases.filter(row => row.communityQuery === true).length,
        clarifications: complex.length, resolvedClarifications: resolved, exhaustedClarifications: complex.filter(row => row.outcome === 'exhausted').length,
        clarificationSuccess: complex.length ? resolved / complex.length : null } };
}
export async function measurePrihaOptimizer(conversations: PrihaConversation[], profile: GroundingProfile, vocabulary: string[]): Promise<PrihaOptimizerReport> {
    const off: PrihaOptimizerCase[] = [], on: PrihaOptimizerCase[] = [];
    const directory = await mkdtemp(join(tmpdir(), 'priha-optimizer-'));
    try {
        for (const conversation of conversations) {
            const raw = emptyCase(conversation), rules = evaluateProfileRules(profile, { text: conversation.initial.text }), rule = rules.emergency ?? rules.outOfScope;
            if (rule) { raw.triage = rules.emergency ? 'emergency' : 'out-of-scope'; raw.outcome = 'refuse'; raw.ruleIds = [rule]; raw.sourceKeys = rules.emergency ? profile.emergency.response.sourceKeys : []; }
            else { raw.ruleIds = ['in-scope']; raw.queries = [{ text: conversation.initial.text, ruleIds: [] }]; }
            off.push(grade(conversation, raw, profile, vocabulary));
            const row = emptyCase(conversation), script = conversation.optimizerScript;
            const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
                const step = script[row.calls++];
                if (!step) throw Error('Unregistered optimizer request for ' + conversation.key);
                const artifact = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-' + step.stage);
                const messages = (request as { messages: Array<{ content: unknown }> }).messages;
                if (!artifact || artifact.revision !== step.promptRevision || !messages.some(message => typeof message.content === 'string' && message.content.includes(artifact.role.instructions)))
                    throw Error('Optimizer stage or prompt revision differs from its registered script.');
                row.tokens += 10;
                return { message: { role: 'assistant', content: JSON.stringify(step.reply) }, usage: { prompt_tokens: 7, completion_tokens: 3 }, finishReason: 'stop' };
            } };
            const path = join(directory, conversation.key + '.sqlite'), open = () => openTangleDb({ path, jobs: { now: () => 1_000_000, random: () => 0.5 } });
            let db = await open(), store = createGroundingStore(db);
            const host = () => createGroundingClarificationHost(db, { now: () => AT, deadlineFor: () => '2026-06-02T00:00:00.000Z', observer: { onNodeReplay() { row.replayedNodes++; } } });
            const optimizer = () => createQueryOptimizer({ profile, store, clients: { triage: { client, identity: null }, plan: { client, identity: null } }, factVocabulary: vocabulary, clock: () => 0, clarification: host() });
            try {
                const registered = await store.putProfile(profile); if (!registered.ok) throw Error(registered.issue.detail);
                const created = await store.createSession({ conversationId: 'priha-optimizer:' + conversation.key, profileId: profile.id, profileRevision: profile.revision });
                if (!created.ok) throw Error(created.issue.detail); row.sessionId = created.value.id;
                let result = must(await optimizer().triage(created.value, conversation.initial.text));
                row.triage = result.session.optimization!.route === 'out_of_scope' ? 'out-of-scope' : result.session.optimization!.route as PrihaOptimizerCase['triage'];
                row.requiredFields = result.session.optimization!.decision?.requiredFields ?? [];
                if (result.disposition === 'needs-clarification') result = must(await optimizer().clarify(result.session));
                // This host supplies registered answers; GMPL owns all question scheduling.
                for (const [index, response] of conversation.human.entries()) {
                    if (result.disposition !== 'clarification') throw Error('Registered host response has no pending interaction.');
                    const waiting = result, calls = row.calls;
                    await db.close(); db = await open(); store = createGroundingStore(db); row.reopens++;
                    result = must(await optimizer().clarify(created.value));
                    if (row.calls !== calls || result.interactionId !== waiting.interactionId || result.session.id !== waiting.session.id) throw Error('Durable wait replay changed identity or repeated a model call.');
                    result = must(await optimizer().resume(result.session, { interactionId: result.interactionId!, expectedRevision: result.interactionRevision!, responseKey: 'fixture-answer-' + index, value: { answers: { q1: response.text } } }));
                }
                if (result.disposition === 'ready') result = must(await optimizer().plan(result.session));
                row.outcome = result.disposition === 'planned' ? 'resolved' : result.disposition === 'refuse' ? result.reason === 'insufficient_detail' ? 'exhausted' : 'refuse' : 'failed';
                row.queries = result.plan?.queries.map(query => ({ text: query.text, ruleIds: query.ruleIds })) ?? [];
                row.ruleIds = result.ruleIds; row.sourceKeys = result.sourceKeys; row.answered = result.intent?.answered ?? {};
                row.outstanding = result.intent?.outstanding ?? []; row.turns = result.session.turn; row.runId = result.session.optimization!.runId ?? null;
                if (row.calls !== script.length || result.spend.calls !== row.calls || result.spend.tokens !== row.tokens) throw Error('Script and durable shared spend do not reconcile.');
                if (row.runId && row.replayedNodes === 0) throw Error('The resumed workflow did not expose native replay.');
                const trace = (await store.readTrace(created.value.id))!;
                if (trace.evidence.length || trace.answers.length) throw Error('Intent planning performed retrieval or generated an answer.');
            } catch (cause) { row.outcome = 'failed'; row.error = cause instanceof Error ? cause.message : String(cause); }
            finally { await db.close(); }
            on.push(grade(conversation, row, profile, vocabulary));
        }
    } finally { await rm(directory, { recursive: true, force: true }); }
    const rows = [summarize('drag-no-optimizer', off), summarize('priha-full', on)];
    return { status: 'executed', tier: 'scripted', catalogRevision: groundingArtifacts.revision, vocabularyRevision: await canonicalSha256(vocabulary),
        rows, failed: on.filter(row => !row.passed).length, scriptedRequests: rows.reduce((total, row) => total + row.metrics.calls, 0), providerRequests: 0, networkRequests: 0, latency: 'not-measured',
        limitations: 'Registered scripted responses test software control flow and closed-vocabulary fact checks. Raw-query controls retain deterministic refusal rules. These are plan-level observations, not answer or live model quality. The deterministic clock is not a latency measurement.' };
}
