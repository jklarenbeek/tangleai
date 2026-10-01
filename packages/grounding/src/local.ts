/** Governed local policy over existing document ranking and bounded lexical search. */
import { equalsJson } from '@jarenjs/core/object';
import { createLexicalIndex } from '@tangleai/core/lexical';
import type { Embedder } from '@tangleai/models/embed';
import { PARENT_CHILD_CHUNKER_VERSION, type DocumentCorpusStore, type DocumentParent, type DocumentChunk, type DocumentSource } from '@tangleai/documents/contracts';
import { rankDocumentChunks } from '@tangleai/documents/retrieval';
import type { EvidenceCandidate, GroundingIssue, CorpusManifest } from './contracts.gen.ts';
import type { GroundingStore } from './store.ts';
import { GroundingAbort, groundingIssue, groundingMust, groundingReject } from './errors.ts';
import { groundingIdOf, groundingRevisionOf, immutableGroundingJson } from './identity.ts';
import { validateGroundingShape } from './schema.ts';
import type { CandidateRanker, LocalCandidate } from './ranker.ts';

export interface LocalCensus {
    activeVersions: number; children: number; semantic: number; lexical: number; skipped: number;
    deduplicated: number; diversityDropped: number; parentsOverBudget: number; selected: number;
    issues: number; rebuilds: number; rebuildMs: number; generation: number; sourceRevision: string;
    contextTokens: number;
}
export type LocalRetrievalOutcome =
    | { ok: true; candidates: EvidenceCandidate[]; parents: DocumentParent[]; reason: 'selected' | 'no-evidence'; census: LocalCensus }
    | { ok: false; issue: GroundingIssue; census: LocalCensus };
export interface LocalRetrieverOptions {
    store: DocumentCorpusStore;
    manifests?: Pick<GroundingStore, 'getManifest'>;
    session: { id: string; profileId: string; profileRevision: string };
    embedder: Embedder;
    ranker: CandidateRanker;
    lexical?: { limits?: NonNullable<Parameters<typeof createLexicalIndex>[1]>['limits'] };
    budgets: { contextTokens: number };
    /** Explicit experimental ablations; production hosts normally enable both. */
    lanes?: { semantic: boolean; lexical: boolean };
    now: () => string;
    clock?: () => number;
}
export interface LocalRetrievalOptions { k: number; minScore: number; maxPerSource: number; contextTokens: number; }
export function createLocalRetriever(options: LocalRetrieverOptions) {
    const { store, embedder, ranker } = options, clock = options.clock ?? (() => performance.now());
    let resident: ReturnType<typeof createLexicalIndex> | undefined, generation = 0, sourceRevision = '';
    const lanes = options.lanes ?? { semantic: true, lexical: true };
    // Serialize access to the generation cache; concurrent queries never swap its corpus mid-search.
    let pending = Promise.resolve();
    async function retrieve(query: { id: string; text: string }, selection: LocalRetrievalOptions): Promise<LocalRetrievalOutcome> {
        const census: LocalCensus = { activeVersions: 0, children: 0, semantic: 0, lexical: 0, skipped: 0,
            deduplicated: 0, diversityDropped: 0, parentsOverBudget: 0, selected: 0, issues: 0,
            rebuilds: 0, rebuildMs: 0, generation, sourceRevision, contextTokens: 0 };
        try {
            if (!query?.id?.trim() || typeof query.text !== 'string' || !query.text.trim()
                || !options.session.id?.trim() || !options.session.profileId?.trim() || !options.session.profileRevision?.trim()
                || !ranker.id?.trim() || !ranker.version?.trim() || !lanes.semantic && !lanes.lexical
                || ![selection.k, selection.maxPerSource, selection.contextTokens, options.budgets.contextTokens].every(n => Number.isSafeInteger(n) && n >= 0)
                || !selection.k || !selection.maxPerSource || !Number.isFinite(selection.minScore) || selection.minScore < -1 || selection.minScore > 1)
                groundingReject('TGRD1001', '/retrieval', 'Local retrieval needs named identities, enabled lanes and finite selection budgets.');
            const sources = (await store.listSources()).filter(s => s.status === 'ready' && s.activeVersionId);
            const versions = (await store.listVersions()).filter(v => v.status === 'active' && v.chunkerVersion === PARENT_CHILD_CHUNKER_VERSION
                && sources.some(s => s.id === v.sourceId && s.activeVersionId === v.id));
            const ids = versions.map(v => v.id).sort(), allowed = new Set(ids);
            const chunks = (await store.listChunks()).filter(c => allowed.has(c.versionId));
            const byChunk = new Map(chunks.map(c => [c.id, c])), bySource = new Map(sources.map(s => [s.id, s]));
            const parents = new Map((await store.listParents()).filter(p => allowed.has(p.versionId)).map(p => [p.id, p]));
            census.activeVersions = ids.length; census.children = chunks.length;
            const lexicalCall = <T>(run: () => T): T => {
                try { return run(); }
                catch (cause) { groundingReject(cause instanceof RangeError ? 'TGRD1007' : 'TGRD1009', '/lexical', cause instanceof RangeError ? 'Local lexical bounds exhausted.' : 'Local lexical preparation or retrieval failed.', cause); }
            };
            const revision = await groundingRevisionOf(ids);
            if (lanes.lexical && (!resident || sourceRevision !== revision)) {
                const start = clock();
                try {
                    const rebuilt = lexicalCall(() => createLexicalIndex(chunks.map(c => ({ id: c.id, text: c.text })), {
                        limits: options.lexical?.limits, generation: generation + 1, sourceRevision: revision,
                    }));
                    resident = rebuilt; generation++; sourceRevision = revision; census.rebuilds++;
                } finally { census.rebuildMs += Math.max(0, clock() - start); }
            }
            census.generation = generation; census.sourceRevision = lanes.lexical ? sourceRevision : revision;
            const candidates = new Map<string, LocalCandidate>();
            const add = (id: string, lane: 'semantic' | 'lexical', score: number) => {
                const chunk = byChunk.get(id), parent = chunk?.parentChunkId && parents.get(chunk.parentChunkId);
                if (!chunk || !parent || parent.versionId !== chunk.versionId || !parent.childIds.includes(chunk.id))
                    groundingReject('TGRD1004', '/parentChunkId', 'Local evidence requires its retained parent in the same version.');
                const prior = candidates.get(id); if (prior) census.deduplicated++;
                candidates.set(id, { chunk, parent, source: bySource.get(chunk.sourceId)!, scores: { ...prior?.scores, [lane]: score } });
            };
            if (lanes.semantic && chunks.length) {
                const vectors = await embedder.embed([query.text]), vector = vectors[0];
                if (vectors.length !== 1 || !vector?.length || Array.from(vector).some(n => !Number.isFinite(n))
                    || embedder.dims !== undefined && vector.length !== embedder.dims)
                    groundingReject('TGRD1009', '/embedder', 'The query embedder returned an invalid vector.');
                const ranked = rankDocumentChunks(chunks, vector, { model: embedder.model, dims: embedder.dims ?? vector.length }, { minScore: selection.minScore });
                census.skipped = ranked.skipped; census.semantic = ranked.scored.length;
                for (const hit of ranked.scored) add(hit.chunk.id, 'semantic', hit.score);
            }
            if (lanes.lexical) {
                if (!resident || resident.sourceRevision !== revision) groundingReject('TGRD1009', '/lexical', 'The active corpus has no matching lexical index.');
                const hits = lexicalCall(() => resident!.rank(query.text));
                census.lexical = hits.length;
                for (const hit of hits) add(hit.id, 'lexical', hit.score);
            }
            const input = immutableGroundingJson([...candidates.values()]);
            const ranked = await ranker.rank(query.text, input);
            if (!Array.isArray(ranked)) groundingReject('TGRD1009', '/ranker', 'The ranker must return a candidate array.');
            const result: EvidenceCandidate[] = [], expanded = new Map<string, DocumentParent>(), seen = new Set<string>(), counts = new Map<string, number>();
            for (const row of ranked) {
                const original = candidates.get(row?.chunk?.id);
                if (!original || !equalsJson(immutableGroundingJson({ ...row, scores: {} }), immutableGroundingJson({ ...original, scores: {} }))
                    || row.scores.semantic !== original.scores.semantic || row.scores.lexical !== original.scores.lexical
                    || !Number.isFinite(row.scores.rank) || row.scores.rank! < 1 || row.scores.fusion !== undefined && !Number.isFinite(row.scores.fusion))
                    groundingReject('TGRD1009', '/ranker', 'A ranker may only add finite rank and fusion scores to unchanged evidence.');
                if (seen.has(row.chunk.id)) { census.deduplicated++; continue; } seen.add(row.chunk.id);
                if ((counts.get(row.source.id) ?? 0) >= selection.maxPerSource) { census.diversityDropped++; continue; }
                const tokens = expanded.has(row.parent.id) ? 0 : row.parent.tokenCount;
                if (census.contextTokens + tokens > Math.min(selection.contextTokens, options.budgets.contextTokens)) { census.parentsOverBudget++; continue; }
                const manifest = await options.manifests?.getManifest(row.source.id, row.chunk.versionId);
                if (manifest && (manifest.status !== 'active' || manifest.profileId !== options.session.profileId || manifest.profileRevision !== options.session.profileRevision))
                    groundingReject('TGRD1004', '/manifest', 'The local curated version belongs to a different profile revision.');
                const candidate = await projectLocalEvidence({ session: options.session, queryId: query.id,
                    chunk: row.chunk, parent: row.parent, source: row.source, manifest,
                    excerpt: row.parent.text, scores: row.scores, rankerId: ranker.id + '/' + ranker.version, at: options.now() });
                result.push(candidate); expanded.set(row.parent.id, row.parent); census.contextTokens += tokens;
                counts.set(row.source.id, (counts.get(row.source.id) ?? 0) + 1);
                if (result.length === selection.k) break;
            }
            census.selected = result.length;
            return { ok: true, candidates: result, parents: immutableGroundingJson([...expanded.values()]), reason: result.length ? 'selected' : 'no-evidence', census };
        } catch (cause) {
            census.issues++;
            return { ok: false, issue: cause instanceof GroundingAbort ? cause.issue : groundingIssue('TGRD1009', '/retrieval', 'Local retrieval failed.', cause), census };
        }
    }
    return Object.freeze({ retrieve(query: { id: string; text: string }, selection: LocalRetrievalOptions) {
        const result = pending.then(() => retrieve(query, selection)); pending = result.then(() => undefined, () => undefined); return result;
    } });
}

/** One evidence projection for governed parent retrieval and legacy flat-context consumers. */
export async function projectLocalEvidence(input: {
    session: { id: string; profileId: string; profileRevision: string }; queryId: string;
    chunk: DocumentChunk; parent?: DocumentParent; source: DocumentSource; manifest?: CorpusManifest;
    excerpt: string; scores: EvidenceCandidate['scores']; rankerId: string; at: string;
}): Promise<EvidenceCandidate> {
    const { session, queryId, chunk, parent, source, manifest } = input;
    if (chunk.sourceId !== source.id || chunk.versionId !== source.activeVersionId
        || parent && (parent.versionId !== chunk.versionId || parent.sourceId !== source.id || !parent.childIds.includes(chunk.id) || chunk.parentChunkId !== parent.id)
        || chunk.parentChunkId && !parent
        || manifest && (manifest.sourceId !== source.id || manifest.versionId !== chunk.versionId || manifest.status !== 'active'
            || manifest.profileId !== session.profileId || manifest.profileRevision !== session.profileRevision))
        groundingReject('TGRD1004', '/address', 'Local projection requires matching retained source, version, parent and curator identities.');
    const payload = { sessionId: session.id, profileRevision: session.profileRevision, queryId, lane: 'local' as const,
        address: { chunkId: chunk.id, ...(parent ? { parentChunkId: parent.id } : {}), versionId: chunk.versionId, sourceId: source.id },
        excerpt: input.excerpt, scores: input.scores, rankerId: input.rankerId,
        authority: manifest ? { tier: manifest.authorityTier, institution: manifest.institution, ruleIds: ['curator:' + manifest.id] }
            : { tier: 'unverified' as const, ruleIds: ['uncurated-local'] },
        times: manifest?.times ?? { provenance: null }, admitted: { by: ['active-version', ...(manifest ? ['curator:' + manifest.id] : ['uncurated-local'])], at: input.at },
        citation: { url: manifest?.canonicalUrl ?? source.canonicalUrl, title: source.title ?? source.canonicalUrl,
            ...(chunk.pageStart === undefined ? {} : { page: chunk.pageStart }), headingPath: chunk.headingPath } };
    return groundingMust(validateGroundingShape('evidenceCandidate', { ...payload, id: await groundingIdOf('evidence', payload) }));
}
