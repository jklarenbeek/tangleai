/** Small authored claims with explicit physical provenance for graph lifecycle tests. */
import { claimIdOf, canonicalEntityIdOf, canonicalRelationIdOf, canonicalGraphRevisionOf, contributionRevisionOf, projectionIdOf } from '../../packages/lightrag/src/identity.ts';
import { foldEntityName } from '../../packages/lightrag/src/normalize.ts';
import type { GraphEntityClaim, GraphRelationClaim, GraphEntity, GraphRelation, GraphContributionInput, GraphContributionPlan, GraphProjection } from '../../packages/lightrag/src/contracts.gen.ts';
export const graphEmbeddedBy = { model: 'fixture-name-themes', dims: 2 };
export const graphModel = { provider: 'fixture', model: 'scripted' };
export async function graphClaim(name: string, options: { source?: string; version?: string; ordinal?: number; type?: GraphEntityClaim['type']; description?: string } = {}): Promise<GraphEntityClaim> {
    const sourceId = options.source ?? 'a', versionId = options.version ?? sourceId + '-v1', ordinal = options.ordinal ?? 0;
    const body = { sourceId, versionId, chunkId: sourceId + '-chunk-' + versionId, ordinal, name, normalizedName: foldEntityName(name), type: options.type ?? 'ORGANIZATION',
        description: options.description ?? foldEntityName(name) + ' has an evidenced civic role.', promptRevision: 'a'.repeat(64), modelIdentity: graphModel, extractedAt: null };
    return { ...body, id: await claimIdOf(body) };
}
export async function graphEntity(claim: GraphEntityClaim, distinguish = false): Promise<GraphEntity> {
    const identityClaimId = distinguish ? claim.id : undefined;
    const row = { id: await canonicalEntityIdOf(claim.name, claim.type, identityClaimId), ...(identityClaimId ? { identityClaimId } : {}), name: claim.name, normalizedName: claim.normalizedName,
        aliases: [], types: [claim.type], profile: claim.description, supportClaimIds: [claim.id], supportChunkIds: [claim.chunkId],
        embedding: [1, 0], embeddedBy: graphEmbeddedBy, status: 'active' as const };
    return { ...row, revision: await canonicalGraphRevisionOf(row) };
}
export async function graphEdge(source: GraphEntity, target: GraphEntity, options: { sourceId?: string; versionId?: string; theme?: string; ordinal?: number } = {}): Promise<{ claim: GraphRelationClaim; row: GraphRelation }> {
    const sourceId = options.sourceId ?? 'a', versionId = options.versionId ?? sourceId + '-v1';
    const body = { sourceId, versionId, chunkId: sourceId + '-chunk-' + versionId, ordinal: options.ordinal ?? 0, sourceName: source.name, targetName: target.name,
        normalizedSource: source.normalizedName, normalizedTarget: target.normalizedName, themes: [options.theme ?? 'equipment'], strength: 1,
        description: source.name + ' has a ' + (options.theme ?? 'equipment') + ' relation to ' + target.name + '.', promptRevision: 'a'.repeat(64), modelIdentity: graphModel, extractedAt: null };
    const claim = { ...body, id: await claimIdOf(body) };
    const row = { id: await canonicalRelationIdOf(source.id, target.id, body.themes), sourceEntityId: source.id, targetEntityId: target.id, themes: body.themes, strength: body.strength,
        profile: body.description, supportClaimIds: [claim.id], supportChunkIds: [claim.chunkId], embedding: [0, 1], embeddedBy: graphEmbeddedBy, status: 'active' as const };
    return { claim, row: { ...row, revision: await canonicalGraphRevisionOf(row) } };
}
export function graphInput(entities: GraphEntityClaim[], candidates: GraphEntity[], edges: Array<{ claim: GraphRelationClaim; row: GraphRelation }> = [], previous?: GraphContributionPlan): GraphContributionInput {
    const existing = previous ? { claims: {
        entities: [...new Map([...previous.input.existing.claims.entities, ...previous.input.claims.entities].map(row => [row.id, row])).values()],
        relations: [...new Map([...previous.input.existing.claims.relations, ...previous.input.claims.relations].map(row => [row.id, row])).values()],
    }, canonicals: previous.canonicals } : { claims: { entities: [], relations: [] }, canonicals: { entities: [], relations: [] } };
    const claims = { entities, relations: edges.map(edge => edge.claim) };
    const chunks = [...new Map([...existing.claims.entities, ...existing.claims.relations, ...entities, ...claims.relations].map(row => [row.chunkId, { id: row.chunkId, sourceId: row.sourceId, versionId: row.versionId }])).values()];
    const profiles = [...new Map([...entities, ...claims.relations].map(claim => [claim.chunkId, { chunkId: claim.chunkId, versionId: claim.versionId, keywords: [], promptRevision: claim.promptRevision }])).values()];
    return { claims, profiles, chunks, existing, candidates: { entities: candidates, relations: edges.map(edge => edge.row) }, retiredClaimIds: [], merges: [], reviews: [], profileUpdates: [], embeddedBy: graphEmbeddedBy };
}

export async function stagedGraphProjection(contribution: GraphContributionPlan, sourceId = 'a', versionId = sourceId + '-v1'): Promise<GraphProjection> {
    const identities = { extraction: 'fixture/1', chunker: { version: 'fixture/1', config: { maxTokens: 100, overlapTokens: 32 } }, embedder: graphEmbeddedBy,
        prompts: { extraction: 'a'.repeat(64) }, model: graphModel };
    const contributionRevision = await contributionRevisionOf({ sourceId, versionId, claims: contribution.input.claims, profiles: contribution.input.profiles, identities });
    return { id: await projectionIdOf(sourceId, versionId, contributionRevision), sourceId, versionId, contributionRevision, head: { versionId: null, revision: 0 }, status: 'staged', identities,
        counts: { claims: contribution.input.claims.entities.length + contribution.input.claims.relations.length, entities: contribution.input.candidates.entities.length,
            relations: contribution.input.candidates.relations.length, canonicalsTouched: contribution.touchedEntityIds.length + contribution.touchedRelationIds.length, chunks: contribution.input.profiles.length },
        spend: { calls: 0, tokens: 0, ms: 0 }, entityClaimIds: contribution.input.claims.entities.map(row => row.id).sort(), relationClaimIds: contribution.input.claims.relations.map(row => row.id).sort(),
        chunkIds: contribution.input.profiles.map(row => row.chunkId).sort() };
}
