/** Reference and identity validation adds semantics to the single closed record schema. */
import { isVector } from '@jarenjs/core/vector';
import { equalsJson as same } from '@jarenjs/core/object';
import type { DocumentChunk } from '@tangleai/documents/contracts';
import { sameIdentity } from '@tangleai/context/ledger';
import type { GraphEntityClaim, GraphRelationClaim, GraphEntity, GraphRelation, LightRagEmbeddedBy } from './contracts.gen.ts';
import { validateLightRagShape } from './schema.ts';
import { claimIdOf, canonicalEntityIdOf, canonicalRelationIdOf, canonicalGraphRevisionOf } from './identity.ts';
import { foldEntityName, foldThemes } from './normalize.ts';
import { lightragMust, lightragReject, lightragFailure, type LightRagOutcome } from './errors.ts';
type LightRagChunkAddress = Pick<DocumentChunk, 'id' | 'sourceId' | 'versionId'>;
const sorted = (values: readonly string[]) => [...new Set(values)].sort();
export function validateGraphClaim(kind: 'entity', value: unknown, chunks: readonly LightRagChunkAddress[]): Promise<LightRagOutcome<GraphEntityClaim>>;
export function validateGraphClaim(kind: 'relation', value: unknown, chunks: readonly LightRagChunkAddress[]): Promise<LightRagOutcome<GraphRelationClaim>>;
export async function validateGraphClaim(kind: 'entity' | 'relation', value: unknown, chunks: readonly LightRagChunkAddress[]): Promise<LightRagOutcome<GraphEntityClaim | GraphRelationClaim>> {
    try {
        const claim = lightragMust(validateLightRagShape(kind === 'entity' ? 'graphEntityClaim' : 'graphRelationClaim', value));
        const matches = chunks.filter(chunk => chunk.id === claim.chunkId);
        if (matches.length !== 1 || matches[0].sourceId !== claim.sourceId || matches[0].versionId !== claim.versionId)
            lightragReject('TLRAG1003', '/chunkId', 'The claim does not resolve to exactly one supplied chunk of its source and version.');
        if (claim.id !== await claimIdOf(claim)) lightragReject('TLRAG1002', '/id', 'The immutable claim differs from its content address.');
        if ('normalizedName' in claim) {
            if (claim.normalizedName !== foldEntityName(claim.name)) lightragReject('TLRAG1002', '/normalizedName', 'The entity name differs from its deterministic fold.');
        } else if (claim.normalizedSource !== foldEntityName(claim.sourceName) || claim.normalizedTarget !== foldEntityName(claim.targetName) || !same(claim.themes, foldThemes(claim.themes))) {
            lightragReject('TLRAG1002', '/themes', 'Relation endpoint names and themes must retain their deterministic folds.');
        }
        return { valid: true, value: claim };
    } catch (cause) { return lightragFailure(cause); }
}
function vectorOf(row: GraphEntity | GraphRelation, expected?: LightRagEmbeddedBy): void {
    if (!isVector(row.embedding, row.embeddedBy.dims) || expected !== undefined && !sameIdentity(row.embeddedBy, expected))
        lightragReject('TLRAG1002', '/embeddedBy', 'A canonical vector differs from its declared or requested embedding identity.');
}
function supportOf<T extends GraphEntityClaim | GraphRelationClaim>(row: GraphEntity | GraphRelation, claims: readonly T[]): T[] {
    const byId = new Map(claims.map(claim => [claim.id, claim]));
    const support = row.supportClaimIds.map(id => byId.get(id));
    if (support.some(claim => claim === undefined)) lightragReject('TLRAG1003', '/supportClaimIds', 'A canonical names a claim absent from its supplied evidence.');
    const resolved = support as T[];
    if (!same(sorted(row.supportChunkIds), sorted(resolved.map(claim => claim.chunkId))))
        lightragReject('TLRAG1003', '/supportChunkIds', 'Canonical chunk support must equal the union of its supporting claims.');
    return resolved;
}
export async function validateCanonicalEntity(value: unknown, claims: readonly GraphEntityClaim[], options: {
    expectedEmbeddedBy?: LightRagEmbeddedBy; previous?: GraphEntity;
} = {}): Promise<LightRagOutcome<GraphEntity>> {
    try {
        const row = lightragMust(validateLightRagShape('graphEntity', value)); vectorOf(row, options.expectedEmbeddedBy);
        const support = supportOf(row, claims);
        if (row.normalizedName !== foldEntityName(row.name) || row.id !== await canonicalEntityIdOf(row.name, row.types[0], row.identityClaimId)
            || row.revision !== await canonicalGraphRevisionOf(row)) lightragReject('TLRAG1002', '/id', 'Canonical entity identity or revision differs from its content.');
        if (support.some(claim => claim.type !== row.types[0] || claim.normalizedName !== row.normalizedName)
            || row.aliases.some(alias => foldEntityName(alias) !== row.normalizedName))
            lightragReject('TLRAG1006', '/supportClaimIds', 'Entity support crosses a normalized name or type boundary.');
        if (row.identityClaimId !== undefined && !support.some(claim => claim.id === row.identityClaimId)) {
            const previous = options.previous;
            if (!previous || previous.id !== row.id || previous.identityClaimId !== row.identityClaimId)
                lightragReject('TLRAG1003', '/identityClaimId', 'A new homonym discriminator must name one of its own supporting claims.');
        }
        if (row.status === 'merged' && row.mergedInto === row.id) lightragReject('TLRAG1006', '/mergedInto', 'A canonical cannot merge into itself.');
        return { valid: true, value: row };
    } catch (cause) { return lightragFailure(cause); }
}
export async function validateCanonicalRelation(value: unknown, claims: readonly GraphRelationClaim[], entities: readonly GraphEntity[], options: {
    expectedEmbeddedBy?: LightRagEmbeddedBy;
} = {}): Promise<LightRagOutcome<GraphRelation>> {
    try {
        const row = lightragMust(validateLightRagShape('graphRelation', value)); vectorOf(row, options.expectedEmbeddedBy);
        const support = supportOf(row, claims), source = entities.find(entity => entity.id === row.sourceEntityId), target = entities.find(entity => entity.id === row.targetEntityId);
        if (!source || !target) lightragReject('TLRAG1003', '/sourceEntityId', 'A relation endpoint is absent from its supplied canonical entities.');
        if (!same(row.themes, foldThemes(row.themes)) || row.id !== await canonicalRelationIdOf(row.sourceEntityId, row.targetEntityId, row.themes)
            || row.revision !== await canonicalGraphRevisionOf(row)) lightragReject('TLRAG1002', '/id', 'Canonical relation identity or revision differs from its content.');
        if (support.some(claim => claim.normalizedSource !== source.normalizedName || claim.normalizedTarget !== target.normalizedName || !same(claim.themes, row.themes)))
            lightragReject('TLRAG1006', '/supportClaimIds', 'Relation support changes an endpoint direction or a distinct theme.');
        if (row.status === 'active' && (source.status !== 'active' || target.status !== 'active'))
            lightragReject('TLRAG1006', '/sourceEntityId', 'An active relation must use active canonical endpoints.');
        if (row.status === 'merged' && row.mergedInto === row.id) lightragReject('TLRAG1006', '/mergedInto', 'A canonical cannot merge into itself.');
        return { valid: true, value: row };
    } catch (cause) { return lightragFailure(cause); }
}
