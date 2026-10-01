import assert from 'node:assert/strict';
import { captureKeyOf } from '@tangleai/core/http-capture';
import { createMemoryGroundingStore, createReplayWebTransport, createWebLane, groundingIdOf, loadGroundingProfile, webBytesSha256,
    type GroundingStore, type WebReplayRecord, type WebLaneOptions } from '@tangleai/grounding';
import type { MasChatCompletion } from '@tangleai/mas';
import profileDocument from './profile-minimal.json' with { type: 'json' };
import { createPrihaContractFixture, contractMust } from '../../../benchmark/lib/priha-contracts.ts';
export const WEB_AT = '2026-06-01T00:00:00.000Z', SEARCH_BASE = 'https://search.harbour.example', PAGE_BASE = 'https://official.harbour.example';
export const page = (path = '/page') => PAGE_BASE + path;
export async function webRecord(url: string, body: string, status = 200, headers?: [string, string][]): Promise<WebReplayRecord> {
    if (body.includes('<h1') && !body.includes('<body')) body = '<html><head></head><body>' + body.replace(/<\/?html>/g, '') + '</body></html>';
    const kind = new URL(url).origin === SEARCH_BASE ? 'searxng' : 'document', bytes = new TextEncoder().encode(body);
    return { kind, method: 'GET', url, key: await captureKeyOf(kind, 'GET', url), bytes, sha256: await webBytesSha256(bytes), status,
        headers: headers ?? [['content-type', kind === 'searxng' ? 'application/json' : 'text/html']] };
}
export async function searchRecord(query: string, hits: Array<{ url: string; title?: string; content?: string }>) {
    const url = new URL(SEARCH_BASE + '/search'); url.searchParams.set('format', 'json'); url.searchParams.set('q', query);
    return webRecord(url.toString(), JSON.stringify({ results: hits.map(hit => ({ title: 'Fixture discovery', content: 'Discovery hint only.', ...hit })) }));
}
export const toolTurn = (...calls: Array<[string, object]>): MasChatCompletion => ({ message: { role: 'assistant', content: '', toolCalls: calls.map(([name, args], index) => ({ id: 'tool-' + index, name, arguments: JSON.stringify(args) })) }, usage: { total_tokens: 10 } });
export const finishTurn = (): MasChatCompletion => ({ message: { role: 'assistant', content: 'Read the admitted pages.' }, usage: { total_tokens: 10 } });
export const sufficiencyTurn = (sufficient = true, refinedQueries: string[] = []): MasChatCompletion => ({ message: { role: 'assistant', content: JSON.stringify({ sufficient, missing: sufficient ? [] : ['An admitted page.'], refinedQueries, reason: 'Fixture evidence assessment.' }) }, usage: { total_tokens: 10 } });
export async function webHarness(input: { records?: WebReplayRecord[]; steps: MasChatCompletion[]; query?: string; queries?: string[]; store?: GroundingStore; options?: Partial<WebLaneOptions> }) {
    const profile = await loadGroundingProfile(profileDocument); assert.ok(profile.valid);
    const store = input.store ?? createMemoryGroundingStore(); contractMust(await store.putProfile(profile.value));
    let session = contractMust(await store.createSession({ conversationId: 'web-fixture', profileId: profile.value.id, profileRevision: profile.value.revision }));
    const f = await createPrihaContractFixture(profile.value, session), queries = input.queries ?? [input.query ?? 'Harbour booking'];
    f.plan.queries = queries.map((text, index) => ({ id: 'query-' + index, text, why: 'Find admitted administrative evidence.', lanes: { local: false, web: true }, ruleIds: ['in-scope'] }));
    f.plan.profileRevision = profile.value.revision; f.plan.id = await groundingIdOf('plan', { intentId: f.intent.id, queries: f.plan.queries });
    contractMust(await store.putIntent(f.intent)); contractMust(await store.putPlan(f.plan));
    session = contractMust(await store.transitionSession(session.id, { kind: 'triage' }, session.revision));
    session = contractMust(await store.transitionSession(session.id, { kind: 'plan', intentId: f.intent.id, planId: f.plan.id }, session.revision));
    const records = input.records ?? [await searchRecord(queries[0]!, [{ url: page() }]), await webRecord(page(), '<html><h1>Booking desk</h1><p>Harbour booking is in Square Hall.</p></html>')];
    const transport = await createReplayWebTransport([...records, await webRecord(page('/robots.txt'), 'User-agent: *\nAllow: /', 200, [['content-type', 'text/plain']])], { searxBase: SEARCH_BASE });
    let calls = 0;
    const client = { endpoint: { provider: 'scripted' }, async complete(request: unknown) {
        const step = input.steps[calls++]; assert.ok(step, 'Unexpected physical model call ' + calls);
        assert.ok((request as { signal?: AbortSignal }).signal, 'Every physical call receives its deadline');
        return structuredClone(step);
    } };
    const options: WebLaneOptions = { profile: profile.value, client, modelIdentity: null, transport, store, clock: () => 0, now: () => WEB_AT, ...input.options };
    return { profile: profile.value, session, plan: f.plan, store, transport, options, lane: createWebLane(options), calls: () => calls };
}
