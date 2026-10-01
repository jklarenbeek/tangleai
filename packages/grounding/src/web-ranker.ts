/** Deterministic web ordering through the same lexical and reciprocal-rank owners. */
import { createLexicalIndex, fuseReciprocalRanks } from '@tangleai/core/lexical';
import type { CandidateRanker } from './ranker.ts';
import type { EvidenceCandidate } from './contracts.gen.ts';
export interface WebRankCandidate {
    id: string; url: string; title: string; text: string; searchRank: number;
    scores: EvidenceCandidate['scores'];
}
export function createWebRanker(k = 60): CandidateRanker<WebRankCandidate> {
    if (!Number.isFinite(k) || k <= 0) throw new TypeError('The reciprocal rank constant must be positive.');
    return Object.freeze({ id: 'web-rank', version: '1', async rank(query: string, candidates: readonly WebRankCandidate[]) {
        if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length
            || candidates.some(candidate => !Number.isSafeInteger(candidate.searchRank) || candidate.searchRank < 1))
            throw new TypeError('Web candidates require distinct addresses and positive discovery ranks.');
        if (!candidates.length) return [];
        const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
        const search = [...candidates].sort((a, b) => a.searchRank - b.searchRank).map(candidate => candidate.id);
        const hits = createLexicalIndex(candidates.map(candidate => ({ id: candidate.id, text: candidate.title + '\n' + candidate.text }))).rank(query);
        const lexical = new Map(hits.map(hit => [hit.id, hit.score]));
        return fuseReciprocalRanks([search, hits.map(hit => hit.id)], k).map((hit, index) => {
            const candidate = byId.get(hit.id)!;
            return { ...candidate, scores: { ...candidate.scores, lexical: lexical.get(hit.id) ?? 0, fusion: hit.score, rank: index + 1 } };
        });
    } });
}

import { createStructuredOutput } from '@tangleai/models/structured';
import { createSharedBudgetClient, type MasChatClient, type MasBudgetAccount } from '@tangleai/mas';
import { renderGmplPrompt } from '@tangleai/gmpl';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { groundingReject } from './errors.ts';
import { immutableGroundingJson } from './identity.ts';
import type { WebLaneRanker } from './web.ts';
import type { WebRerank, WebRunIdentity } from './contracts.gen.ts';
/** Optional model ordering. A lane must bind its shared account before dispatch. */
export function createModelWebRanker(options: { client: MasChatClient; modelIdentity: WebRunIdentity['modelIdentity'] }): WebLaneRanker {
    const client = options.client, modelIdentity = immutableGroundingJson(options.modelIdentity);
    const id = 'web-rerank-model', version = '1';
    return Object.freeze({ id, version, modelIdentity,
        async rank() { return groundingReject('TGRD1007', '/ranker', 'Model ranking requires the web lane shared budget.'); },
        withBudget(account: MasBudgetAccount): CandidateRanker<WebRankCandidate> {
            const observed = createSharedBudgetClient(client, account);
            return { id, version, async rank(query, candidates, context) {
                if (!candidates.length) return [];
                const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-web-rerank')!;
                const rendered = renderGmplPrompt(artifact, { query, evidence: [], context: { candidates: candidates.map((row, index) => ({ index, title: row.title, text: row.text })) } });
                if (!rendered.valid) groundingReject('TGRD1001', '/ranker', 'Reranker prompt failed.', rendered.issues[0]);
                const generator = createStructuredOutput({ client: { ...observed, endpoint: observed.endpoint ?? { provider: 'scripted' } }, schema: artifact.outputSchema,
                    name: 'grounding_web_rerank', maxRepairs: 1, gate: (value: WebRerank) => {
                        const valid = value.length === candidates.length && new Set(value.map(row => row.index)).size === candidates.length && value.every(row => row.index < candidates.length);
                        return { valid, errors: valid ? [] : [{ code: 'web-rank-index', docPath: '', message: 'Return each candidate index exactly once.' }] };
                    } });
                const output = await generator.generate([{ role: 'system', content: rendered.value.system }, { role: 'user', content: rendered.value.user }], { signal: context?.signal });
                if (output.errors) groundingReject('TGRD1001', '/ranker', 'The optional model reranker failed after one repair.', { code: 'structured-output', message: JSON.stringify(output.errors) });
                return (output.value as WebRerank).slice().sort((a, b) => b.relevance - a.relevance || a.index - b.index).map((row, index) => ({
                    ...candidates[row.index]!, scores: { ...candidates[row.index]!.scores, relevance: row.relevance, rank: index + 1 },
                }));
            } };
        },
    });
}
