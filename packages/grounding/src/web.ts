/** Profile-bound web reads. Agents own tool turns; this machine owns reflection and evidence. */
import { equalsJson } from '@jarenjs/core/object';
import { createAgent, createToolbox, createBudgetAccount, transcriptText } from '@tangleai/agents';
import { createStructuredOutput } from '@tangleai/models/structured';
import { createSharedBudgetClient, MasBudgetStop, type MasBudgetAccount, type MasChatClient } from '@tangleai/mas';
import { createSearxngClient } from '@tangleai/search';
import { SafeStaticFetcher } from '@tangleai/documents/fetch';
import { DocumentError } from '@tangleai/documents/contracts';
import { extractStaticDocument, type ExtractOptions } from '@tangleai/documents/extract-static';
import type { ExtractedDocument } from '@tangleai/documents/contracts';
import { normalizeUrl } from '@tangleai/documents/url-policy';
import { renderGmplPrompt } from '@tangleai/gmpl';
import type { GroundingProfile, GroundingSession, GroundingIssue, EvidenceCandidate, WebRetrievalRun, WebRunIdentity, WebSufficiency, GroundingSpend } from './contracts.gen.ts';
import { checkGroundingModelIdentity } from './model-identity.ts';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { immutableGroundingJson, groundingIdOf, groundingRevisionOf } from './identity.ts';
import { GroundingAbort, groundingReject, groundingIssue, groundingMust } from './errors.ts';
import { validateGroundingShape } from './schema.ts';
import { evaluateProfileRules, loadGroundingProfile } from './profile.ts';
import { createWebRanker, type WebRankCandidate } from './web-ranker.ts';
import type { CandidateRanker } from './ranker.ts';
import { webBytesSha256, type WebTransport } from './web-transport.ts';
import type { GroundingStore } from './store.ts';
export type WebBudgets = WebRunIdentity['budgets'];
export interface WebLaneRanker extends CandidateRanker<WebRankCandidate> {
    /** Model rankers bind to the same account as agent turns and sufficiency. */
    modelIdentity?: WebRunIdentity['modelIdentity'];
    withBudget?: (account: MasBudgetAccount) => CandidateRanker<WebRankCandidate>;
}
export interface WebLaneOptions {
    profile: GroundingProfile; client: MasChatClient; modelIdentity: WebRunIdentity['modelIdentity'];
    transport: WebTransport; store: GroundingStore; ranker?: WebLaneRanker;
    budgets?: Partial<WebBudgets>; clock: () => number; now: () => string;
    maxToolResultChars?: number;
    signal?: AbortSignal;
    /** Bind these policy-owned tools through an enclosing native workflow toolbox. */
    bindTools?: (tools: ReturnType<typeof createToolbox>) => Pick<ReturnType<typeof createToolbox>, 'toFunctionTools' | 'execute'>;
    /** Optional host PDF-capable extractor; identity pins the actual extraction implementation. */
    extractor?: { id: string; extract(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractedDocument> };
}
export type WebLaneOutcome = { ok: true; candidates: EvidenceCandidate[]; run: WebRetrievalRun; replayed: boolean }
    | { ok: false; issue: GroundingIssue };
const emptySpend = (): GroundingSpend => ({ calls: 0, tokens: 0, ms: 0, searches: 0, fetches: 0, bytes: 0, clarificationTurns: 0, contextTokens: 0 });
const must = <T>(outcome: { ok: true; value: T } | { ok: false; issue: GroundingIssue }): T => {
    if (!outcome.ok) throw new GroundingAbort(outcome.issue); return outcome.value;
};
const textSchema = { type: 'string', minLength: 1, maxLength: 4000 };
const noExtraObject = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });
export const GROUNDING_WEB_TOOLS = [
    { name: 'web_search', description: 'Find candidate URLs. Snippets are discovery hints, never evidence.',
        inputSchema: noExtraObject({ query: textSchema, language: { type: 'string', minLength: 1, maxLength: 32 } }, ['query']) },
    { name: 'web_fetch', description: 'Fetch and extract an admitted page, returning exact-byte evidence or a named failure.',
        inputSchema: noExtraObject({ url: { type: 'string', minLength: 1, maxLength: 8192 } }, ['url']) },
] as const;
export function createWebLane(options: WebLaneOptions) {
    const profileInput = immutableGroundingJson(options.profile), transport = Object.freeze({ ...options.transport });
    const clock = options.clock, now = options.now, hasCustomRanker = options.ranker !== undefined;
    const extractorId = options.extractor?.id ?? 'document-static/1', extract = options.extractor?.extract.bind(options.extractor) ?? extractStaticDocument;
    const budgetInput = { ...options.budgets }, maxChars = options.maxToolResultChars ?? 8000;
    const modelIdentity = immutableGroundingJson(options.modelIdentity), client = options.client, store = options.store;
    const suppliedRanker: WebLaneRanker = options.ranker ?? createWebRanker();
    const rankerModelIdentity = immutableGroundingJson(suppliedRanker.modelIdentity ?? null);
    const rankerId = suppliedRanker.id + '/' + suppliedRanker.version;
    const rank = suppliedRanker.rank.bind(suppliedRanker), bindBudget = suppliedRanker.withBudget?.bind(suppliedRanker);
    const ready = (async () => {
        const profile = groundingMust(await loadGroundingProfile(profileInput));
        const budgets: WebBudgets = { calls: profile.budgets.calls, tokens: profile.budgets.tokens, ms: profile.budgets.ms,
            searches: profile.budgets.searches, fetches: profile.budgets.fetches, bytes: profile.budgets.bytes, ...budgetInput };
        for (const key of Object.keys(budgets) as Array<keyof WebBudgets>)
            if (!Number.isSafeInteger(budgets[key]) || budgets[key] < 0 || budgets[key] > profile.budgets[key])
                groundingReject('TGRD1007', '/budgets/' + key, 'Web budgets cannot widen the profile.');
        if (!extractorId.trim() || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 100000 || !/^[a-f0-9]{64}$/.test(transport.revision))
            groundingReject('TGRD1001', '/transport', 'A transport revision and bounded tool excerpt are required.');
        await checkGroundingModelIdentity(modelIdentity, '/modelIdentity');
        await checkGroundingModelIdentity(rankerModelIdentity, '/rankerModelIdentity');
        return { profile, budgets };
    })();
    // A host worker owns cross-process dispatch. Concurrent calls on this instance serialize.
    let tail: Promise<unknown> = Promise.resolve();
    async function execute(input: Pick<GroundingSession, 'id'>, queryId: string): Promise<WebLaneOutcome> {
        const { profile, budgets } = await ready, trace = await store.readTrace(input.id);
        if (!trace || trace.session.profileId !== profile.id || trace.session.profileRevision !== profile.revision)
            groundingReject('TGRD1004', '/session', 'The web session must belong to this profile revision.');
        const plan = trace.plans.find(row => row.id === trace.session.planId), query = plan?.queries.find(row => row.id === queryId);
        if (!plan || !query?.lanes.web) groundingReject('TGRD1004', '/queryId', 'An applied plan must authorize this web query.');
        const identity: WebRunIdentity = { profileRevision: profile.revision, planId: plan.id, queryRevision: await groundingRevisionOf(query),
            transportRevision: transport.revision, rankerId, promptRevision: groundingArtifacts.revision, modelIdentity, rankerModelIdentity, extractorId, maxToolResultChars: maxChars, budgets };
        const runId = await groundingIdOf('web-run', { sessionId: input.id, queryId, identity, maxToolResultChars: maxChars });
        const retained = trace.webRuns.find(row => row.id === runId);
        if (retained) {
            const candidates = (retained.evidenceIds ?? []).map(id => trace.evidence.find(row => row.id === id));
            if (candidates.some(row => !row)) groundingReject('TGRD1004', '/evidenceIds', 'Retained web evidence is incomplete.');
            return { ok: true, candidates: candidates as EvidenceCandidate[], run: retained, replayed: true };
        }
        if (!['planning', 'retrieving'].includes(trace.session.status)) groundingReject('TGRD1003', '/session/status', 'Web retrieval requires a ready retrieval session.');
        if (trace.webRuns.some(row => row.queryId === queryId && row.identity?.planId === plan.id))
            groundingReject('TGRD1002', '/identity', 'A completed query cannot be rerun under different web settings; create a new plan.');
        const { queryRevision: _queryRevision, ...sharedIdentity } = identity;
        for (const peer of trace.webRuns.filter(row => row.identity?.planId === plan.id)) {
            const { queryRevision: _priorQuery, ...priorIdentity } = peer.identity!;
            if (!equalsJson(sharedIdentity, priorIdentity)) groundingReject('TGRD1002', '/identity', 'All web queries of a plan must retain the same policy, model, extraction and budget configuration.');
        }
        // Budgets span all web queries of this plan, including a reopened host.
        const prior = trace.webRuns.filter(row => row.identity?.planId === plan.id).reduce((sum, row) => {
            for (const key of Object.keys(sum) as Array<keyof GroundingSpend>) sum[key] += row.spend[key]; return sum;
        }, emptySpend());
        const account = createBudgetAccount({ turns: budgets.calls, tokens: budgets.tokens, ms: budgets.ms,
            spent: { turns: prior.calls, tokens: prior.tokens, ms: prior.ms } }, clock);
        const sharedClient = createSharedBudgetClient(client, account);
        const observed: MasChatClient = { ...sharedClient, complete(request) {
            if (stopReason.startsWith('budget-')) throw new MasBudgetStop(stopReason);
            return sharedClient.complete(request);
        } }, activeRanker = bindBudget?.(account) ?? { id: suppliedRanker.id, version: suppliedRanker.version, rank };
        if (activeRanker.id + '/' + activeRanker.version !== rankerId) groundingReject('TGRD1002', '/ranker', 'Budget binding cannot change ranker identity.');
        let searches = prior.searches, fetches = prior.fetches, bytes = prior.bytes, stopReason = 'insufficient-after-reflection';
        const attempts: WebRetrievalRun['attempts'] = [], candidates = new Map<string, EvidenceCandidate>();
        const discovery = new Map<string, { rank: number; title: string }>();
        const policy = evaluateProfileRules(profile, { text: query.text });
        let active: WebRetrievalRun['attempts'][number] | undefined, finalSufficiency: WebRetrievalRun['sufficiency'] = { decision: 'insufficient', reason: 'No assessment completed.' };
        const stop = () => account.stop() ?? (bytes >= budgets.bytes ? 'budget-bytes' : null);
        const assertTime = () => { const reason = stop(); if (reason) throw new MasBudgetStop(reason); };
        const requests: NonNullable<WebRetrievalRun['requests']> = [];
        let issue: GroundingIssue | undefined;
        const fetcher = new SafeStaticFetcher({ fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            try { const response = await transport.fetch(input, init); requests.push({ url, status: response.status, code: null }); return response; }
            catch (cause) { requests.push({ url, status: null, code: cause instanceof DocumentError ? cause.code : 'transport-failed' }); throw cause; }
        }, lookup: transport.lookup, now,
            limits: { timeoutMs: Math.max(1, budgets.ms), maxBytes: budgets.bytes, maxCompressedBytes: budgets.bytes, perHostDelayMs: 0, concurrency: 1 },
            admission: (url) => {
                const authority = policy.authorityOf(url);
                return authority && profile.authority.tiers.includes(authority.tier) ? { admitted: true, tier: authority.tier, ruleId: authority.ruleId }
                    : { admitted: false, reason: 'No admitting profile authority rule.' };
            }, onBytesRead(count) { bytes += count; if (bytes > budgets.bytes) throw new MasBudgetStop('budget-bytes'); },
        });
        const timeout = AbortSignal.timeout(Math.max(1, budgets.ms - prior.ms));
        const deadline = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
        const searx = createSearxngClient({ baseUrl: transport.searxBase, timeoutMs: Math.max(1, Math.min(5000, budgets.ms)),
            fetch: async (url, init) => {
                assertTime();
                const result = await fetcher.fetch(String(url), {}, init?.signal ?? undefined, { maxBytes: Math.max(0, budgets.bytes - bytes), respectRobots: false });
                assertTime();
                return new Response(result.bytes ? new Uint8Array(result.bytes) : null, { status: result.responseStatus, headers: { 'content-type': 'application/json' } });
            },
        });
        const attemptFor = () => active ??= (() => { const attempt = { query: query.text, results: 0, snippets: 0, admitted: [], denied: [], fetched: [], failed: [] }; attempts.push(attempt); return attempt; })();
        const failure = (url: string, cause: unknown) => {
            const attempt = attemptFor(), code = cause instanceof DocumentError ? cause.code : cause instanceof MasBudgetStop ? cause.reason : 'fetch-failed';
            if (cause instanceof DocumentError && cause.code === 'policy-denied') {
                const detail = cause.details as { url?: string; reason?: string; hop?: number; redirects?: string[] } | undefined;
                attempt.denied.push({ url: detail?.url ?? url, reason: detail?.reason ?? cause.message, ...(detail?.hop === undefined ? {} : { hop: detail.hop }), ...(detail?.redirects ? { redirects: detail.redirects } : {}) });
            } else attempt.failed.push({ url, code });
            if (code === 'byte-budget-exhausted') stopReason = 'budget-bytes';
            else if (cause instanceof MasBudgetStop) stopReason = cause.reason;
            else if (deadline.aborted) stopReason = 'budget-ms';
            return { error: cause instanceof Error ? cause.message : String(cause), code };
        };
        const toolbox = createToolbox();
        toolbox.add({ ...GROUNDING_WEB_TOOLS[0],
            async execute(args: { query: string; language?: string }) {
                try {
                    assertTime(); if (searches >= budgets.searches) throw new MasBudgetStop('budget-searches');
                    searches++; active = { query: args.query, results: 0, snippets: 0, admitted: [], denied: [], fetched: [], failed: [] }; attempts.push(active);
                    const result = await searx.search(args.query, { ...(args.language ? { language: args.language } : {}),
                        signal: AbortSignal.any([deadline, AbortSignal.timeout(Math.max(1, Math.min(5000, budgets.ms - account.spent().ms)))]) });
                    const seen = new Set<string>(), results: Array<{ rank: number; url: string; title: string; snippet: string }> = [];
                    for (const hit of result.results) {
                        let url: string; try { url = normalizeUrl(hit.url); } catch (cause) { failure(hit.url, cause); continue; }
                        if (seen.has(url)) continue; seen.add(url);
                        const row = { rank: results.length + 1, url, title: hit.title.slice(0, maxChars), snippet: (hit.content ?? '').slice(0, maxChars) };
                        results.push(row); discovery.set(url, { rank: row.rank, title: row.title });
                    }
                    active.results = results.length; active.snippets = results.filter(row => row.snippet).length;
                    return { attempt: attempts.length, results };
                } catch (cause) { return failure(transport.searxBase, cause); }
            },
        });
        toolbox.add({ ...GROUNDING_WEB_TOOLS[1],
            async execute(args: { url: string }) {
                try {
                    assertTime(); const url = normalizeUrl(args.url), priorEvidence = candidates.get(url);
                    if (priorEvidence) return { evidenceId: priorEvidence.id, ...priorEvidence };
                    if (fetches >= budgets.fetches) throw new MasBudgetStop('budget-fetches'); fetches++;
                    const attempt = attemptFor();
                    const result = await fetcher.fetch(url, {}, deadline, { maxBytes: Math.max(0, budgets.bytes - bytes) });
                    assertTime();
                    if (!result.bytes) throw new DocumentError('empty-content', 'The page has no new evidence bytes.');
                    const sha256 = await webBytesSha256(result.bytes), authority = policy.authorityOf(result.finalUrl)!;
                    for (const admitted of [url, ...(result.redirects ?? [])]) if (!attempt.admitted.includes(admitted)) attempt.admitted.push(admitted);
                    attempt.fetched.push({ url, finalUrl: result.finalUrl, sha256, bytes: result.bytes.length, status: result.responseStatus, redirects: result.redirects ?? [] });
                    const extracted = await extract(result.bytes, { mimeType: result.mimeType ?? '', url: result.finalUrl });
                    const excerpt = extracted.elements.map(row => row.text).join('\n').slice(0, maxChars);
                    if (!excerpt.trim() || !extracted.elements.some(row => row.role !== 'title' && row.role !== 'heading')) throw new DocumentError('empty-content', 'The page has no extracted evidence text.');
                    const times: EvidenceCandidate['times'] = { provenance: null };
                    for (const [key, value] of Object.entries(extracted.metadata ?? {})) {
                        const checked = validateGroundingShape('evidenceTimes', { provenance: 'metadata', [key]: value });
                        if (checked.valid) Object.assign(times, checked.value);
                    }
                    const address = { url, finalUrl: result.finalUrl, sha256, fetchedAt: result.fetchedAt, redirects: result.redirects ?? [] };
                    const evidence = groundingMust(validateGroundingShape('evidenceCandidate', {
                        id: await groundingIdOf('evidence', { runId, address }), sessionId: input.id, profileRevision: profile.revision, queryId, lane: 'web', address, excerpt,
                        scores: {}, rankerId, authority: { tier: authority.tier, institution: authority.institution, ruleIds: [authority.ruleId] }, times,
                        admitted: { by: [authority.ruleId], at: result.fetchedAt }, citation: { url: result.finalUrl, title: extracted.title ?? discovery.get(url)?.title ?? result.finalUrl, headingPath: [] },
                        transport: { extractionVersion: extractorId, ...(result.lastModified ? { lastModified: result.lastModified } : {}), ...(result.etag ? { etag: result.etag } : {}) },
                    }));
                    candidates.set(url, evidence);
                    return { evidenceId: evidence.id, url, finalUrl: result.finalUrl, sha256, title: evidence.citation.title, authority: evidence.authority, times: evidence.times, excerpt };
                } catch (cause) { return failure(args.url, cause); }
            },
        });
        const effectiveToolbox = options.bindTools?.(toolbox) ?? toolbox;
        const render = (stage: string, context: Record<string, unknown>) => {
            const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-' + stage)!;
            const rendered = renderGmplPrompt(artifact, { query: query.text, evidence: [], context });
            if (!rendered.valid) groundingReject('TGRD1001', '/prompt', 'Web prompt rendering failed.', rendered.issues[0]);
            return { artifact, rendered: rendered.value };
        };
        try {
            let pending = [query.text], missing: string[] = [];
            // Every reflection either consumes a search or ends. No model-owned loop condition.
            for (let iteration = 0; iteration <= budgets.searches; iteration++) {
                assertTime(); if (searches >= budgets.searches) { stopReason = 'budget-searches'; break; }
                const beforeSearch = searches, prompt = render('web-agent', { queries: pending, missing, policy: profile.authority, budgets,
                    evidence: [...candidates.values()].map(row => ({ id: row.id, excerpt: row.excerpt })) });
                const remaining = account.remaining();
                const agent = createAgent({ client: observed, toolbox: effectiveToolbox, system: prompt.rendered.system, maxToolRounds: budgets.searches + budgets.fetches,
                    maxToolResultChars: maxChars, now: clock, budget: { turns: remaining.turns!, tokens: remaining.tokens!, ms: remaining.ms! } });
                const result = await agent.send([{ role: 'user', content: prompt.rendered.user }], { signal: deadline });
                if (result.stopReason.startsWith('budget-')) { stopReason = result.stopReason; break; }
                if (stopReason.startsWith('budget-')) break;
                assertTime();
                const assessment = render('web-sufficiency', { transcript: transcriptText(result.messages), evidence: [...candidates.values()], missing });
                const generator = createStructuredOutput({ client: { ...observed, endpoint: observed.endpoint ?? { provider: 'scripted' } }, schema: assessment.artifact.outputSchema,
                    name: 'grounding_web_sufficiency', maxRepairs: 1 });
                const output = await generator.generate([{ role: 'system', content: assessment.rendered.system }, { role: 'user', content: assessment.rendered.user }], { signal: deadline });
                if (output.errors) { finalSufficiency = { decision: 'refused', reason: 'sufficiency-unavailable' }; stopReason = 'sufficiency-unavailable'; break; }
                const decision = output.value as WebSufficiency;
                if (account.spent().tokens > budgets.tokens || account.spent().ms > budgets.ms) throw new MasBudgetStop(account.spent().tokens > budgets.tokens ? 'budget-tokens' : 'budget-ms');
                finalSufficiency = { decision: decision.sufficient && candidates.size ? 'sufficient' : 'insufficient', reason: decision.reason };
                if (finalSufficiency.decision === 'sufficient') { stopReason = 'sufficient'; break; }
                if (!decision.refinedQueries.length || searches === beforeSearch) { stopReason = candidates.size ? 'insufficient-after-reflection' : 'no-admitted-results'; break; }
                if (fetches >= budgets.fetches) { stopReason = 'budget-fetches'; break; }
                missing = decision.missing; pending = decision.refinedQueries;
            }
        } catch (cause) {
            if (cause instanceof MasBudgetStop) stopReason = cause.reason;
            else { stopReason = 'model-unavailable'; issue = cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/web/model', 'The web model failed.', cause); }
        } finally { await fetcher.close(); }
        const rows = [...candidates.values()].map((row, index): WebRankCandidate => ({ id: row.id, url: row.citation.url, title: row.citation.title,
            text: row.excerpt, searchRank: discovery.get('url' in row.address ? row.address.url : '')?.rank ?? index + 1, scores: row.scores }));
        let ranked = await createWebRanker().rank(query.text, immutableGroundingJson(rows)), actualRankerId = 'web-rank/1';
        if (ranked.length && hasCustomRanker && !stopReason.startsWith('budget-')) {
            try {
                const proposed = await activeRanker.rank(query.text, immutableGroundingJson(ranked), { signal: deadline });
                if (proposed.length !== rows.length || new Set(proposed.map(row => row.id)).size !== rows.length) groundingReject('TGRD1002', '/ranker', 'Web ranking must preserve every fetched candidate exactly once.');
                for (const [index, row] of proposed.entries()) {
                    const original = ranked.find(item => item.id === row.id);
                    const { scores: _, ...facts } = row, { scores: _prior, ...expected } = original ?? {} as WebRankCandidate;
                    if (!original || !equalsJson(facts, expected) || row.scores.rank !== index + 1 || Object.values(row.scores).some(score => !Number.isFinite(score))
                        || row.scores.lexical !== original.scores.lexical || row.scores.fusion !== original.scores.fusion)
                        groundingReject('TGRD1002', '/ranker', 'A web ranker cannot alter evidence, raw scores or emit invalid ranks.');
                    const retainedCandidate = [...candidates.values()].find(candidate => candidate.id === row.id)!;
                    groundingMust(validateGroundingShape('evidenceCandidate', { ...retainedCandidate, scores: row.scores, rankerId }));
                }
                if (account.spent().tokens > budgets.tokens || account.spent().ms > budgets.ms) throw new MasBudgetStop(account.spent().tokens > budgets.tokens ? 'budget-tokens' : 'budget-ms');
                ranked = proposed; actualRankerId = rankerId;
            } catch (cause) {
                if (cause instanceof MasBudgetStop) stopReason = cause.reason;
                else { stopReason = 'ranker-unavailable'; issue = cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/web/ranker', 'The optional web ranker failed.', cause); }
            }
        }
        const byId = new Map([...candidates.values()].map(row => [row.id, row])); candidates.clear();
        for (const row of ranked) candidates.set(row.id, { ...byId.get(row.id)!, scores: row.scores, rankerId: actualRankerId });
        if (issue) finalSufficiency = { decision: 'refused', reason: stopReason };
        const spent = account.spent(), evidence = [...candidates.values()];
        const run = groundingMust(validateGroundingShape('webRetrievalRun', { id: runId, sessionId: input.id, queryId, identity, evidenceIds: evidence.map(row => row.id), attempts, requests, ...(issue ? { issue } : {}),
            sufficiency: finalSufficiency, stopReason, spend: { ...emptySpend(), calls: spent.turns - prior.calls, tokens: spent.tokens - prior.tokens, ms: Math.max(0, Math.ceil(spent.ms - prior.ms)),
                searches: searches - prior.searches, fetches: fetches - prior.fetches, bytes: bytes - prior.bytes } }));
        must(await store.putWebResult(run, evidence));
        return immutableGroundingJson({ ok: true, candidates: evidence, run, replayed: false });
    }
    return Object.freeze({ retrieve(session: Pick<GroundingSession, 'id'>, queryId: string): Promise<WebLaneOutcome> {
        const operation = tail.then(() => execute(session, queryId)).catch((cause: unknown): WebLaneOutcome => ({ ok: false,
            issue: cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/web', 'The web host failed.', cause) }));
        tail = operation; return operation;
    } });
}
