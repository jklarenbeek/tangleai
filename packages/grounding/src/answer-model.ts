/** All answer stages consume one existing budget account and the installed prompt catalog. */
import { createBudgetAccount } from '@tangleai/agents';
import { createSharedBudgetClient, MasBudgetStop, type MasChatClient } from '@tangleai/mas';
import { createStructuredOutput } from '@tangleai/models/structured';
import { renderGmplPrompt } from '@tangleai/gmpl';
import type { EvidenceCandidate, GroundingProfile, GroundingSpend } from './contracts.gen.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { groundingMust, groundingReject } from './errors.ts';
import { loadGroundingProfile } from './profile.ts';
import { checkGroundingModelIdentity } from './model-identity.ts';
import { groundingRevisionOf, immutableGroundingJson } from './identity.ts';
export interface AnswerModelOptions {
    client: MasChatClient;
    modelIdentity: unknown;
    profile: GroundingProfile;
    budget?: { calls?: number; tokens?: number; ms?: number; repairs?: number };
    clock?: () => number;
}
export async function createAnswerModel(options: AnswerModelOptions) {
    const inputProfile = immutableGroundingJson(options.profile), modelIdentity = immutableGroundingJson(options.modelIdentity);
    const budget = options.budget ? immutableGroundingJson(options.budget) : undefined, clock = options.clock ?? (() => performance.now());
    const originalClient = options.client, complete = originalClient.complete.bind(originalClient);
    const pinnedClient = { ...(originalClient.endpoint ? { endpoint: { ...originalClient.endpoint } } : {}), complete };
    const profile = groundingMust(await loadGroundingProfile(inputProfile));
    await checkGroundingModelIdentity(modelIdentity, '/modelIdentity');
    const caps = { calls: budget?.calls ?? profile.budgets.calls, tokens: budget?.tokens ?? profile.budgets.tokens,
        ms: budget?.ms ?? profile.budgets.ms, repairs: budget?.repairs ?? profile.budgets.repairs ?? 1 };
    for (const key of ['calls', 'tokens', 'ms', 'repairs'] as const) if (!Number.isSafeInteger(caps[key]) || caps[key] < 0 || caps[key] > (profile.budgets[key] ?? 1))
        groundingReject('TGRD1007', '/budget/' + key, 'An answer budget may only narrow its profile ceiling.');
    const account = createBudgetAccount({ turns: caps.calls, tokens: caps.tokens, ms: caps.ms }, clock);
    const observed = createSharedBudgetClient(pinnedClient, account), client = { ...observed, endpoint: observed.endpoint ?? { provider: 'scripted' } };
    const signal = AbortSignal.timeout(Math.max(0, caps.ms));
    return { profile, modelIdentity, repairs: caps.repairs, stop: account.stop,
        spent(): GroundingSpend { const spent = account.spent(); return { calls: spent.turns, tokens: spent.tokens, ms: Math.ceil(spent.ms),
            searches: 0, fetches: 0, bytes: 0, clarificationTurns: 0, contextTokens: 0 }; },
        async run(stage: 'reconcile' | 'generate' | 'repair', query: string, admitted: readonly EvidenceCandidate[], context: Record<string, unknown>,
            control: { maxRepairs: number; gate?: (value: any) => any }) {
            if (!Number.isSafeInteger(control.maxRepairs) || control.maxRepairs < 0 || control.maxRepairs > 1) groundingReject('TGRD1007', '/maxRepairs', 'A structured answer stage allows at most one schema repair.');
            const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-' + stage)!;
            const evidence = await Promise.all(admitted.map(async row => ({ id: row.id, digest: await groundingRevisionOf(row),
                text: JSON.stringify({ lane: row.lane, authority: row.authority, times: row.times, excerpt: row.excerpt }) })));
            const rendered = renderGmplPrompt(artifact, { query, evidence, context });
            if (!rendered.valid) groundingReject('TGRD1001', '/prompt', 'The answer-stage prompt failed.', rendered.issues[0]);
            const result = await createStructuredOutput({ client, schema: artifact.outputSchema, name: 'grounding_' + stage, ...control })
                .generate([{ role: 'system', content: rendered.value.system }, { role: 'user', content: rendered.value.user }], { signal });
            const spent = account.spent();
            if (spent.tokens > caps.tokens) throw new MasBudgetStop('budget-tokens');
            if (spent.ms > caps.ms) throw new MasBudgetStop('budget-ms');
            return result;
        } };
}
export type AnswerModel = Awaited<ReturnType<typeof createAnswerModel>>;
