/** One projection into the native reference validator and one guarded RFC 6902 repair consumer. */
import { validateClaimEvidence, createClaimRefiner } from '@tangleai/context';
import type { ArtifactRecord, ClaimEvidenceEnvelope } from '@tangleai/context/schemas/evidence';
import { compileJSONPatch } from '@jarenjs/json/patch';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import type { DocumentCorpusStore } from '@tangleai/documents/contracts';
import type { EvidenceCandidate, LocalEvidenceAddress, WebEvidenceAddress, PrihaAnswer } from './contracts.gen.ts';
import { immutableGroundingJson } from './identity.ts';
import { groundingMust, groundingRefuse, groundingReject } from './errors.ts';
import { validateGroundingShape } from './schema.ts';

export type PrihaDraftClaim = Extract<PrihaAnswer, { disposition: 'answer' }>['claims'][number];
export interface ClaimValidationView {
    artifacts: ArtifactRecord[];
    evidence: ClaimEvidenceEnvelope['evidence'];
    visibleEvidence: string[];
}
export type ResolvedCitation = { lane: 'local'; chunkId: string; versionId: string; contentHash: string }
    | { lane: 'web'; url: string; sha256: string };
/** Resolve retained addresses only. This function never fetches or creates evidence. */
export async function createCitationResolver(input: readonly EvidenceCandidate[], corpus?: DocumentCorpusStore) {
    const admitted = immutableGroundingJson(input), resolved = new Map<string, ResolvedCitation>(), artifacts: ArtifactRecord[] = [];
    if (new Set(admitted.map(row => row.id)).size !== admitted.length) groundingReject('TGRD1008', '/evidence', 'Duplicate admitted evidence identities.');
    for (const candidate of admitted) {
        groundingMust(validateGroundingShape('evidenceCandidate', candidate));
        let digest: string;
        if (candidate.lane === 'web') {
            const address = candidate.address as WebEvidenceAddress;
            if (candidate.citation.url !== address.finalUrl) groundingReject('TGRD1008', '/citation/url', 'The citation must name the fetched final URL.');
            digest = address.sha256;
            resolved.set(candidate.id, { lane: 'web', url: address.finalUrl, sha256: digest });
        } else {
            const address = candidate.address as LocalEvidenceAddress;
            if (!corpus) groundingReject('TGRD1008', '/corpus', 'Local citation resolution requires its retained corpus.');
            const version = await corpus.getVersion(address.versionId), source = await corpus.getSource(address.sourceId);
            const chunk = (await corpus.listChunks(address.versionId)).find(row => row.id === address.chunkId);
            if (!version || !source || !chunk || chunk.sourceId !== source.id || chunk.versionId !== version.id || version.sourceId !== source.id)
                groundingReject('TGRD1008', '/address', 'Unknown local evidence.', { code: 'unknown-evidence' });
            if (version.status !== 'active' || source.activeVersionId !== version.id)
                groundingReject('TGRD1008', '/address/versionId', 'The cited version is no longer active.', { code: 'inactive-version' });
            if (!/^[a-f0-9]{64}$/.test(version.contentHash) || address.parentChunkId !== chunk.parentChunkId)
                groundingReject('TGRD1008', '/address', 'The retained local descriptor differs from its evidence.');
            if (address.parentChunkId) {
                const parent = (await corpus.listParents(version.id)).find(row => row.id === address.parentChunkId);
                if (!parent || parent.sourceId !== source.id || !parent.childIds.includes(chunk.id))
                    groundingReject('TGRD1008', '/address/parentChunkId', 'The parent does not retain this child.');
            }
            digest = version.contentHash;
            resolved.set(candidate.id, { lane: 'local', chunkId: chunk.id, versionId: version.id, contentHash: digest });
        }
        artifacts.push({ id: candidate.id, kind: candidate.lane === 'local' ? 'local-chunk' : 'web-page', locator: canonicalizeJson(candidate.address), digest });
    }
    const view: ClaimValidationView = immutableGroundingJson({ artifacts,
        evidence: admitted.map(row => ({ id: row.id, artifact: row.id, quote: row.excerpt })), visibleEvidence: admitted.map(row => row.id) });
    return Object.freeze({ view, resolve(id: string) {
        const value = resolved.get(id);
        return value ? { valid: true as const, value: immutableGroundingJson(value) } : groundingRefuse('TGRD1008', '/citations', 'Unknown evidence id.', { code: 'unknown-evidence' });
    } });
}
export function projectPrihaClaims(draft: PrihaAnswer, view: ClaimValidationView): ClaimEvidenceEnvelope {
    return { version: 1, artifacts: immutableGroundingJson(view.artifacts), evidence: immutableGroundingJson(view.evidence), visibleEvidence: [...view.visibleEvidence],
        claims: draft.disposition === 'answer' ? draft.claims.map(claim => ({ id: claim.id, text: claim.text, critical: claim.critical,
            status: claim.citations.length ? 'supported' : 'unresolved', evidence: [...claim.citations] })) : [] };
}
/** This is referential validation. Arbitrary prose entailment remains a separate evaluation. */
export function validatePrihaClaims(draft: PrihaAnswer, view: ClaimValidationView): { valid: boolean; errors: Array<{ code?: unknown; docPath: string; instancePath: string; message?: unknown }> } {
    const checked = validateClaimEvidence(projectPrihaClaims(draft, view), { artifacts: view.artifacts });
    return { valid: checked.valid, errors: (checked.errors ?? []).map((error: Record<string, unknown>) => {
        const path = String(error.docPath ?? error.instancePath ?? '').replace(/^(\/claims\/\d+)\/evidence(?=\/|$)/, '$1/citations');
        return { ...error, docPath: path, instancePath: path };
    }) };
}
export function validatePrihaRepairProposal(proposal: unknown) {
    const checked = validateGroundingShape('repairProposal', proposal);
    return checked.valid ? { valid: true, errors: [] } : { valid: false, errors: checked.issues.map(issue => ({ code: issue.code, docPath: issue.path, message: issue.detail })) };
}
/** The native guarded engine owns validation/commit; the native patch compiler owns every edit. */
export async function repairPrihaClaims(draftInput: PrihaAnswer, viewInput: ClaimValidationView, proposalInput: unknown) {
    const original = immutableGroundingJson(draftInput), view = immutableGroundingJson(viewInput), proposal = immutableGroundingJson(proposalInput);
    let candidate: PrihaAnswer | undefined, committed: PrihaAnswer | undefined;
    const refiner = createClaimRefiner({ artifacts: view.artifacts, read: async () => projectPrihaClaims(original, view),
        validateProposal: validatePrihaRepairProposal,
        apply(_envelope, patch) {
            candidate = compileJSONPatch(patch)(original) as PrihaAnswer;
            // Removing the final claim is a refusal, never an empty positive answer.
            if (candidate.disposition === 'answer' && !candidate.claims.length)
                candidate = { disposition: 'refuse', reason: 'The available evidence does not support a reliable answer.', claims: [] };
            groundingMust(validateGroundingShape('prihaAnswer', candidate));
            return projectPrihaClaims(candidate, view);
        },
        async commit(envelope) {
            if (!candidate || !equalsJson(envelope, projectPrihaClaims(candidate, view)))
                groundingReject('TGRD1008', '/repair', 'The guarded claim projection changed before commit.');
            committed = immutableGroundingJson(candidate); return committed;
        } });
    const result = await refiner.commit(proposal);
    return result.ok && committed ? { ok: true as const, value: committed } : { ok: false as const, errors: result.errors ?? [] };
}
