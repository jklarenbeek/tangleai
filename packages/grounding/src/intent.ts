/** Host-response projection and profile-owned query expansion; no model writes user fields. */
import type { GmplClarificationState } from '@tangleai/gmpl';
import type { ClarifiedIntent, GroundingProfile, QueryPlan, TriageDecision, QueryDraft } from './contracts.gen.ts';
import { groundingIdOf } from './identity.ts';
import { groundingMust, groundingReject } from './errors.ts';
import { validateGroundingShape } from './schema.ts';
import { evaluateProfileRules } from './profile.ts';

export const normalizeGroundingText = (text: string): string => text.normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim();
export function profileIntents(profile: GroundingProfile): string[] {
    return [...new Set([...profile.purposes, ...profile.expansions.flatMap(rule => rule.when.intents),
        ...profile.clarification.requiredFields.flatMap(field => field.intents)])];
}
/** This gate covers an explicitly registered closed vocabulary, not arbitrary clinical fact inference. */
export function inventedGroundingFacts(text: string, supplied: readonly string[], vocabulary: readonly string[]): string[] {
    const contains = (value: string, term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${normalizeGroundingText(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(normalizeGroundingText(value));
    return vocabulary.filter(term => contains(text, term) && !supplied.some(value => contains(value, term)));
}
export function triageDecisionErrors(profile: GroundingProfile, value: TriageDecision) {
    const fields = new Set(profile.clarification.requiredFields.map(field => field.id)), intents = new Set(profileIntents(profile));
    const errors: Array<{ code: string; docPath: string; message: string }> = [];
    value.requiredFields.forEach((field, i) => {
        if (!fields.has(field)) errors.push({ code: 'TGRD1001', docPath: `/requiredFields/${i}`, message: 'Unknown profile field.' });
        else if (!profile.userContext.collectable.includes(field) || !profile.userContext.persistable.includes(field))
            errors.push({ code: 'TGRD1004', docPath: `/requiredFields/${i}`, message: 'This field cannot enter a durable clarification.' });
    });
    value.intents.forEach((intent, i) => { if (!intents.has(intent)) errors.push({ code: 'TGRD1001', docPath: `/intents/${i}`, message: 'Unknown profile intent.' }); });
    if (value.triage === 'simple' && value.requiredFields.length) errors.push({ code: 'TGRD1001', docPath: '/triage', message: 'Missing required fields require clarification.' });
    if (value.triage === 'complex' && !value.requiredFields.length) errors.push({ code: 'TGRD1001', docPath: '/requiredFields', message: 'Complex intent must name its missing fields.' });
    return errors;
}
export interface ProjectIntentInput {
    profile: GroundingProfile; sessionId: string; executionId?: string; originalQuery: string; triage: TriageDecision;
    history: GmplClarificationState['history']; outstanding: string[]; refinedQuery: string;
    promptRevision: string; modelIdentity: ClarifiedIntent['modelIdentity']; ruleIds: string[];
}
export async function projectClarifiedIntent(input: ProjectIntentInput): Promise<ClarifiedIntent> {
    const { profile, triage, history } = input;
    const fields = new Map(profile.clarification.requiredFields.map(field => [field.id, field]));
    if (triageDecisionErrors(profile, triage).length || input.outstanding.some(id => !triage.requiredFields.includes(id)))
        groundingReject('TGRD1001', '/outstanding', 'Intent projection requires declared fields and valid triage.');
    const answers: Record<string, string> = {};
    for (const entry of history) {
        if (entry.provenance !== 'host-response' || entry.questions.length !== 1 || entry.questions[0]!.id !== 'q1')
            groundingReject('TGRD1004', '/history', 'Intent values require a single accepted host response.');
        const question = entry.questions[0]!, field = [...fields.values()].find(field => field.question === question.text);
        const answer = entry.response.answers.q1;
        if (!field || !triage.requiredFields.includes(field.id) || typeof answer !== 'string' || !answer.trim())
            groundingReject('TGRD1004', '/history', 'The host response does not name a declared question.');
        if (!input.outstanding.includes(field.id)) answers[field.id] = answer;
    }
    const outstanding = triage.requiredFields.filter(id => input.outstanding.includes(id) || !Object.hasOwn(answers, id));
    const values = (kind: 'constraint' | 'priority') => [...new Set(Object.entries(answers).filter(([id]) => fields.get(id)!.kind === kind).map(([, value]) => value))];
    const payload = { sessionId: input.sessionId, ...(input.executionId ? { executionId: input.executionId } : {}), originalQuery: input.originalQuery, triage: triage.triage,
        reason: triage.reason, answered: answers, outstanding, constraints: values('constraint'), priorities: values('priority'),
        summary: input.refinedQuery, turnsUsed: history.length, ruleIds: [...new Set(input.ruleIds)],
        promptRevision: input.promptRevision, modelIdentity: input.modelIdentity };
    return groundingMust(validateGroundingShape('clarifiedIntent', { ...payload, id: await groundingIdOf('intent', payload) }));
}
export async function expandGroundingPlan(input: { profile: GroundingProfile; intent: ClarifiedIntent; intents: string[];
    draft: QueryDraft; promptRevision: string; modelIdentity: QueryPlan['modelIdentity'] }): Promise<QueryPlan> {
    if (input.intent.outstanding.length) groundingReject('TGRD1003', '/outstanding', 'Required fields remain unknown.');
    const rows = new Map<string, QueryPlan['queries'][number]>();
    const add = async (query: Omit<QueryPlan['queries'][number], 'id'>) => {
        const key = normalizeGroundingText(query.text), prior = rows.get(key);
        const merged = prior ? { text: prior.text, why: prior.why, lanes: { local: prior.lanes.local || query.lanes.local, web: prior.lanes.web || query.lanes.web },
            ruleIds: [...new Set([...prior.ruleIds, ...query.ruleIds])] } : query;
        rows.set(key, { ...merged, id: await groundingIdOf('query', { intentId: input.intent.id, ...merged }) });
    };
    for (const query of input.draft.queries) await add({ ...query, ruleIds: [] });
    const rules = evaluateProfileRules(input.profile, { text: input.intent.originalQuery, intents: input.intents });
    for (const expansion of rules.expansions) for (const text of expansion.queries)
        await add({ text, why: 'Required by the profile expansion rule.', lanes: { local: true, web: true }, ruleIds: [expansion.ruleId] });
    if (rows.size > input.profile.clarification.maxQueries) groundingReject('TGRD1007', '/queries', 'query-count');
    const payload = { intentId: input.intent.id, profileRevision: input.profile.revision, queries: [...rows.values()],
        promptRevision: input.promptRevision, modelIdentity: input.modelIdentity };
    return groundingMust(validateGroundingShape('queryPlan', { ...payload, id: await groundingIdOf('plan', payload) }));
}
