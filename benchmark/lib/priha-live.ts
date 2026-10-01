/** Credential-free plans precede every effectful live binding. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createReplayWebTransport } from '@tangleai/grounding';
import { DEFAULT_FETCH_LIMITS } from '@tangleai/documents/fetch';
import { readAiEnv, type AiEnv } from './ai-env.ts';
import { wireDescriptorOf } from './grounding-run.ts';
import { sourceManifest } from './source-manifest.ts';
import { prihaWebReplayRecords } from './priha-replay.ts';
import { loadPrihaFixture, PRIHA_SOURCE_FILES, createPrihaValidator, type LoadedPrihaFixture, type PrihaReport } from './priha.ts';
import type { PrihaLivePlan, PrihaLiveExecution } from './priha.types.ts';

export const PRIHA_LIVE_LIMITS = Object.freeze({ maxOutputTokens: 1024, concurrency: 1, retryAttempts: 1, cache: 'none' } as const);
function safeBase(value: string, label: string) {
    let url: URL; try { url = new URL(value); } catch { throw Error(label + ' is invalid.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw Error(label + ' must be credential-free HTTP without query or fragment.');
    return url.toString().replace(/\/$/, '');
}
export function validatePrihaLive(value: unknown): void {
    const result = createPrihaValidator()(value);
    if (!result.valid) throw Error('Invalid PriHA live record: ' + JSON.stringify(result.errors));
}
export async function planPrihaLive(report: Pick<PrihaReport, 'registration' | 'source'>, env: AiEnv = readAiEnv({}), options: {
    loaded?: LoadedPrihaFixture; root?: string; webLive?: boolean; searxBase?: string;
} = {}): Promise<PrihaLivePlan> {
    if (env.baseUrl) safeBase(env.baseUrl, 'PriHA live base URL');
    if (options.searxBase && !options.webLive) throw Error('A live Searx base requires the explicit live-web mode.');
    if (options.webLive && !options.searxBase) throw Error('Live web requires an explicit Searx base.');
    const loaded = options.loaded ?? await loadPrihaFixture(options.root);
    if (!equalsJson(report.registration.budgets, loaded.fixture.budgets) || !equalsJson(report.registration.questionIds, loaded.fixture.questions.map(row => row.key))
        || report.registration.fixtureId !== loaded.fixtureId || report.registration.contextTokens !== 1500
        || report.registration.answerProfileRevision !== JSON.parse(new TextDecoder().decode(loaded.bodies.get(loaded.answerExecution.profile.file)!)).revision)
        throw Error('PriHA plan differs from the registered fixture budgets, questions or profile.');
    const replay = await createReplayWebTransport(await prihaWebReplayRecords(loaded.fixture.web, loaded.webExecution, loaded.bodies), { searxBase: loaded.webExecution.searxBase });
    const rows = loaded.answerExecution.rows.map(row => row.key), webRows = loaded.answerExecution.rows.filter(row => row.web).length;
    const questionIds = report.registration.questionIds, maxSearches = questionIds.length * webRows * report.registration.budgets.searches;
    const maxFetches = questionIds.length * webRows * report.registration.budgets.fetches;
    const transport = { mode: options.webLive ? 'live-capture' as const : 'frozen-replay' as const,
        searxBase: options.webLive ? safeBase(options.searxBase!, 'PriHA Searx base') : replay.searxBase,
        replayRevision: replay.revision, profileRevision: report.registration.answerProfileRevision,
        maxRedirects: DEFAULT_FETCH_LIMITS.maxRedirects, robotsPerHop: true as const };
    const body = { registrationId: report.registration.registrationId, sourceSha256: report.source.sha256, fixtureId: loaded.fixtureId,
        fixtureSourceSha256: loaded.source.sha256, wire: wireDescriptorOf(env, 'off'), rows, questionIds, budget: report.registration.budgets,
        contextTokens: report.registration.contextTokens, maxFreshCalls: questionIds.length * rows.length * report.registration.budgets.modelCalls,
        maxSearches, maxFetches, maxWebHttpRequests: options.webLive ? maxSearches + maxFetches * (DEFAULT_FETCH_LIMITS.maxRedirects + 1) * 2 : 0,
        maxWebBytes: options.webLive ? questionIds.length * webRows * report.registration.budgets.maxBytes : 0,
        limits: PRIHA_LIVE_LIMITS, transport, cacheHits: 0 as const };
    const result: PrihaLivePlan = { document: 'priha-live-plan', status: 'not-run', plan: { ...body, planId: await canonicalSha256(body) }, physicalRequests: 0,
        reason: 'A new explicit approval naming this exact plan is required. This registration is not a provider receipt; live quality and healthcare deployment remain unmeasured.',
        skipped: !env.live ? 'No configured live wire in the shared AI environment.' : env.guardIssues.length ? 'A configured spend guard was rejected.'
            : body.maxFreshCalls > env.maxCalls ? `Registered maximum ${body.maxFreshCalls} exceeds the configured ${env.maxCalls} request ceiling.` : null };
    validatePrihaLive(result); return result;
}
export function authorizePrihaLive(plan: PrihaLivePlan, authorize?: string): 'skipped' | 'dry-run' | 'execute' {
    if (authorize !== undefined && authorize !== plan.plan.planId) throw Error('PriHA authorization does not match the current planId; zero requests.');
    return plan.skipped ? 'skipped' : authorize === undefined ? 'dry-run' : 'execute';
}
export async function runPrihaLive(report: PrihaReport, record: PrihaLivePlan, options: {
    env: AiEnv; authorize?: string; root?: string; fetch?: typeof globalThis.fetch; webFetch?: typeof globalThis.fetch;
    lookup?: import('@tangleai/documents/url-policy').AddressLookup; databaseDirectory?: string; now?: () => Date; clock?: () => number;
}): Promise<{ authorization: 'skipped' | 'dry-run' | 'execute'; physicalRequests: number; execution: PrihaLiveExecution | null }> {
    validatePrihaLive(record);
    const loaded = await loadPrihaFixture(options.root), manifest = await sourceManifest(options.root ?? process.cwd(), PRIHA_SOURCE_FILES, ['benchmark/lib', 'packages', 'apps/desktop/src']);
    const source = await canonicalSha256({ files: manifest.files });
    if (source !== record.plan.sourceSha256 || loaded.source.sha256 !== record.plan.fixtureSourceSha256 || loaded.fixtureId !== report.registration.fixtureId)
        throw Error('PriHA live source or fixture changed; inspect and authorize the current plan.');
    const current = await planPrihaLive(report, options.env, { loaded, webLive: record.plan.transport.mode === 'live-capture',
        ...(record.plan.transport.mode === 'live-capture' ? { searxBase: record.plan.transport.searxBase } : {}) });
    if (!equalsJson(current, record)) throw Error('PriHA live plan changed; inspect and authorize the current plan.');
    const authorization = authorizePrihaLive(record, options.authorize);
    if (authorization !== 'execute') return { authorization, physicalRequests: 0, execution: null };
    // CONFIG, provider factories, database creation and DNS are reached only after exact authorization.
    const { executePrihaLive } = await import('./priha-live-execution.ts');
    const execution = await executePrihaLive(record.plan, loaded, options);
    validatePrihaLive(execution);
    return { authorization, physicalRequests: execution.providerRequests + execution.webRequests, execution };
}
