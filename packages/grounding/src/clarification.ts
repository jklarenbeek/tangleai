/** Grounding policy bindings for the one GMPL clarification pattern. No conversation loop. */
import { createMasRegistrySnapshot, createMasConfigCatalog, type MasTaskHandlerBinding, type TraceView } from '@tangleai/mas';
import { gmplArtifacts, gmplSchemaOf, GMPL_STAGES, createGmplDomainBinding, createGmplRecipe, createGmplCatalog,
    gmplCatalogDocument, materializeGmplTemplate, instantiateGmplPattern, createGmplHostBindings,
    type GmplClarificationState, type ClarificationResolve, type GmplPromptArtifact } from '@tangleai/gmpl';
import type { GroundingProfile, OptimizerCheckpoint } from './contracts.gen.ts';
import { groundingReject } from './errors.ts';
import { groundingRevisionOf } from './identity.ts';
import { inventedGroundingFacts } from './intent.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
const must = <T>(outcome: { valid: true; value: T } | { valid: false; issues: unknown[] }): T => {
    if (!outcome.valid) groundingReject('TGRD1009', '/clarification', 'The GMPL binding failed.', outcome.issues[0]); return outcome.value;
};
export function clarificationState(trace: TraceView): GmplClarificationState | undefined {
    // The latest committed content state is retained even when a child interaction pauses.
    return [...trace.attempts].reverse().flatMap(attempt => {
        if (attempt.status !== 'completed' || !attempt.output || typeof attempt.output !== 'object') return [];
        const value = attempt.output as { state?: unknown; next?: unknown };
        return [value.state, value.next].filter((state): state is GmplClarificationState => Boolean(state && typeof state === 'object'
            && 'history' in state && 'refinedQuery' in state && 'policy' in state));
    })[0];
}
export async function prepareGroundingClarification(profile: GroundingProfile, checkpoint: OptimizerCheckpoint,
    vocabulary: readonly string[], sessionId: string) {
    if (!checkpoint.decision || checkpoint.route !== 'complex' || profile.clarification.maxTurns < 1 || profile.clarification.maxTurns > 10)
        groundingReject('TGRD1007', '/clarification/maxTurns', 'clarification-turns');
    const required = checkpoint.decision.requiredFields, fields = profile.clarification.requiredFields.filter(field => required.includes(field.id));
    const originals = gmplArtifacts.prompts.filter(prompt => GMPL_STAGES.clarification.includes(prompt.id));
    const prompts: GmplPromptArtifact[] = [...originals, ...groundingArtifacts.prompts];
    const rolePrompts = { 'clarification-resolve': 'grounding-resolve', 'clarification-question': 'grounding-question', 'analysis-merge': 'analysis-merge' };
    const capabilities = Object.values(rolePrompts).map(id => { const prompt = prompts.find(p => p.id === id)!; return { id: 'gmpl-' + id, version: prompt.revision }; });
    const payloadSchema = structuredClone(gmplSchemaOf('gmplInput')) as { properties: Record<string, unknown> };
    payloadSchema.properties.caseId = { const: sessionId, type: 'string' };
    const bindingRevision = await groundingRevisionOf({ profileRevision: profile.revision, decision: checkpoint.decision,
        vocabularyRevision: checkpoint.vocabularyRevision, budget: checkpoint.budget });
    const domain = must(await createGmplDomainBinding({ id: 'grounding-' + profile.id, title: 'Governed intent clarification',
        payloadSchema, projection: { id: 'grounding-intent', version: bindingRevision, kind: 'text', scale: null },
        rolePrompts, requiredCapabilities: capabilities }));
    const recipe = must(await createGmplRecipe({ id: 'grounding-clarification', scope: 'pattern',
        parameters: { pattern: 'clarification', maxTurns: profile.clarification.maxTurns, intentOnly: true }, stages: [...GMPL_STAGES.clarification] }));
    const catalog = must(await createGmplCatalog(await gmplCatalogDocument({ id: 'grounding-' + profile.id, prompts, domains: [domain], recipes: [recipe] })));
    const registry = must(await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'grounding-clarification',
        roles: [], handlers: [], tools: [], contextAdapters: [], messageAdapters: capabilities, templates: [], subgraphs: [] }));
    const config = must(await createMasConfigCatalog({ profiles: [profile.models.triage], tools: [], contexts: [],
        limits: { calls: checkpoint.budget.calls, tokens: checkpoint.budget.tokens, ms: checkpoint.budget.ms } }));
    const host = { registry, config, profile: profile.models.triage };
    const materialized = must(await materializeGmplTemplate(recipe, domain, host, catalog));
    const prepared = must(await instantiateGmplPattern(materialized, {}, host, catalog));
    const bindings = must(createGmplHostBindings(materialized, catalog));
    const taskHandlers: Record<string, MasTaskHandlerBinding> = { ...bindings.taskHandlers };
    for (const name of ['gmpl-intent-prepare', 'gmpl-question-prepare', 'gmpl-resolve-prepare']) {
        const original = taskHandlers[name]!;
        taskHandlers[name] = async input => {
            const output = await original(input) as { variables: { query: string; evidence: unknown[]; context: Record<string, unknown> } };
            const state = input.value.state as unknown as GmplClarificationState;
            return { variables: { ...output.variables, context: { ...output.variables.context, grounding: {
                profileRevision: profile.revision, fields, outstanding: state.result.outstandingQuestions ?? required,
                collectable: profile.userContext.collectable, persistable: profile.userContext.persistable, userFactVocabulary: vocabulary,
            } } } };
        };
    }
    const question = taskHandlers['gmpl-question-check']!;
    taskHandlers['gmpl-question-check'] = async input => {
        const state = input.value.state as unknown as GmplClarificationState;
        const out = input.value.out as { questions: Array<{ id: string; text: string }> };
        const outstanding = state.result.outstandingQuestions ?? required, expected = fields.find(field => outstanding.includes(field.id));
        if (!expected || out.questions.length !== 1 || out.questions[0]!.id !== 'q1' || out.questions[0]!.text !== expected.question)
            groundingReject('TGRD1001', '/questions', 'Ask exactly the first outstanding profile question.');
        return question(input);
    };
    for (const name of ['gmpl-intent-inspect', 'gmpl-intent-resolve']) {
        const original = taskHandlers[name]!;
        taskHandlers[name] = async input => {
            const state = input.value.state as unknown as GmplClarificationState, out = input.value.out as unknown as ClarificationResolve;
            const outstanding = out.result.outstandingQuestions;
            if (!outstanding || outstanding.some(id => !required.includes(id)) || out.resolved !== (outstanding.length === 0)
                || out.result.claims.length || out.result.findings.length || out.refinedQuery.length > 4000)
                groundingReject('TGRD1001', '/resolution', 'Resolution must name missing fields and cannot assert external facts.');
            const supplied = [checkpoint.originalQuery, ...state.history.flatMap(entry => Object.values(entry.response.answers))];
            if (inventedGroundingFacts(out.refinedQuery, supplied, vocabulary).length)
                groundingReject('TGRD1001', '/refinedQuery', 'Resolution introduced an unsupplied registered user fact.');
            for (const field of fields) if (!outstanding.includes(field.id) && !state.history.some(entry => entry.provenance === 'host-response'
                && entry.questions.some(q => q.text === field.question && Boolean(entry.response.answers[q.id]?.trim()))))
                groundingReject('TGRD1004', '/resolution', 'Resolved fields require actual host answers.');
            return original(input);
        };
    }
    return { ...prepared, bindings: { ...bindings, taskHandlers } };
}
